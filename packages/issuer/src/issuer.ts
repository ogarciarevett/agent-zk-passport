/**
 * Reference issuer. Onboards a human via a (mock) identity provider, then mints a credential
 * bound to the agent's public key. The issuer commits the attested attributes and hands the
 * agent the openings; the credential itself carries only commitments + an issuer signature.
 * In production the onboarding step is a real OIDC/KYC/Worldcoin attestation
 * (see .ai/specs/02-plan.md S2.1); here it accepts a mock assertion so the demo is runnable.
 */
import {
  type AttributeValue,
  type Credential,
  type CredentialBody,
  type Ed25519KeyPair,
  type OpeningMap,
  commitAttributes,
  generateEd25519KeyPair,
  randomHex,
  signCredential,
} from '@azkp/credential';
import type { TransparencyLog } from '@azkp/transparency-log';

export interface IssuerOptions {
  issuerId: string;
  schemaId?: string;
  credentialTtlMs?: number;
}

export interface AttestedSession {
  sessionId: string;
  attributes: Record<string, AttributeValue>;
}

export class Issuer {
  private readonly keys: Ed25519KeyPair;
  private readonly schemaId: string;
  private readonly ttlMs: number;
  private readonly sessions = new Map<string, Record<string, AttributeValue>>();

  constructor(
    private readonly options: IssuerOptions,
    keys: Ed25519KeyPair = generateEd25519KeyPair(),
    private readonly log?: TransparencyLog,
  ) {
    this.keys = keys;
    this.schemaId = options.schemaId ?? 'personhood.v1';
    this.ttlMs = options.credentialTtlMs ?? 30 * 24 * 60 * 60_000;
  }

  publicInfo(): { issuerId: string; issuerPubkey: string; schemaId: string } {
    return {
      issuerId: this.options.issuerId,
      issuerPubkey: this.keys.publicKey,
      schemaId: this.schemaId,
    };
  }

  /**
   * Mock onboarding. A real implementation verifies an OIDC id_token / KYC / sovereign-ID
   * attestation here and derives the attributes from it. We accept the claims directly.
   */
  onboard(claims: Record<string, AttributeValue>): AttestedSession {
    const sessionId = randomHex(16);
    this.sessions.set(sessionId, claims);
    return { sessionId, attributes: claims };
  }

  /** Mint a credential bound to `agentPubkey` from a previously-attested session. */
  mint(
    sessionId: string,
    agentPubkey: string,
    now: number = Date.now(),
  ): { credential: Credential; openings: OpeningMap } {
    const attributes = this.sessions.get(sessionId);
    if (!attributes) throw new Error('unknown or expired onboarding session');

    const { commitments, openings } = commitAttributes(attributes);
    const body: CredentialBody = {
      version: 1,
      issuerId: this.options.issuerId,
      schemaId: this.schemaId,
      agentPubkey,
      attributeCommitments: commitments,
      revocationId: randomHex(16),
      issuedAt: now,
      expiresAt: now + this.ttlMs,
    };
    return { credential: signCredential(this.keys.privateKey, body), openings };
  }

  /** Revoke a credential by adding its revocationId to the transparency log. */
  revoke(revocationId: string): void {
    if (!this.log) throw new Error('issuer has no transparency log configured');
    this.log.revoke(revocationId);
  }
}
