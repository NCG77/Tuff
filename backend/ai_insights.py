import json
import logging
import os
import re
from typing import Optional, Tuple

import openai
from openai import OpenAI
from dotenv import load_dotenv

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env.local"))
load_dotenv(os.path.join(_HERE, ".env"))

logger = logging.getLogger(__name__)

# Approximate credit cost of analysing a single finding. Exposed so the API
# layer can budget a scan up front instead of running out of credits midway.
CREDITS_PER_FINDING = 100

_openrouter_key = os.getenv("OPENROUTER_API_KEY")
_groq_key = os.getenv("GROQ_API_KEY")

client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=_openrouter_key) if _openrouter_key else None
groq_client = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=_groq_key) if _groq_key else None

PRIMARY_MODEL = "openrouter/auto"
FALLBACK_MODEL = "llama-3.3-70b-versatile"

_PARSER_SYSTEM_PROMPT = "You are an automated cloud data parser. Respond exclusively with valid JSON."
_VALID_PRIORITIES = {"high", "medium", "low"}


def ai_configured() -> bool:
    return client is not None or groq_client is not None


def sanitize_payload(data):
    """
    Recursively redacts sensitive information from the payload to prevent data leakage to AI providers.
    This acts as a security and preprocessing layer.
    """
    sensitive_keys = {'password', 'secret', 'key', 'token', 'credentials', 'auth', 'authorization', 'api_key', 'access_key', 'private_key'}

    def is_empty(value) -> bool:
        # Compared by identity/type rather than ``value in [None, "", [], {}]``
        # so that meaningful zeros and False are not silently dropped.
        return value is None or (isinstance(value, (str, list, dict, tuple)) and len(value) == 0)

    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            # Skip empty values to save AI tokens and reduce noise
            if is_empty(v):
                continue

            if any(sensitive in str(k).lower() for sensitive in sensitive_keys):
                sanitized[k] = "[REDACTED FOR SECURITY]"
            else:
                sanitized[k] = sanitize_payload(v)
        return sanitized
    elif isinstance(data, list):
        return [sanitize_payload(item) for item in data if not is_empty(item)]
    else:
        return data


def _coerce_savings(value, fallback: float) -> float:
    """Pull a number out of whatever the model produced.

    Models regularly ignore the "raw number only" instruction and answer with
    prose like "around $45 per month". Rendering that straight into the UI
    produced strings such as "$around $45 per month/mo" and broke the savings
    total, so the value is normalised here instead.
    """
    if isinstance(value, (int, float)):
        return round(max(0.0, float(value)), 2)
    if isinstance(value, str):
        match = re.search(r"\d+(?:\.\d+)?", value.replace(",", ""))
        if match:
            return round(max(0.0, float(match.group())), 2)
    return round(max(0.0, float(fallback)), 2)


def _build_prompt(minified_payload: str) -> str:
    return f"""Analyze this cloud infrastructure finding and respond exactly within this JSON schema structure:
    {{
        "explanation": "Simple 1-2 sentence explanation detailing what the asset is.",
        "business_impact": "How this affects the business operation or billing profile.",
        "recommended_action": "Specific programmatic remediation step to take.",
        "priority": "high|medium|low",
        "estimated_savings": "Clean string representing only a raw numeric value of monthly savings. No prose sentences."
    }}

    CRITICAL RULES:
    1. The 'estimated_savings' value MUST ONLY contain a raw number string.
    2. NEVER return conversational text inside the 'estimated_savings' field.

    <cloud_asset_finding_payload>
    {minified_payload}
    </cloud_asset_finding_payload>
    """


def _chat(active_client: OpenAI, model: str, system: str, prompt: str, json_mode: bool, temperature: float):
    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    return active_client.chat.completions.create(**kwargs)


def explain_finding(finding: dict) -> Tuple[dict, int]:
    """Turn a raw scanner finding into human-facing analysis.

    Returns the analysis plus the credits it consumed. This function is called
    from a thread pool, so it deliberately performs no database work: the
    caller applies the credit deduction once, on the request thread, where the
    SQLAlchemy session is safe to touch.
    """
    if not ai_configured():
        raise RuntimeError(
            "ERROR_UPSTREAM_API: No AI provider is configured. Set OPENROUTER_API_KEY or GROQ_API_KEY."
        )

    # Preprocess, secure, and minify payload before sending to external AI models
    sanitized_finding = sanitize_payload(finding)
    minified_payload = json.dumps(sanitized_finding, separators=(',', ':'))
    prompt = _build_prompt(minified_payload)

    response = None
    primary_error: Optional[Exception] = None

    if client is not None:
        try:
            response = _chat(client, PRIMARY_MODEL, _PARSER_SYSTEM_PROMPT, prompt, True, 0.1)
        except openai.RateLimitError as e:
            raise RuntimeError(f"ERROR_QUOTA_EXCEEDED: Account token limit breached. ({e})")
        except openai.APIStatusError as e:
            if e.status_code not in (402, 403):
                raise RuntimeError(f"ERROR_UPSTREAM_API: AI Provider error occurred. ({e})")
            primary_error = e
        except Exception as e:
            raise RuntimeError(f"ERROR_INTERNAL_PARSING: Failed to process infrastructure payload. ({e})")

    if response is None and groq_client is not None:
        try:
            response = _chat(groq_client, FALLBACK_MODEL, _PARSER_SYSTEM_PROMPT, prompt, True, 0.1)
        except Exception as fallback_e:
            if primary_error is not None:
                raise RuntimeError(
                    "ERROR_INSUFFICIENT_FUNDS: OpenRouter account lacks credits and Groq "
                    f"fallback failed. ({primary_error}) - {fallback_e}"
                )
            raise RuntimeError(f"ERROR_UPSTREAM_API: AI Provider error occurred. ({fallback_e})")

    if response is None:
        if primary_error is not None:
            raise RuntimeError(f"ERROR_INSUFFICIENT_FUNDS: AI provider rejected the request. ({primary_error})")
        raise RuntimeError("ERROR_INTERNAL_PARSING: No response generated from AI providers.")

    raw_content = (response.choices[0].message.content or "").strip()
    try:
        parsed = json.loads(raw_content)
        if not isinstance(parsed, dict):
            raise ValueError("expected a JSON object")
    except Exception:
        logger.warning("AI returned unparseable content for %s", finding.get("resource_id"))
        raise RuntimeError("ERROR_INTERNAL_PARSING: AI returned a malformed analysis payload.")

    priority = str(parsed.get("priority", "medium")).strip().lower()
    fallback_savings = finding.get("estimated_monthly_cost", 0) or 0

    analysis = {
        "explanation": str(parsed.get("explanation") or "Manual review recommended."),
        "business_impact": str(parsed.get("business_impact") or "Unknown risk profile."),
        "recommended_action": str(
            parsed.get("recommended_action") or finding.get("recommendation") or "Investigate resource configuration."
        ),
        "priority": priority if priority in _VALID_PRIORITIES else "medium",
        "estimated_savings": _coerce_savings(parsed.get("estimated_savings"), fallback_savings),
    }
    return analysis, CREDITS_PER_FINDING


def humanize_insight(explanation: str, business_impact: str, recommended_action: str) -> str:
    """
    Takes technical insights and converts them into simple plain English.
    """
    if not ai_configured():
        return "Plain-English summaries are unavailable because no AI provider is configured."

    prompt = f"""Rewrite the following cloud infrastructure finding into a very simple, humanized, plain English explanation. Avoid technical jargon. Explain why the suggested changes are good for a non-technical person.
    
    Explanation: {explanation}
    Business Impact: {business_impact}
    Recommended Action: {recommended_action}
    
    Respond with ONLY the simple explanation paragraph. No JSON, no markdown formatting, just plain text.
    """
    system = (
        "You are a helpful assistant who explains technical cloud concepts to "
        "non-technical users in simple plain English."
    )

    for active_client, model in ((client, PRIMARY_MODEL), (groq_client, FALLBACK_MODEL)):
        if active_client is None:
            continue
        try:
            response = _chat(active_client, model, system, prompt, False, 0.7)
            content = (response.choices[0].message.content or "").strip()
            if content:
                return content
        except Exception as e:
            logger.info("Humanize attempt via %s failed: %s", model, e)

    return "Failed to humanize the insight due to an AI provider error."
