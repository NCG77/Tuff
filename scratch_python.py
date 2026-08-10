import base64
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

key = "tuff_secret_key_2024".ljust(32, '0')[:32].encode('utf-8')
iv = b"1234567890123456"

def decrypt_aes(encrypted_text: str) -> str:
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    encrypted_bytes = base64.b64decode(encrypted_text)
    decrypted_padded = decryptor.update(encrypted_bytes) + decryptor.finalize()
    padding_len = decrypted_padded[-1]
    return decrypted_padded[:-padding_len].decode('utf-8')

print(decrypt_aes("1dJDu4Zw+JiH0DT1abPcEA=="))
