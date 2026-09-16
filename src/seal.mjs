// seal.mjs — Cryptographic sealing for licensed benchmark results
//
// Licensed mode seals benchmark results using AES-256-GCM encryption.
// Results can only be unsealed after geographic consensus is reached.
// This prevents private model providers from gaming the public benchmark.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const SEALED_DIR = '.sealed';
const ALGORITHM = 'aes-256-gcm';

/**
 * Derive a 32-byte encryption key from the license key + session cross hash.
 * Uses SHA-256 (Node.js doesn't have native BLAKE3; WASM does for verification).
 */
function deriveKey(licenseKey, crossHash) {
  return createHash('sha256')
    .update('wave4/sealed-results/v1')
    .update(Buffer.from(licenseKey, 'hex'))
    .update(crossHash || 'no-cross-hash')
    .digest();
}

/**
 * Seal benchmark results with AES-256-GCM.
 * @param {string} resultsJson - JSON string of benchmark results
 * @param {string} licenseKey - 64-char hex license key
 * @param {string} [crossHash] - Cross hash from anyonic tokens
 * @returns {Object} Sealed payload { version, sealed_at, iv, mac, ciphertext, license_hash }
 */
export function sealResults(resultsJson, licenseKey, crossHash) {
  const key = deriveKey(licenseKey, crossHash);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = Buffer.from(resultsJson, 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const mac = cipher.getAuthTag().toString('hex');

  const licenseHash = createHash('sha256')
    .update(Buffer.from(licenseKey, 'hex'))
    .digest('hex')
    .slice(0, 16);

  return {
    version: '4.0',
    sealed_at: new Date().toISOString(),
    iv: iv.toString('hex'),
    mac,
    ciphertext: encrypted.toString('base64'),
    license_hash: licenseHash,
  };
}

/**
 * Unseal benchmark results. Verifies MAC integrity.
 * @param {Object} sealedPayload - Payload from sealResults()
 * @param {string} licenseKey - 64-char hex license key
 * @param {string} [crossHash] - Cross hash from anyonic tokens
 * @returns {string} Decrypted JSON string
 * @throws {Error} If MAC verification fails or key is wrong
 */
export function unsealResults(sealedPayload, licenseKey, crossHash) {
  const key = deriveKey(licenseKey, crossHash);
  const iv = Buffer.from(sealedPayload.iv, 'hex');
  const ciphertext = Buffer.from(sealedPayload.ciphertext, 'base64');
  const mac = Buffer.from(sealedPayload.mac, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(mac);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    throw new Error('Seal verification failed — invalid license key or corrupted data');
  }
}

/**
 * Save sealed results to the .sealed/ directory.
 * @param {Object} sealedPayload - Payload from sealResults()
 * @param {string} filename - Filename (e.g. "sealed_openai_gpt-4o_1234567890.json")
 */
export async function saveSealed(sealedPayload, filename) {
  if (!existsSync(SEALED_DIR)) {
    await mkdir(SEALED_DIR, { recursive: true });
  }
  const path = `${SEALED_DIR}/${filename}`;
  await writeFile(path, JSON.stringify(sealedPayload, null, 2));
  return path;
}

/**
 * Load sealed results from the .sealed/ directory.
 * @param {string} filename - Filename or full path
 * @returns {Object} Sealed payload
 */
export async function loadSealed(filename) {
  const path = filename.startsWith('.sealed/') ? filename : `${SEALED_DIR}/${filename}`;
  const data = await readFile(path, 'utf-8');
  return JSON.parse(data);
}
