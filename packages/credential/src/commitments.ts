/**
 * Attribute commitments. A credential stores *commitments* to the human's attributes
 * (age, jurisdiction, spend limit, reputation tier) — never the raw values. The holder
 * keeps the openings (value + salt) privately and feeds them to the prover.
 *
 * commitment = sha256(salt : name : value). The salt makes commitments hiding (a verifier
 * can't brute-force small domains like age) and unlinkable across credentials.
 */
import { randomHex, sha256Hex } from './crypto.js';

export type AttributeValue = number | string;

/** The private opening for one committed attribute. Held by the agent, never published. */
export interface AttributeOpening {
  value: AttributeValue;
  salt: string;
}

/** name -> commitment hex (public, lives in the credential). */
export type CommitmentMap = Record<string, string>;
/** name -> opening (private, held by the agent alongside the credential). */
export type OpeningMap = Record<string, AttributeOpening>;

export function computeCommitment(name: string, value: AttributeValue, salt: string): string {
  return sha256Hex(`${salt}:${name}:${String(value)}`);
}

/**
 * Commit a set of cleartext attributes. Returns the public commitment map (for the
 * credential) and the private opening map (for the holder).
 */
export function commitAttributes(attributes: Record<string, AttributeValue>): {
  commitments: CommitmentMap;
  openings: OpeningMap;
} {
  const commitments: CommitmentMap = {};
  const openings: OpeningMap = {};
  for (const [name, value] of Object.entries(attributes)) {
    const salt = randomHex(16);
    openings[name] = { value, salt };
    commitments[name] = computeCommitment(name, value, salt);
  }
  return { commitments, openings };
}

/** Verify that an opening matches a committed value. */
export function verifyOpening(name: string, commitment: string, opening: AttributeOpening): boolean {
  return computeCommitment(name, opening.value, opening.salt) === commitment;
}
