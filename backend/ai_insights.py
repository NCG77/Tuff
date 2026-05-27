from groq import Groq
import json
import os
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

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
            {
                "role": "system",
                "content": "You are an expert AWS FinOps and cloud security analyst."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        temperature=0.3
    )

    return response.choices[0].message.content

def explain_finding(finding: dict) -> dict:
    prompt = f"""Analyze this infrastructure finding and respond in JSON format:
    {{
        "explanation": "Simple 1-2 sentence explanation",
        "business_impact": "How this affects the business",
        "recommended_action": "Specific action to take",
        "priority": "high|medium|low",
        "estimated_savings": "Monthly savings if fixed"
    }}

    Finding:
    {json.dumps(finding, indent=2)}
    Respond ONLY with valid JSON, no markdown."""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are a cloud infrastructure analyst. Respond only with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.2
        )
        
        response_text = response.choices[0].message.content
        
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            if "```json" in response_text:
                json_str = response_text.split("```json")[1].split("```")[0].strip()
                return json.loads(json_str)
            else:
                return {
                    "explanation": response_text,
                    "business_impact": "Impact TBD",
                    "recommended_action": "Review finding manually",
                    "priority": "medium",
                    "estimated_savings": "TBD"
                }
    except Exception as e:
        return {
            "explanation": f"Error: {str(e)}",
            "business_impact": "Unknown",
            "recommended_action": "Review manually",
            "priority": "unknown",
            "estimated_savings": "0"
        }

if __name__ == "__main__":
    #this is sample data for simulation
    engine_data = {
        "resource_type": "EC2",
        "resource_id": "i-123",
        "issue": "Idle Instance",
        "severity": "medium",
        "metrics": {
            "cpu_avg": 2,
            "network_activity": 0
        },
        "estimated_monthly_cost": 120,
        "recommendation": "Consider stopping or downsizing"
    }
    
    result = analyze_infrastructure(engine_data)
    print(result)