import json
import os
import base64
import openai
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY")
)

TIER_LIMITS = {
    "free": 30000,     
    "premium": 250000  
}

class DynamicTokenLimiter:
    """Safeguard that updates thresholds on the fly based on Free vs Premium."""
    def __init__(self):
        self.tokens_consumed = 0
        self.max_session_tokens = TIER_LIMITS["free"] 

    def configure_session_tier(self, tier_name: str):
        """Sets the boundary cap dynamically at the start of a scan."""
        normalized_tier = str(tier_name).lower().strip()
        self.max_session_tokens = TIER_LIMITS.get(normalized_tier, TIER_LIMITS["free"])
        self.tokens_consumed = 0

    def verify_allowance(self):
        if self.tokens_consumed >= self.max_session_tokens:
            raise RuntimeError("ERROR_SESSION_LIMIT_EXCEEDED: You have reached the token limit for your current tier.")

    def log_usage(self, usage_data):
        if usage_data:
            self.tokens_consumed += usage_data.total_tokens

session_tracker = DynamicTokenLimiter()

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

def explain_finding(finding: dict, image_path: str = None) -> dict:
    """
    Headless processing pipeline unit. 
    Ingests cloud asset state and outputs strict, machine-readable JSON optimization data.
    """
    session_tracker.verify_allowance()

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
            model="openrouter/free",
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
        
        session_tracker.log_usage(response.usage)
        return json.loads(response.choices[0].message.content)

    except openai.RateLimitError as e:
        raise RuntimeError(f"ERROR_QUOTA_EXCEEDED: Account token limit breached. ({str(e)})")
        
    except openai.APIStatusError as e:
        if e.status_code == 402:
            raise RuntimeError(f"ERROR_INSUFFICIENT_FUNDS: OpenRouter account lacks credits. ({str(e)})")
        raise RuntimeError(f"ERROR_UPSTREAM_API: AI Provider error occurred. ({str(e)})")
        
    except Exception as e:
        raise RuntimeError(f"ERROR_INTERNAL_PARSING: Failed to process infrastructure payload. ({str(e)})")