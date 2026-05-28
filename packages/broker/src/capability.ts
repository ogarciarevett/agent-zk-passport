/**
 * Capability tokens — biscuit-style, Ed25519-signed, attenuable bearer tokens. A passport
 * proof mints a capability scoped to ONE secret + operation + scope, bounded by TTL and
 * max-uses, and tied to the proof that minted it (`boundProofHash` / `boundRevocationId`).
 * Possession of a capability authorizes one narrow broker operation — never reveals a secret.
 *
 * (Production target: the Biscuit format with offline attenuation; this is a faithful,
 * dependency-free stand-in with the same caveat semantics — see ADR 0001.)
 */
import {
  type Ed25519KeyPair,
  canonicalJson,
  randomHex,
  signMessage,
  verifyMessage,
} from '@azkp/credential';

export interface CapabilityCaveats {
  secretId: string;
  operation: string;
  scope: string;
  expiresAt: number;
  maxUses: number;
  /** sha256 over the proof claim that minted this capability. */
  boundProofHash: string;
  /** revocation handle of the bound passport — re-checked at exec time. */
  boundRevocationId: string;
}

export interface Capability extends CapabilityCaveats {
  id: string;
  brokerPubkey: string;
  brokerSignature: string;
}

function signingInput(c: Omit<Capability, 'brokerSignature'>): string {
  return canonicalJson(c);
}

export function mintCapability(brokerKeys: Ed25519KeyPair, caveats: CapabilityCaveats): Capability {
  const unsigned: Omit<Capability, 'brokerSignature'> = {
    id: randomHex(12),
    brokerPubkey: brokerKeys.publicKey,
    ...caveats,
  };
  return {
    ...unsigned,
    brokerSignature: signMessage(brokerKeys.privateKey, signingInput(unsigned)),
  };
}

export function verifyCapabilitySignature(brokerPubkey: string, cap: Capability): boolean {
  if (cap.brokerPubkey !== brokerPubkey) return false;
  const { brokerSignature, ...unsigned } = cap;
  return verifyMessage(brokerPubkey, signingInput(unsigned), brokerSignature);
}
