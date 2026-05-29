/**
 * Reputation service (Phase 5). A relying party records the outcome of an interaction against
 * the agent's *per-context pseudonym* in the transparency log, building portable reputation
 * that never leaks the human's identity and isn't linkable across contexts. Reputation tiers
 * can then gate rate limits / trust without re-running KYC.
 */
import { derivePseudonym } from '@azkp/credential';
import type { TransparencyLog } from '@azkp/transparency-log';

export type ReputationTier = 'flagged' | 'new' | 'established' | 'trusted';

export interface ReputationView {
  pseudonym: string;
  score: number;
  count: number;
  tier: ReputationTier;
}

function toTier(score: number): ReputationTier {
  if (score < 0) return 'flagged';
  if (score >= 10) return 'trusted';
  if (score >= 3) return 'established';
  return 'new';
}

export class ReputationService {
  /**
   * @param context a stable per-relying-party label (e.g. the verifier/merchant id). Pseudonyms
   *   are derived from `(context, agentPubkey)`, so each context sees an unlinkable handle.
   */
  constructor(
    private readonly log: TransparencyLog,
    private readonly context: string,
  ) {}

  pseudonymFor(agentPubkey: string): string {
    return derivePseudonym(agentPubkey, this.context);
  }

  /** Record an interaction outcome against the agent's pseudonym in this context. */
  record(agentPubkey: string, outcome: 'success' | 'failure', weight = 1, at?: number): void {
    const entry = {
      pseudonym: this.pseudonymFor(agentPubkey),
      verifierId: this.context,
      outcome,
      weight,
    };
    this.log.attest(at === undefined ? entry : { ...entry, at });
  }

  view(agentPubkey: string): ReputationView {
    const pseudonym = this.pseudonymFor(agentPubkey);
    const { score, count } = this.log.reputation(pseudonym);
    return { pseudonym, score, count, tier: toTier(score) };
  }
}
