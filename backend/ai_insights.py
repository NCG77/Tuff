from groq import Groq
import json
import os
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

def explain_finding(finding: dict) -> dict:
    # UPDATED PROMPT: Enforcing strict numeric value formatting for the savings key
    prompt = f"""Analyze this cloud infrastructure finding and respond exactly within this JSON schema structure:
    {{
        "explanation": "Simple 1-2 sentence explanation detailing what the asset is.",
        "business_impact": "How this affects the business operation or billing profile.",
        "recommended_action": "Specific programmatic remediation step to take.",
        "priority": "high|medium|low",
        "estimated_savings": "Clean string representing only a raw numeric value of monthly savings. No prose sentences."
    }}

    CRITICAL RULES:
    1. The 'estimated_savings' value MUST ONLY contain a raw number string (e.g., "0.08" or "80" or "120"). 
    2. NEVER return conversational text or explanations like "The cost of a 1GB gp3 volume..." inside the 'estimated_savings' field.

    Cloud Asset Finding Payload:
    {json.dumps(finding, indent=2)}
    """

    try:
        # Utilizing Groq's native JSON Mode response schema formatting configuration
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a cloud infrastructure analyst. You must respond exclusively with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            response_format={"type": "json_object"}, # Forces the LLM to output pristine parseable JSON
            temperature=0.1 # Lowered temperature for deterministic keyword output adherence
        )
        
        response_text = response.choices[0].message.content
        return json.loads(response_text)

    except Exception as e:
        print(f"Error executing Groq payload extraction: {str(e)}")
        return {
            "explanation": "Manual review recommended for target infrastructure footprint asset.",
            "business_impact": "Accumulating continuous passive burn on active subscription tiers.",
            "recommended_action": "Investigate source instantiation lifecycle parameters.",
            "priority": "medium",
            "estimated_savings": "0.08" # Defensive absolute fallback baseline string representation
        }


# Keep the analyze function at the bottom for local sandbox script unit test execution
def analyze_infrastructure(engine_data):
    prompt = f"""
        You are a cloud FinOps AI assistant.
        Analyze this cloud infrastructure finding and generate:
        1. Simple explanation
        2. Business impact
        3. Recommended action
        
        Data:
        {json.dumps(engine_data, indent=2)}
    """
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": "You are an expert AWS FinOps and cloud security analyst."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.3
    )
    return response.choices[0].message.content

if __name__ == "__main__":
    engine_data = {
        "resource_type": "EC2",
        "resource_id": "i-123",
        "issue": "Idle Instance",
        "severity": "medium",
        "metrics": {"cpu_avg": 2, "network_activity": 0},
        "estimated_monthly_cost": 120,
        "recommendation": "Consider stopping or downsizing"
    }
    print(explain_finding(engine_data))