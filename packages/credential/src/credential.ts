/**
 * The credential: a compact, purpose-built (W3C-VC-mappable) attestation minted by the
 * issuer and bound to a specific agent public key. It carries attribute *commitments*, an
 * opaque revocation id, and an issuer signature — never raw attributes, never secrets.
 */
import { z } from 'zod';
import { canonicalJson, signMessage, verifyMessage } from './crypto.js';

const HexString = z.string().regex(/^[0-9a-f]+$/, 'must be lowercase hex');

/** The signed body. The full credential is this plus `issuerSignature`. */
export const CredentialBodySchema = z.object({
  version: z.literal(1),
  issuerId: z.string().min(1),
  schemaId: z.string().min(1),
  /** Binds the credential to one agent keypair — prevents transfer/replay on another agent. */
  agentPubkey: HexString,
  /** attribute name -> commitment hex. */
  attributeCommitments: z.record(HexString),
  /** opaque handle the issuer can add to the revocation status list. */
  revocationId: HexString,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});
export type CredentialBody = z.infer<typeof CredentialBodySchema>;

export const CredentialSchema = CredentialBodySchema.extend({
  issuerSignature: HexString,
});
export type Credential = z.infer<typeof CredentialSchema>;

/** Canonical bytes the issuer signs / the verifier checks. */
export function credentialSigningInput(body: CredentialBody): string {
  return canonicalJson(CredentialBodySchema.parse(body));
}

/** Issuer mints a credential by signing the body with its private key. */
export function signCredential(issuerPrivateKeyHex: string, body: CredentialBody): Credential {
  const issuerSignature = signMessage(issuerPrivateKeyHex, credentialSigningInput(body));
  return { ...body, issuerSignature };
}

export interface CredentialVerifyResult {
  ok: boolean;
  reason?: string;
}

/** Verify the issuer signature and expiry. Does NOT check revocation (verifier does that). */
export function verifyCredential(
  issuerPublicKeyHex: string,
  credential: Credential,
  now: number = Date.now(),
): CredentialVerifyResult {
  const parsed = CredentialSchema.safeParse(credential);
  if (!parsed.success) return { ok: false, reason: 'malformed credential' };
  const { issuerSignature, ...body } = parsed.data;
  if (!verifyMessage(issuerPublicKeyHex, credentialSigningInput(body), issuerSignature)) {
    return { ok: false, reason: 'bad issuer signature' };
  }
  if (now > body.expiresAt) return { ok: false, reason: 'credential expired' };
  return { ok: true };
}
