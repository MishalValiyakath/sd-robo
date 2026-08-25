# pip install -qU langchain "langchain[openai]"
import argparse
import json
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote_plus
from urllib.request import urlopen

from langchain_core.messages import AIMessage
from agents.sd_agent_v1 import create_sd_agent_v1
from agents.sd_agent_v2 import create_sd_agent_v2

AGENT_CREATORS = {
    "v1": create_sd_agent_v1,
    "v2": create_sd_agent_v2,
}
# from langchain_core.globals import set_debug

# set_debug(True)

def run_agent(prompt: str = "Housing Market Dynamics", model: str = "gpt", version: str = "v2"):
    weatherInfo = None
    stop_loading = threading.Event()

    def loading_indicator() -> None:
        dots = 0
        while not stop_loading.is_set():
            dots = (dots % 5) + 1
            sys.stdout.write(f"\rLoading{'.' * dots}   ")
            sys.stdout.flush()
            time.sleep(0.5)
        sys.stdout.write("\r" + " " * 20 + "\r")
        sys.stdout.flush()

    loader_thread = threading.Thread(target=loading_indicator, daemon=True)
    loader_thread.start()

    try:
        agent_factory = AGENT_CREATORS.get(version.lower(), create_sd_agent_v2)
        weather_agent = agent_factory(model=model)
        result = weather_agent.invoke(
            {"messages": [{"role": "user", "content": prompt}]}
        )

        weatherInfo = None
        for m in result["messages"]:
            if isinstance(m, AIMessage):
                weatherInfo = getattr(m, "content", None)

    finally:
        stop_loading.set()
        loader_thread.join()

    print(f"{weatherInfo}")

def main() -> None:
    parser = argparse.ArgumentParser(description="Run the SD Agent")
    parser.add_argument("--query", dest="query", default=None, help="Custom query for the SD agent")
    parser.add_argument("--model", dest="model", default="gpt", help="Model for the SD agent: gpt, claude, gemini, or provider-specific string")
    parser.add_argument("--version", dest="version", default="v2", choices=["v1", "v2"], help="Agent version to run")
    args = parser.parse_args()

    if args.query:
        run_agent(args.query, model=args.model, version=args.version)
    else:
        prompt = "Housing Market Dynamics"
        run_agent(prompt, model=args.model, version=args.version)


if __name__ == "__main__":
    main()