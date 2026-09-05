"""Apply PostgreSQL row-level security to Tuff's tenant tables.

This is *defence in depth*. Tenant isolation is primarily enforced in the API
layer, where every query is filtered by the ``user_id`` taken from a verified
Firebase token. RLS is a second wall so that a missed ``WHERE user_id = ...``
in future code cannot silently return another customer's data.

Run it explicitly, it is not part of application start-up::

    python apply_rls.py --apply
    python apply_rls.py --revert    # roll back if it causes trouble

Two things about the previous version of this script are worth knowing, because
they made it ineffective and, in one case, dangerous:

1. It used ``auth.uid()``, which is a Supabase extension and does not exist on
   plain PostgreSQL or RDS. Every ``CREATE POLICY`` therefore failed while the
   preceding ``ENABLE ROW LEVEL SECURITY`` succeeded -- leaving tables with RLS
   on and no policies at all.
2. It ran every statement inside a single ``engine.begin()`` transaction. In
   PostgreSQL one failed statement aborts the whole transaction, so every
   later statement failed too with "current transaction is aborted" and was
   swallowed by the ``except`` as "might already exist".

The policies below instead key off a session variable that the application
sets, so they work on any PostgreSQL, and each statement runs in its own
transaction so one failure cannot cascade.

Important operational note: the owner of a table bypasses RLS unless
``FORCE ROW LEVEL SECURITY`` is set, which this script deliberately does not
do. If you want the policies to actually bite, have the API connect as a
non-owner role that has been granted DML on these tables, and set the tenant
for each request::

    SET LOCAL app.current_user_id = '<firebase uid>';
"""

import argparse
import logging
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

# Match the loading order the rest of the backend uses so this script talks to
# the same database as the API.
_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env.local"))
load_dotenv(os.path.join(_HERE, ".env"))
load_dotenv(os.path.join(_HERE, os.pardir, ".env"))

from db import engine  # noqa: E402  (must follow load_dotenv)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("apply_rls")

# The session variable the policies compare against. ``true`` as the second
# argument to current_setting makes it return NULL instead of raising when the
# variable has never been set.
TENANT_SETTING = "app.current_user_id"
_TENANT_EXPR = f"current_setting('{TENANT_SETTING}', true)"

# Every table below stores the Firebase uid in a text ``user_id`` column.
TENANT_TABLES = (
    "user_subscriptions",
    "payment_orders",
    "alert_configs",
    "triggered_alerts",
    "infrastructure_logs",
    "execution_logs",
    "action_logs",
)


def _statements_for(table: str) -> list[tuple[str, str]]:
    """Build the (description, SQL) pairs that isolate one table."""
    policy = f"tuff_tenant_isolation_{table}"
    return [
        (
            f"enable RLS on {table}",
            f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        ),
        (
            f"drop existing policy on {table}",
            f'DROP POLICY IF EXISTS "{policy}" ON {table}',
        ),
        (
            f"create tenant policy on {table}",
            # USING filters what a statement can see; WITH CHECK stops a row
            # being written or updated to belong to somebody else. Both are
            # needed -- USING alone would let a caller INSERT under another uid.
            f'CREATE POLICY "{policy}" ON {table} '
            f"FOR ALL "
            f"USING (user_id = {_TENANT_EXPR}) "
            f"WITH CHECK (user_id = {_TENANT_EXPR})",
        ),
    ]


def _revert_statements_for(table: str) -> list[tuple[str, str]]:
    policy = f"tuff_tenant_isolation_{table}"
    return [
        (
            f"drop policy on {table}",
            f'DROP POLICY IF EXISTS "{policy}" ON {table}',
        ),
        (
            f"disable RLS on {table}",
            f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY",
        ),
    ]


def _run(statements: list[tuple[str, str]]) -> int:
    """Execute each statement in its own transaction. Returns the failure count."""
    failures = 0
    for description, sql in statements:
        # A fresh connection-level transaction per statement: a failure here
        # must not poison the statements that follow it.
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
            logger.info("  ok      %s", description)
        except SQLAlchemyError as exc:
            failures += 1
            reason = str(getattr(exc, "orig", exc)).strip().splitlines()[0]
            logger.error("  FAILED  %s -- %s", description, reason)
    return failures


def apply_rls_policies(revert: bool = False) -> int:
    if engine.dialect.name != "postgresql":
        logger.error(
            "Row-level security is a PostgreSQL feature, but this database is "
            "'%s'. Nothing was changed.",
            engine.dialect.name,
        )
        return 1

    build = _revert_statements_for if revert else _statements_for
    verb = "Removing" if revert else "Applying"
    logger.info("%s row-level security on %d tables\n", verb, len(TENANT_TABLES))

    statements: list[tuple[str, str]] = []
    for table in TENANT_TABLES:
        statements.extend(build(table))

    failures = _run(statements)

    logger.info("")
    if failures:
        logger.error(
            "%d of %d statements failed. The database is in a partially "
            "changed state -- read the errors above before retrying, and use "
            "--revert if the API can no longer read its own tables.",
            failures,
            len(statements),
        )
        return 1

    if revert:
        logger.info("Row-level security removed from all tenant tables.")
    else:
        logger.info(
            "Row-level security is active on all tenant tables.\n\n"
            "Remember: a table's owner bypasses RLS. For these policies to "
            "take effect, connect the API as a non-owner role and run\n"
            "    SET LOCAL %s = '<firebase uid>';\n"
            "at the start of each request's transaction.",
            TENANT_SETTING,
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--apply",
        action="store_true",
        help="Enable RLS and install the tenant-isolation policies.",
    )
    group.add_argument(
        "--revert",
        action="store_true",
        help="Drop the policies and disable RLS again.",
    )
    args = parser.parse_args()
    # Required above, so --apply is implied whenever --revert is absent.
    return apply_rls_policies(revert=args.revert)


if __name__ == "__main__":
    sys.exit(main())
