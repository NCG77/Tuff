import json
import logging
import os
import re
from typing import List, Optional, Tuple

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


def _clean_key(raw: Optional[str]) -> Optional[str]:
    value = (raw or "").strip()
    if not value or "your_" in value.lower() or value.endswith("_here"):
        return None
    return value


_openrouter_key = _clean_key(os.getenv("OPENROUTER_API_KEY"))
_groq_key = _clean_key(os.getenv("GROQ_API_KEY"))

openrouter_client = (
    OpenAI(base_url="https://openrouter.ai/api/v1", api_key=_openrouter_key)
    if _openrouter_key
    else None
)
groq_client = (
    OpenAI(base_url="https://api.groq.com/openai/v1", api_key=_groq_key)
    if _groq_key
    else None
)

# Keep aliases used elsewhere in the module.
client = openrouter_client

# OpenRouter is primary when configured; Groq is the fallback. A dead
# OpenRouter key used to 403 and falsely trigger the Upgrade modal — that path
# is now classified as ERROR_UPSTREAM_API, not a Tuff billing upsell.
# Prefer explicit JSON-capable models before openrouter/auto — auto often
# returns prose/markdown that fails the analysis schema parse.
OPENROUTER_MODELS = (
    "openai/gpt-4o-mini",
    "google/gemini-2.0-flash-001",
    "openrouter/auto",
)
# Prefer models commonly available on free/dev Groq keys. Llama IDs 404 on
# some accounts; gpt-oss is what succeeded with the current key.
GROQ_MODELS = (
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
)

_PARSER_SYSTEM_PROMPT = "You are an automated cloud data parser. Respond exclusively with valid JSON."
_VALID_PRIORITIES = {"high", "medium", "low"}


def ai_configured() -> bool:
    return openrouter_client is not None or groq_client is not None


def _provider_chain() -> List[Tuple[str, OpenAI, Tuple[str, ...]]]:
    """Ordered (label, client, models) attempts for analysis calls."""
    chain: List[Tuple[str, OpenAI, Tuple[str, ...]]] = []
    if openrouter_client is not None:
        chain.append(("openrouter", openrouter_client, OPENROUTER_MODELS))
    if groq_client is not None:
        chain.append(("groq", groq_client, GROQ_MODELS))
    return chain


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


def _classify_provider_error(exc: Exception) -> str:
    """Map provider failures to stable error markers for the API layer.

    Only real rate limits become ERROR_QUOTA_EXCEEDED. Billing on the *provider*
    account is ERROR_UPSTREAM_API — never ERROR_INSUFFICIENT_FUNDS, which the
    frontend used to treat as "user must upgrade Tuff".
    """
    if isinstance(exc, openai.RateLimitError):
        # OpenAI/Groq often raise RateLimitError for empty provider wallets
        # ("insufficient_quota"). That is an operator billing problem — never a
        # Tuff Pro upsell — so classify it as upstream, not quota.
        text = str(exc).lower()
        if any(
            marker in text
            for marker in ("insufficient", "quota", "billing", "payment", "credit", "funds")
        ):
            return f"ERROR_UPSTREAM_API: AI provider billing/credits are exhausted. ({exc})"
        return f"ERROR_QUOTA_EXCEEDED: AI provider rate limit hit. ({exc})"
    if isinstance(exc, openai.AuthenticationError):
        return f"ERROR_UPSTREAM_API: AI provider rejected the API key. ({exc})"
    if isinstance(exc, openai.NotFoundError):
        return f"ERROR_UPSTREAM_API: AI model or endpoint was not found. ({exc})"
    if isinstance(exc, openai.APIStatusError):
        if exc.status_code in (401, 403):
            return f"ERROR_UPSTREAM_API: AI provider rejected the API key. ({exc})"
        if exc.status_code == 402:
            return f"ERROR_UPSTREAM_API: AI provider billing/credits are exhausted. ({exc})"
        if exc.status_code == 429:
            return f"ERROR_QUOTA_EXCEEDED: AI provider rate limit hit. ({exc})"
        return f"ERROR_UPSTREAM_API: AI provider error occurred. ({exc})"
    return f"ERROR_UPSTREAM_API: AI provider error occurred. ({exc})"


def _extract_json_object(raw_content: str) -> dict:
    """Parse a JSON object from model output, including markdown-fenced replies."""
    text = (raw_content or "").strip()
    if not text:
        raise ValueError("empty model response")

    # Strip ```json ... ``` / ``` ... ``` wrappers that models often add.
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fenced:
        text = fenced.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Last resort: take the outermost {...} block.
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])

    if not isinstance(parsed, dict):
        raise ValueError("expected a JSON object")
    return parsed


def _complete_with_providers(system: str, prompt: str, json_mode: bool, temperature: float):
    """Try OpenRouter then Groq across configured models; raise a classified error."""
    errors: List[str] = []
    chain = _provider_chain()
    if not chain:
        raise RuntimeError(
            "ERROR_UPSTREAM_API: No AI provider is configured. Set GROQ_API_KEY or OPENROUTER_API_KEY."
        )

    for label, active_client, models in chain:
        for model in models:
            try:
                response = _chat(active_client, model, system, prompt, json_mode, temperature)
                logger.info("AI call succeeded via %s model=%s", label, model)
                return response
            except Exception as exc:
                classified = _classify_provider_error(exc)
                logger.warning("AI call failed via %s model=%s: %s", label, model, classified)
                errors.append(f"{label}/{model}: {classified}")
                # Auth failures on this provider: skip remaining models for it.
                if isinstance(exc, (openai.AuthenticationError,)) or (
                    isinstance(exc, openai.APIStatusError) and exc.status_code in (401, 403)
                ):
                    break

    # Prefer quota marker if every attempt was rate-limited; otherwise upstream.
    if errors and all("ERROR_QUOTA_EXCEEDED" in err for err in errors):
        raise RuntimeError(errors[-1])
    raise RuntimeError(
        "ERROR_UPSTREAM_API: All configured AI providers failed. " + " | ".join(errors[-3:])
    )


def _complete_analysis_json(prompt: str) -> dict:
    """Call providers until one returns parseable analysis JSON.

    Some routed models (notably openrouter/auto) accept the request and return
    200 with prose instead of a JSON object. Treating that as success left the
    UI stuck on the degraded stub even when later models would have worked.
    """
    errors: List[str] = []
    chain = _provider_chain()
    if not chain:
        raise RuntimeError(
            "ERROR_UPSTREAM_API: No AI provider is configured. Set GROQ_API_KEY or OPENROUTER_API_KEY."
        )

    # Prefer strict JSON mode first; fall back to free-form if the model rejects
    # response_format or still returns fenced/prose JSON.
    mode_attempts = (True, False)

    for label, active_client, models in chain:
        for model in models:
            auth_failed = False
            for use_json_mode in mode_attempts:
                try:
                    response = _chat(
                        active_client, model, _PARSER_SYSTEM_PROMPT, prompt, use_json_mode, 0.1
                    )
                    raw_content = (response.choices[0].message.content or "").strip()
                    parsed = _extract_json_object(raw_content)
                    logger.info(
                        "AI analysis JSON ok via %s model=%s json_mode=%s",
                        label,
                        model,
                        use_json_mode,
                    )
                    return parsed
                except Exception as exc:
                    if isinstance(exc, (json.JSONDecodeError, ValueError, TypeError)):
                        logger.warning(
                            "AI analysis unparseable via %s model=%s json_mode=%s: %s",
                            label,
                            model,
                            use_json_mode,
                            exc,
                        )
                        errors.append(f"{label}/{model}: ERROR_INTERNAL_PARSING: {exc}")
                        continue

                    classified = _classify_provider_error(exc)
                    logger.warning(
                        "AI call failed via %s model=%s json_mode=%s: %s",
                        label,
                        model,
                        use_json_mode,
                        classified,
                    )
                    errors.append(f"{label}/{model}: {classified}")
                    if isinstance(exc, (openai.AuthenticationError,)) or (
                        isinstance(exc, openai.APIStatusError) and exc.status_code in (401, 403)
                    ):
                        auth_failed = True
                        break
                    # response_format unsupported → try without json_mode next.
                    continue
            if auth_failed:
                break

    if errors and all("ERROR_QUOTA_EXCEEDED" in err for err in errors):
        raise RuntimeError(errors[-1])
    if errors and all("ERROR_INTERNAL_PARSING" in err for err in errors):
        raise RuntimeError(
            "ERROR_INTERNAL_PARSING: All AI providers returned malformed analysis. "
            + " | ".join(errors[-3:])
        )
    raise RuntimeError(
        "ERROR_UPSTREAM_API: All configured AI providers failed. " + " | ".join(errors[-3:])
    )


def explain_finding(finding: dict) -> Tuple[dict, int]:
    """Turn a raw scanner finding into human-facing analysis.

    Returns the analysis plus the credits it consumed. This function is called
    from a thread pool, so it deliberately performs no database work: the
    caller applies the credit deduction once, on the request thread, where the
    SQLAlchemy session is safe to touch.
    """
    if not ai_configured():
        raise RuntimeError(
            "ERROR_UPSTREAM_API: No AI provider is configured. Set GROQ_API_KEY or OPENROUTER_API_KEY."
        )

    # Preprocess, secure, and minify payload before sending to external AI models
    sanitized_finding = sanitize_payload(finding)
    minified_payload = json.dumps(sanitized_finding, separators=(',', ':'))
    prompt = _build_prompt(minified_payload)

    parsed = _complete_analysis_json(prompt)

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

    try:
        response = _complete_with_providers(system, prompt, False, 0.7)
        content = (response.choices[0].message.content or "").strip()
        if content:
            return content
    except Exception as e:
        logger.info("Humanize failed: %s", e)

    return "Failed to humanize the insight due to an AI provider error."
