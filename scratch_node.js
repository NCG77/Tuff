const CryptoJS = require("crypto-js");

const keyStr = "tuff_secret_key_2024".padEnd(32, '0').slice(0, 32);
const key = CryptoJS.enc.Utf8.parse(keyStr);
const iv = CryptoJS.enc.Utf8.parse("1234567890123456");

const encrypted = CryptoJS.AES.encrypt("my-secret", key, { iv: iv }).toString();
console.log(encrypted);
