"""Authentication, credential encryption and abuse-protection primitives.

Everything in here fails closed: a misconfigured deployment refuses requests
rather than silently downgrading to an unauthenticated or unencrypted mode.
"""

import base64
import logging
import os
import threading
import time
from collections import deque
from typing import Deque, Dict, Optional
from urllib.parse import urlparse

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding as sym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env.local"))
load_dotenv(os.path.join(_HERE, ".env"))

logger = logging.getLogger(__name__)

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"

FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "").strip()
if not FIREBASE_PROJECT_ID:
    raise RuntimeError(
        "FIREBASE_PROJECT_ID is not set. Tuff cannot verify user identity without it."
    )

FIREBASE_ISSUER = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"

# Firebase mints tokens with a 1 hour lifetime; a small skew allowance keeps
# clients with slightly wrong clocks working without meaningfully widening the
# window in which a stolen token is usable.
_CLOCK_SKEW_SECONDS = 30


# ---------------------------------------------------------------------------
# Credential encryption
# ---------------------------------------------------------------------------
#
# AWS keys are encrypted in the browser before they are written to session
# storage or put on the wire. The key is shared with the browser bundle, so
# this protects against casual inspection of browser storage, accidental
# logging and passive network capture -- it is NOT a defence against an
# attacker who can execute script in the page. Long-lived AWS keys should
# eventually be replaced by cross-account role assumption.

_CIPHERTEXT_PREFIX = "v2"
_raw_encryption_key = os.getenv("ENCRYPTION_KEY", "").strip()

if not _raw_encryption_key:
    if IS_PRODUCTION:
        raise RuntimeError(
            "ENCRYPTION_KEY is not set. Refusing to start in production without it."
        )
    logger.warning(
        "ENCRYPTION_KEY is not set; credential decryption is disabled. "
        "Set it in backend/.env (and NEXT_PUBLIC_ENCRYPTION_KEY in the frontend) "
        "so that AWS keys are not handled in plaintext."
    )
    ENCRYPTION_KEY: Optional[bytes] = None
else:
    if len(_raw_encryption_key) < 16:
        raise RuntimeError("ENCRYPTION_KEY must be at least 16 characters long.")
    ENCRYPTION_KEY = _raw_encryption_key.ljust(32, "0")[:32].encode("utf-8")


class CredentialDecryptionError(Exception):
    """Raised when a credential payload cannot be decrypted."""


def decrypt_credential(value: str, field_name: str = "credential") -> str:
    """Decrypt a ``v2.<iv>.<ciphertext>`` payload produced by the frontend.

    Plaintext is accepted only outside production, so that curl-driven local
    testing keeps working while a real deployment cannot be tricked into
    accepting unencrypted secrets.
    """
    if not value:
        raise CredentialDecryptionError(f"{field_name} is empty")

    if not value.startswith(f"{_CIPHERTEXT_PREFIX}."):
        if IS_PRODUCTION:
            raise CredentialDecryptionError(
                f"{field_name} was not encrypted by the Tuff client"
            )
        return value

    if ENCRYPTION_KEY is None:
        raise CredentialDecryptionError(
            "ENCRYPTION_KEY is not configured on the server, so encrypted "
            "credentials cannot be read"
        )

    parts = value.split(".")
    if len(parts) != 3:
        raise CredentialDecryptionError(f"{field_name} has a malformed envelope")

    try:
        iv = base64.b64decode(parts[1], validate=True)
        ciphertext = base64.b64decode(parts[2], validate=True)
    except Exception as exc:
        raise CredentialDecryptionError(
            f"{field_name} is not valid base64"
        ) from exc

    if len(iv) != 16 or not ciphertext or len(ciphertext) % 16 != 0:
        raise CredentialDecryptionError(f"{field_name} has an invalid block layout")

    try:
        decryptor = Cipher(
            algorithms.AES(ENCRYPTION_KEY), modes.CBC(iv), backend=default_backend()
        ).decryptor()
        padded = decryptor.update(ciphertext) + decryptor.finalize()
        unpadder = sym_padding.PKCS7(algorithms.AES.block_size).unpadder()
        return (unpadder.update(padded) + unpadder.finalize()).decode("utf-8")
    except Exception as exc:
        # A wrong key and corrupted input are indistinguishable here, and
        # neither should reveal anything about the key material.
        raise CredentialDecryptionError(
            f"{field_name} could not be decrypted; reconnect your AWS account"
        ) from exc


# ---------------------------------------------------------------------------
# Firebase ID token verification
# ---------------------------------------------------------------------------

_firebase_admin_ready = False

try:  # pragma: no cover - depends on deployment credentials
    import firebase_admin
    from firebase_admin import auth as firebase_auth

    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"projectId": FIREBASE_PROJECT_ID})
    _firebase_admin_ready = True
    logger.info("Firebase Admin SDK initialised for project %s", FIREBASE_PROJECT_ID)
except Exception as exc:  # pragma: no cover
    logger.warning(
        "Firebase Admin SDK unavailable (%s); falling back to direct ID token "
        "verification against Google's public certificates.",
        exc,
    )

from google.auth.transport import requests as google_requests  # noqa: E402
from google.oauth2 import id_token as google_id_token  # noqa: E402

_google_request = google_requests.Request()

bearer_scheme = HTTPBearer(auto_error=True)


def _verify_with_google_certs(token: str) -> dict:
    """Cryptographically verify a Firebase ID token without the Admin SDK.

    ``verify_firebase_token`` checks the signature against Google's published
    certificates plus ``aud`` and ``exp``; the issuer is asserted here because
    it is what ties the token to this specific Firebase project.
    """
    claims = google_id_token.verify_firebase_token(
        token,
        _google_request,
        audience=FIREBASE_PROJECT_ID,
        clock_skew_in_seconds=_CLOCK_SKEW_SECONDS,
    )
    if not claims:
        raise ValueError("token verification returned no claims")
    if claims.get("iss") != FIREBASE_ISSUER:
        raise ValueError("unexpected token issuer")
    return claims


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    """Resolve the caller's verified Firebase identity.

    Verification is always cryptographic. There is deliberately no
    decode-without-verify path: an unsigned payload is trivially forgeable and
    would let any caller impersonate any user.
    """
    token = credentials.credentials
    claims: Optional[dict] = None
    failure: Optional[Exception] = None

    if _firebase_admin_ready:
        try:
            claims = firebase_auth.verify_id_token(
                token, clock_skew_seconds=_CLOCK_SKEW_SECONDS
            )
        except Exception as exc:
            failure = exc

    if claims is None:
        try:
            claims = _verify_with_google_certs(token)
        except Exception as exc:
            failure = failure or exc
            logger.info("Rejected request with invalid ID token: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your session is invalid or has expired. Please sign in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

    uid = claims.get("uid") or claims.get("user_id") or claims.get("sub")
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is invalid or has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims["uid"] = uid
    return claims


# ---------------------------------------------------------------------------
# Webhook authentication
# ---------------------------------------------------------------------------

AWS_WEBHOOK_SECRET = os.getenv("AWS_WEBHOOK_SECRET", "").strip()

_ALLOWED_SNS_SUFFIXES = (".amazonaws.com", ".amazonaws.com.cn")


def is_trusted_sns_url(url: str) -> bool:
    """Guard the SNS subscription-confirmation callback against SSRF.

    The URL arrives in an unauthenticated request body, so without this check
    an attacker could make the backend issue GETs to arbitrary internal hosts
    (cloud metadata endpoints, admin panels reachable only from the VPC).
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False

    if parsed.scheme != "https" or not parsed.hostname:
        return False

    host = parsed.hostname.lower()
    if not any(host.endswith(suffix) for suffix in _ALLOWED_SNS_SUFFIXES):
        return False
    # Only the SNS control plane legitimately serves these confirmations.
    return host.startswith("sns.")


def verify_webhook_secret(request: Request) -> None:
    """Reject webhook deliveries that do not carry the shared secret."""
    if not AWS_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook ingestion is not configured on this deployment.",
        )

    provided = request.headers.get("x-tuff-webhook-secret", "")
    # Compare with a constant-time primitive so the secret cannot be recovered
    # byte-by-byte through response timing.
    import hmac

    if not hmac.compare_digest(provided, AWS_WEBHOOK_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook credentials.",
        )


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class SlidingWindowLimiter:
    """Per-user sliding-window limiter.

    State is per-process, which is enough to stop a single client hammering
    expensive AWS/AI work. A multi-worker deployment should move this to Redis
    so the budget is shared.
    """

    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> Optional[int]:
        """Record a hit. Returns seconds to wait if the caller is over budget."""
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return max(1, int(bucket[0] + window_seconds - now))
            bucket.append(now)
            if len(self._hits) > 10_000:
                self._evict_locked(cutoff)
        return None

    def _evict_locked(self, cutoff: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] < cutoff]:
            self._hits.pop(key, None)


_limiter = SlidingWindowLimiter()


def rate_limit(limit: int, window_seconds: int, scope: str):
    """Build a dependency that throttles a route per authenticated user."""

    def dependency(current_user: dict = Depends(get_current_user)) -> dict:
        retry_after = _limiter.check(
            f"{scope}:{current_user['uid']}", limit, window_seconds
        )
        if retry_after is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    "You are sending requests faster than Tuff can process them. "
                    f"Please retry in {retry_after}s."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        return current_user

    return dependency
