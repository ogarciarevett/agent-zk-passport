/**
 * Agent SDK — runs inside the agent. It holds the agent keypair, the issued credential, and
 * the private commitment openings, and it produces passport proofs on demand. It NEVER holds
 * a raw secret: to use one it asks the broker for a capability and then for an operation,
 * receiving only results. The agent is the prompt-injection-exposed surface, so by design the
 * worst it can leak is a credential + a short-lived capability, never a key.
 */
import {
  type Credential,
  type Ed25519KeyPair,
  type OpeningMap,
  type PredicateSet,
  generateEd25519KeyPair,
} from '@azkp/credential';
import { type PassportProof, type ProofBackend, getProofBackend } from '@azkp/proof';

export interface Challengeable {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export class AgentIdentity {
  private credential?: Credential;
  private openings?: OpeningMap;
  private issuerPubkey?: string;

  constructor(
    private readonly keys: Ed25519KeyPair,
    private readonly backend: ProofBackend = getProofBackend('dev-ed25519'),
  ) {}

  static create(backend?: ProofBackend): AgentIdentity {
    return new AgentIdentity(generateEd25519KeyPair(), backend);
  }

  get agentPubkey(): string {
    return this.keys.publicKey;
  }

  /** Store the credential issued for this agent, plus the private openings + issuer key. */
  loadCredential(credential: Credential, openings: OpeningMap, issuerPubkey: string): void {
    if (credential.agentPubkey !== this.keys.publicKey) {
      throw new Error('credential is not bound to this agent key');
    }
    this.credential = credential;
    this.openings = openings;
    this.issuerPubkey = issuerPubkey;
  }

  hasCredential(): boolean {
    return this.credential !== undefined;
  }

  /**
   * Produce a passport proof answering a verifier/broker challenge for the given predicates,
   * bound to a revocation root. Throws if no credential is loaded or predicates don't hold.
   */
  async prove(
    challenge: Challengeable,
    predicates: PredicateSet,
    revocationRoot: string,
    validityMs = 60_000,
  ): Promise<PassportProof> {
    if (!this.credential || !this.openings || !this.issuerPubkey) {
      throw new Error('no credential loaded');
    }
    return this.backend.prove({
      credential: this.credential,
      openings: this.openings,
      agentPrivateKeyHex: this.keys.privateKey,
      issuerPubkeyHex: this.issuerPubkey,
      predicates,
      revocationRoot,
      challenge: challenge.nonce,
      validityMs,
    });
  }
}
