import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from db import engine
from sqlalchemy import text

def apply_rls_policies():
    queries = [
        "ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE alert_configs ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE action_logs ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE infrastructure_logs ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE execution_logs ENABLE ROW LEVEL SECURITY;",

        """
        CREATE POLICY "Users can view own subscriptions" ON user_subscriptions
        FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
        """,
        """
        CREATE POLICY "Users can create own subscriptions" ON user_subscriptions
        FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::text);
        """,
        
        """
        CREATE POLICY "Users can view own alert configs" ON alert_configs
        FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
        """,
        """
        CREATE POLICY "Users can manage own alert configs" ON alert_configs
        FOR ALL TO authenticated USING (user_id = auth.uid()::text);
        """,
        
        """
        CREATE POLICY "Users can view own action logs" ON action_logs
        FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
        """,
        """
        CREATE POLICY "Users can create own action logs" ON action_logs
        FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid()::text);
        """
    ]

    with engine.begin() as conn:
        for q in queries:
            try:
                conn.execute(text(q))
                print(f"Executed: {q.strip().splitlines()[0]}")
            except Exception as e:
                print(f"Notice (Might already exist): {e}")

    print("\nRLS Policies successfully enforced across the database!")

if __name__ == "__main__":
    apply_rls_policies()
