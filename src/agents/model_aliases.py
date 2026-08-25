MODEL_ALIASES = {
    "gpt": "openai:gpt-5.5",
    "gpt-5.5": "openai:gpt-5.5",
    "claude-f": "anthropic:claude-fable-5",
    "claude": "anthropic:claude-sonnet-5",
    "claude-o": "anthropic:claude-opus-4-8"
}


def resolve_model(model: str) -> str:
    return MODEL_ALIASES.get(model.lower(), model)
