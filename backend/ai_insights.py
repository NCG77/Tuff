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

    Cloud Asset Finding Payload:
    {json.dumps(finding, indent=2)}
    """

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
        
        if user_record.credits > 0:
            user_record.credits -= 100  # token usage approximation
            db.commit()

        return json.loads(response.choices[0].message.content)

    except openai.RateLimitError as e:
        raise RuntimeError(f"ERROR_QUOTA_EXCEEDED: Account token limit breached. ({str(e)})")
        
    except openai.APIStatusError as e:
        if e.status_code == 402:
            raise RuntimeError(f"ERROR_INSUFFICIENT_FUNDS: OpenRouter account lacks credits. ({str(e)})")
        raise RuntimeError(f"ERROR_UPSTREAM_API: AI Provider error occurred. ({str(e)})")
        
    except Exception as e:
        raise RuntimeError(f"ERROR_INTERNAL_PARSING: Failed to process infrastructure payload. ({str(e)})")