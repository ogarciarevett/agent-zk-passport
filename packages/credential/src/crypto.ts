/**
 * Cryptographic primitives shared across the project. Uses Node's built-in `crypto`
 * (available in Bun) so there are zero native-build dependencies.
 *
 * Conventions: keys, signatures, and digests are hex strings at module boundaries.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  createHmac as nodeCreateHmac,
  randomBytes as nodeRandomBytes,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';

export interface Ed25519KeyPair {
  /** hex-encoded raw 32-byte public key */
  publicKey: string;
  /** hex-encoded PKCS#8 private key (DER) */
  privateKey: string;
}

const RAW_ED25519_PUBLIC_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Generate an Ed25519 keypair. The public key is the raw 32-byte value (hex). */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return {
    publicKey: Buffer.from(rawPub).toString('hex'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex'),
  };
}

function privateKeyFromHex(hex: string) {
  return createPrivateKey({ key: Buffer.from(hex, 'hex'), format: 'der', type: 'pkcs8' });
}

function publicKeyFromRawHex(hex: string) {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32)
    throw new Error(`expected 32-byte raw ed25519 public key, got ${raw.length}`);
  const spki = Buffer.concat([RAW_ED25519_PUBLIC_PREFIX, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

/** Sign a UTF-8 message with a PKCS#8 hex private key. Returns hex signature. */
export function signMessage(privateKeyHex: string, message: string): string {
  const sig = nodeSign(null, Buffer.from(message, 'utf8'), privateKeyFromHex(privateKeyHex));
  return sig.toString('hex');
}

/** Verify a hex signature over a UTF-8 message against a raw hex public key. */
export function verifyMessage(
  publicKeyHex: string,
  message: string,
  signatureHex: string,
): boolean {
  try {
    return nodeVerify(
      null,
      Buffer.from(message, 'utf8'),
      publicKeyFromRawHex(publicKeyHex),
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

/** SHA-256 of a UTF-8 string, hex-encoded. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** HMAC-SHA256 over a UTF-8 payload keyed by raw key material. Hex-encoded. */
export function createHmac(_alg: 'sha256', key: Buffer | string, payload: string): string {
  return nodeCreateHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

/** Cryptographically random bytes, hex-encoded. */
export function randomHex(byteLength = 32): string {
  return nodeRandomBytes(byteLength).toString('hex');
}

/**
 * Derive a per-context pseudonym for an agent. Two different relying-party contexts produce
 * unlinkable handles, so reputation accrues per context and verifiers can't correlate the same
 * human across sites.
 *
 * NOTE: with the dev proof backend the agent public key is visible in the proof, so a
 * determined pair of verifiers who share `agentPubkey` could still correlate. Full
 * unlinkability requires the RISC Zero backend, where the agent key is never disclosed and a
 * per-context nullifier is proven instead. The API is identical; only the backend changes.
 */
export function derivePseudonym(agentPubkey: string, context: string): string {
  return sha256Hex(`pseudonym:${context}:${agentPubkey}`);
}

/**
 * Deterministic JSON serialization with recursively sorted object keys, so that two
 * structurally-equal values always hash/sign identically. Arrays keep their order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
