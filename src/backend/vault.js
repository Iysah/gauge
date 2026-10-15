/**
 * Vault module for secure credential storage using Electron's safeStorage (macOS Keychain).
 * Prevents plain-text passwords from ever sitting on disk in config.json.
 */

let electronSafeStorage = null;

/**
 * Initialize vault with Electron's safeStorage module (called in main process after app.whenReady()).
 */
export function initVault(safeStorage) {
  if (safeStorage) {
    electronSafeStorage = safeStorage;
  }
}

/**
 * Check if OS Keychain encryption is available.
 */
export function isEncryptionAvailable() {
  if (!electronSafeStorage) return false;
  try {
    return Boolean(typeof electronSafeStorage.isEncryptionAvailable === "function" && electronSafeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext string using the macOS Keychain via Electron safeStorage.
 * Returns a base64 encoded string.
 */
export function encryptString(plainText) {
  if (!plainText) return null;
  if (!isEncryptionAvailable()) {
    return null;
  }
  try {
    const buffer = electronSafeStorage.encryptString(String(plainText));
    return buffer.toString("base64");
  } catch (err) {
    console.error("Failed to encrypt with safeStorage:", err.message);
    return null;
  }
}

/**
 * Decrypt a base64 encoded string using the macOS Keychain via Electron safeStorage.
 */
export function decryptString(base64Cipher) {
  if (!base64Cipher) return null;
  if (!isEncryptionAvailable()) {
    return null;
  }
  try {
    const buffer = Buffer.from(base64Cipher, "base64");
    return electronSafeStorage.decryptString(buffer);
  } catch (err) {
    console.error("Failed to decrypt with safeStorage:", err.message);
    return null;
  }
}
