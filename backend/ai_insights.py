import json
import os
import base64
import openai
from openai import OpenAI
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from db import UserSubscription

load_dotenv()

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY")
)

groq_client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.getenv("GROQ_API_KEY")
)

def sanitize_payload(data):
    """
    Recursively redacts sensitive information from the payload to prevent data leakage to AI providers.
    This acts as a security and preprocessing layer.
    """
    sensitive_keys = {'password', 'secret', 'key', 'token', 'credentials', 'auth', 'authorization', 'api_key', 'access_key', 'private_key'}
    
    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            # Skip empty values to save AI tokens and reduce noise
            if v in [None, "", [], {}]:
                continue
                
            if any(sensitive in str(k).lower() for sensitive in sensitive_keys):
                sanitized[k] = "[REDACTED FOR SECURITY]"
            else:
                sanitized[k] = sanitize_payload(v)
        return sanitized
    elif isinstance(data, list):
        return [sanitize_payload(item) for item in data if item not in [None, "", [], {}]]
    else:
        return data

def encode_image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def build_dynamic_payload(text_prompt: str, image_path: str = None) -> list:
    content = [{"type": "text", "text": text_prompt}]
    if image_path and os.path.exists(image_path):
        base64_img = encode_image_to_base64(image_path)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{base64_img}"}
        })
    return content

def explain_finding(finding: dict, user_record: UserSubscription, db: Session, image_path: str = None) -> dict:
    """
    Headless processing pipeline unit. 
    Ingests cloud asset state and outputs strict, machine-readable JSON optimization data.
    """
    if user_record.credits <= 0 and user_record.subscription_tier == "free":
        raise RuntimeError("ERROR_SESSION_LIMIT_EXCEEDED: You have reached the credit limit for your free tier. Please upgrade to Pro or purchase credits.")
    
    model_name = "openrouter/auto"
    
    # Preprocess, secure, and minify payload before sending to external AI models
    sanitized_finding = sanitize_payload(finding)
    minified_payload = json.dumps(sanitized_finding, separators=(',', ':'))

    prompt = f"""Analyze this cloud infrastructure finding and respond exactly within this JSON schema structure:
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

    response = None
    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "You are an automated cloud data parser. Respond exclusively with valid JSON."
                },
                {
                    "role": "user",
                    "content": build_dynamic_payload(prompt, image_path)
                }
            ],
            response_format={"type": "json_object"}, 
            temperature=0.1
        )
    except openai.APIStatusError as e:
        if e.status_code in (402, 403):
            try:
                response = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an automated cloud data parser. Respond exclusively with valid JSON."
                        },
                        {
                            "role": "user",
                            "content": build_dynamic_payload(prompt, image_path)
                        }
                    ],
                    response_format={"type": "json_object"}, 
                    temperature=0.1
                )
            except Exception as fallback_e:
                raise RuntimeError(f"ERROR_INSUFFICIENT_FUNDS: OpenRouter account lacks credits and Groq fallback failed. ({str(e)}) - {str(fallback_e)}")
        else:
            raise RuntimeError(f"ERROR_UPSTREAM_API: AI Provider error occurred. ({str(e)})")
    except openai.RateLimitError as e:
        raise RuntimeError(f"ERROR_QUOTA_EXCEEDED: Account token limit breached. ({str(e)})")
    except Exception as e:
        raise RuntimeError(f"ERROR_INTERNAL_PARSING: Failed to process infrastructure payload. ({str(e)})")
        
    if response:
        if user_record.credits > 0:
            user_record.credits -= 100  # token usage approximation
            # Removed db.commit() to prevent SQLAlchemy concurrent transaction errors across threads.
            # The session commit is handled gracefully in the parent endpoint.

        return json.loads(response.choices[0].message.content)
    else:
        raise RuntimeError("ERROR_INTERNAL_PARSING: No response generated from AI providers.")

def humanize_insight(explanation: str, business_impact: str, recommended_action: str) -> str:
    """
    Takes technical insights and converts them into simple plain English.
    """
    model_name = "openrouter/auto"
    
    prompt = f"""Rewrite the following cloud infrastructure finding into a very simple, humanized, plain English explanation. Avoid technical jargon. Explain why the suggested changes are good for a non-technical person.
    
    Explanation: {explanation}
    Business Impact: {business_impact}
    Recommended Action: {recommended_action}
    
    Respond with ONLY the simple explanation paragraph. No JSON, no markdown formatting, just plain text.
    """

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant who explains technical cloud concepts to non-technical users in simple plain English."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.7
        )
        return response.choices[0].message.content.strip()
    except openai.APIStatusError as e:
        if e.status_code in (402, 403):
            try:
                response = groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a helpful assistant who explains technical cloud concepts to non-technical users in simple plain English."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    temperature=0.7
                )
                return response.choices[0].message.content.strip()
            except Exception:
                return "Failed to humanize the insight due to an AI provider error."
        return "Failed to humanize the insight due to an AI provider error."
    except Exception:
        return "Failed to humanize the insight due to an internal error."