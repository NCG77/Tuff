"""Unit tests for backend security primitives: credential decryption, token caching, SNS validation, and rate limiting."""

import base64
import os
import sys
import time
from unittest.mock import MagicMock, patch

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding as sym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

# Ensure backend directory is in python path
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

import security
from security import (
    _token_cache_get,
    _token_cache_put,
    decrypt_credential,
    is_trusted_sns_url,
    SlidingWindowLimiter,
)


def _encrypt_for_test(plaintext: str, key_bytes: bytes) -> str:
    """Helper to encrypt plaintext into v2.<iv>.<ciphertext> matching security.py format."""
    iv = os.urandom(16)
    padder = sym_padding.PKCS7(128).padder()
    padded_data = padder.update(plaintext.encode("utf-8")) + padder.finalize()

    cipher = Cipher(algorithms.AES(key_bytes), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_data) + encryptor.finalize()

    iv_b64 = base64.b64encode(iv).decode("utf-8")
    ct_b64 = base64.b64encode(ciphertext).decode("utf-8")
    return f"v2.{iv_b64}.{ct_b64}"


class TestCredentialDecryption:
    """Test AES-256-CBC credential decryption in security.py."""

    def test_decrypt_valid_credential(self):
        test_key = b"0123456789abcdef0123456789abcdef"
        secret_plaintext = "AKIAEXAMPLE123456789"
        encrypted = _encrypt_for_test(secret_plaintext, test_key)

        with patch.object(security, "ENCRYPTION_KEY", test_key):
            decrypted = decrypt_credential(encrypted, "aws_access_key")
            assert decrypted == secret_plaintext

    def test_decrypt_empty_credential_raises(self):
        with pytest.raises(Exception):
            decrypt_credential("", "aws_access_key")

    def test_decrypt_missing_encryption_key_raises(self):
        with patch.object(security, "ENCRYPTION_KEY", None):
            with pytest.raises(Exception):
                decrypt_credential("v2.aXY=.Y2lwaGVy", "aws_access_key")

    def test_decrypt_plaintext_in_development_returns_value(self):
        with patch.object(security, "IS_PRODUCTION", False):
            res = decrypt_credential("AKIA_RAW_KEY_PLAINTEXT", "aws_access_key")
            assert res == "AKIA_RAW_KEY_PLAINTEXT"

    def test_decrypt_plaintext_in_production_raises(self):
        with patch.object(security, "IS_PRODUCTION", True):
            with pytest.raises(Exception):
                decrypt_credential("AKIA_RAW_KEY_PLAINTEXT", "aws_access_key")


class TestTokenCache:
    """Test in-memory token cache mechanism."""

    def test_token_cache_put_and_get(self):
        token = "test-token-xyz-123"
        claims = {"uid": "user123", "exp": time.time() + 3600}

        _token_cache_put(token, claims)
        cached = _token_cache_get(token)
        assert cached is not None
        assert cached["uid"] == "user123"

    def test_token_cache_expired(self):
        token = "test-token-expired"
        claims = {"uid": "user_exp", "exp": time.time() - 100}

        _token_cache_put(token, claims)
        cached = _token_cache_get(token)
        assert cached is None


class TestSNSValidation:
    """Test AWS SNS HTTPS callback URL trust verification."""

    def test_trusted_sns_urls(self):
        assert is_trusted_sns_url("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-xyz") is True
        assert is_trusted_sns_url("https://sns.eu-west-1.amazonaws.com.cn/test") is True

    def test_untrusted_sns_urls(self):
        # Non-https
        assert is_trusted_sns_url("http://sns.us-east-1.amazonaws.com/test") is False
        # Spoofed domain
        assert is_trusted_sns_url("https://sns.us-east-1.amazonaws.com.attacker.com/test") is False
        assert is_trusted_sns_url("https://evil.com") is False
        assert is_trusted_sns_url("") is False


class TestSlidingWindowLimiter:
    """Test the in-memory sliding window rate limiter."""

    def test_rate_limiter_allows_under_limit(self):
        limiter = SlidingWindowLimiter()
        # limit 3 per 60 seconds
        retry_after1 = limiter.check("user-1", limit=3, window_seconds=60)
        assert retry_after1 is None
        retry_after2 = limiter.check("user-1", limit=3, window_seconds=60)
        assert retry_after2 is None
        retry_after3 = limiter.check("user-1", limit=3, window_seconds=60)
        assert retry_after3 is None

    def test_rate_limiter_blocks_over_limit(self):
        limiter = SlidingWindowLimiter()
        # consume limit
        for _ in range(2):
            limiter.check("user-blocked", limit=2, window_seconds=60)

        # 3rd request should be blocked
        retry_after = limiter.check("user-blocked", limit=2, window_seconds=60)
        assert retry_after is not None
        assert retry_after > 0
