import json
import logging
import os
import re
import sys

from flask import Flask, jsonify, request, send_from_directory
from langchain_core.messages import AIMessage

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s %(message)s',
)
logger = logging.getLogger(__name__)

from agents.sd_agent_v1 import create_sd_agent_v1
from agents.sd_agent_v2 import create_sd_agent_v2
from agents.model_aliases import MODEL_ALIASES, resolve_model

PORTAL_DIR = os.path.join(PROJECT_ROOT, 'portal')

app = Flask(__name__, static_folder=PORTAL_DIR, static_url_path='')
SUPPORTED_AGENT_FACTORIES = {
    'v1': create_sd_agent_v1,
    'v2': create_sd_agent_v2,
}


def get_supported_models():
    return [
        {"alias": alias, "target": target}
        for alias, target in MODEL_ALIASES.items()
    ]


def get_supported_agent_versions():
    return [
        {"alias": "v1", "target": "baseline structured output"},
        {"alias": "v2", "target": "(beta) rag-primed structured output"},
    ]


def normalize_version(version):
    candidate = str(version or 'v2').strip().lower()
    return candidate if candidate in SUPPORTED_AGENT_FACTORIES else 'v2'


def normalize_message_content(content):
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get('text') or item.get('content') or json.dumps(item))
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content or '')


def extract_json_payload(content):
    text = normalize_message_content(content).strip()
    if not text:
        return None

    fenced_match = re.match(r'^```(?:json)?\s*(.*?)\s*```$', text, flags=re.DOTALL | re.IGNORECASE)
    if fenced_match:
        text = fenced_match.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = text[start:end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None

    return None


@app.route('/')
def home():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/v1')
@app.route('/v1/')
@app.route('/v2')
@app.route('/v2/')
def versioned_home():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def portal_static(path):
    return send_from_directory(app.static_folder, path)


@app.route('/config', methods=['GET'])
@app.route('/api/config', methods=['GET'])
@app.route('/api/<version>/config', methods=['GET'])
def config(version='v2'):
    resolved_version = normalize_version(version)
    return jsonify({
        "version": resolved_version,
        "agent_versions": get_supported_agent_versions(),
        "models": get_supported_models(),
    })


def execute_sd_agent(version):
    payload = request.get_json(silent=True) or {}
    query = (payload.get('query') or '').strip()
    model = (payload.get('model') or 'gpt').strip()
    resolved_version = normalize_version(version)

    logger.info('sd-agent request received', extra={
        'model': model,
        'version': resolved_version,
        'query': query,
    })

    if not query:
        logger.warning('sd-agent request missing query', extra={'payload': payload})
        return jsonify({"error": "Problem statement is required"}), 400

    try:
        sd_agent_factory = SUPPORTED_AGENT_FACTORIES.get(resolved_version, create_sd_agent_v2)
        sd_agent = sd_agent_factory(model=model)
        result = sd_agent.invoke(
            {"messages": [{"role": "user", "content": query}]}
        )

        structured_response = result.get('structured_response')
        parsed_json = structured_response.model_dump() if structured_response is not None else None

        response_content = None
        for message in result.get('messages', []):
            if isinstance(message, AIMessage):
                response_content = getattr(message, 'content', None)
                break

        if parsed_json is None:
            parsed_json = extract_json_payload(response_content)

        logger.info('sd-agent response generated', extra={
            'model': model,
            'version': resolved_version,
            'query': query,
            'parsed_json': parsed_json is not None,
        })

        return jsonify({
            "model": resolve_model(model),
            "version": resolved_version,
            "query": query,
            "json": parsed_json,
            "raw_output": normalize_message_content(response_content),
        })
    except Exception as exc:
        logger.exception('sd-agent request failed', extra={'model': model, 'version': resolved_version, 'query': query})
        return jsonify({"error": str(exc)}), 500


@app.route('/sd-agent', methods=['POST'])
@app.route('/api/sd-agent', methods=['POST'])
def sd_agent_default():
    return execute_sd_agent('v2')


@app.route('/api/<version>/sd-agent', methods=['POST'])
def sd_agent_versioned(version):
    return execute_sd_agent(version)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
