import { describe, expect, test } from 'bun:test';
import {
  type CredentialBody,
  commitAttributes,
  generateEd25519KeyPair,
  randomHex,
  signCredential,
} from '@azkp/credential';
import { devProofBackend } from '@azkp/proof';
import { RevocationChecker, TransparencyLog } from '@azkp/transparency-log';
import { Verifier } from '../src/index.js';

function setup() {
  const issuer = generateEd25519KeyPair();
  const agent = generateEd25519KeyPair();
  const log = new TransparencyLog();
  const { commitments, openings } = commitAttributes({ age: 21, dailySpend: 50 });
  const body: CredentialBody = {
    version: 1,
    issuerId: 'issuer.test',
    schemaId: 'personhood.v1',
    agentPubkey: agent.publicKey,
    attributeCommitments: commitments,
    revocationId: randomHex(16),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1_000_000,
  };
  const credential = signCredential(issuer.privateKey, body);
  const revocation = new RevocationChecker(log.logPubkey, log.snapshot());
  const verifier = new Verifier({ trustedIssuerPubkeys: [issuer.publicKey], revocation });
  return { issuer, agent, log, credential, openings, revocation, verifier };
}

async function makeProof(s: ReturnType<typeof setup>, challengeNonce: string) {
  return devProofBackend.prove({
    credential: s.credential,
    openings: s.openings,
    agentPrivateKeyHex: s.agent.privateKey,
    issuerPubkeyHex: s.issuer.publicKey,
    predicates: [
      { attribute: 'age', op: 'gte', value: 18 },
      { attribute: 'dailySpend', op: 'lte', value: 200 },
    ],
    revocationRoot: s.revocation.root,
    challenge: challengeNonce,
    validityMs: 60_000,
  });
}

describe('verifier end-to-end', () => {
  test('accepts a valid passport and enforces required predicates', async () => {
    const s = setup();
    const ch = s.verifier.challenge();
    const proof = await makeProof(s, ch.nonce);
    const res = await s.verifier.verify(proof, ch, [{ attribute: 'age', op: 'gte', value: 18 }]);
    expect(res.ok).toBe(true);
  });

  test('verifies within the 100ms budget', async () => {
    const s = setup();
    const ch = s.verifier.challenge();
    const proof = await makeProof(s, ch.nonce);
    const start = performance.now();
    const res = await s.verifier.verify(proof, ch);
    const elapsed = performance.now() - start;
    expect(res.ok).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });

  test('rejects replayed (already-used) challenge', async () => {
    const s = setup();
    const ch = s.verifier.challenge();
    const proof = await makeProof(s, ch.nonce);
    expect((await s.verifier.verify(proof, ch)).ok).toBe(true);
    const replay = await s.verifier.verify(proof, ch);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toMatch(/unknown or used challenge/);
  });

  test('rejects a revoked credential', async () => {
    const s = setup();
    s.log.revoke(s.credential.revocationId);
    s.revocation.update(s.log.snapshot());
    const ch = s.verifier.challenge();
    // proof bound to the new (post-revocation) root
    const proof = await devProofBackend.prove({
      credential: s.credential,
      openings: s.openings,
      agentPrivateKeyHex: s.agent.privateKey,
      issuerPubkeyHex: s.issuer.publicKey,
      predicates: [{ attribute: 'age', op: 'gte', value: 18 }],
      revocationRoot: s.revocation.root,
      challenge: ch.nonce,
      validityMs: 60_000,
    });
    const res = await s.verifier.verify(proof, ch);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/revoked/);
  });

  test('rejects an untrusted issuer', async () => {
    const s = setup();
    const rogue = new Verifier({
      trustedIssuerPubkeys: [generateEd25519KeyPair().publicKey],
      revocation: s.revocation,
    });
    const ch = rogue.challenge();
    const proof = await makeProof(s, ch.nonce);
    const res = await rogue.verify(proof, ch);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/untrusted issuer/);
  });

  test('rejects when a required predicate is missing', async () => {
    const s = setup();
    const ch = s.verifier.challenge();
    const proof = await makeProof(s, ch.nonce);
    const res = await s.verifier.verify(proof, ch, [
      { attribute: 'jurisdiction', op: 'eq', value: 'EU' },
    ]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing predicates/);
  });
});
