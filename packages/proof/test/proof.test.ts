import { describe, expect, test } from 'bun:test';
import {
  type CredentialBody,
  commitAttributes,
  generateEd25519KeyPair,
  randomHex,
  signCredential,
} from '@azkp/credential';
import { devProofBackend, getProofBackend, risc0ProofBackend } from '../src/index.js';

function mint() {
  const issuer = generateEd25519KeyPair();
  const agent = generateEd25519KeyPair();
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
  return { issuer, agent, credential, openings };
}

describe('dev proof backend', () => {
  test('prove then verify succeeds', async () => {
    const { issuer, agent, credential, openings } = mint();
    const proof = await devProofBackend.prove({
      credential,
      openings,
      agentPrivateKeyHex: agent.privateKey,
      issuerPubkeyHex: issuer.publicKey,
      predicates: [{ attribute: 'age', op: 'gte', value: 18 }],
      revocationRoot: randomHex(),
      challenge: randomHex(),
      validityMs: 60_000,
    });
    expect((await devProofBackend.verify(proof)).ok).toBe(true);
  });

  test('refuses to prove a false predicate', async () => {
    const { issuer, agent, credential, openings } = mint();
    await expect(
      devProofBackend.prove({
        credential,
        openings,
        agentPrivateKeyHex: agent.privateKey,
        issuerPubkeyHex: issuer.publicKey,
        predicates: [{ attribute: 'age', op: 'gte', value: 65 }],
        revocationRoot: randomHex(),
        challenge: randomHex(),
        validityMs: 60_000,
      }),
    ).rejects.toThrow(/predicates do not hold/);
  });

  test('rejects a proof signed by the wrong agent key', async () => {
    const { issuer, agent, credential, openings } = mint();
    const proof = await devProofBackend.prove({
      credential,
      openings,
      agentPrivateKeyHex: agent.privateKey,
      issuerPubkeyHex: issuer.publicKey,
      predicates: [{ attribute: 'age', op: 'gte', value: 18 }],
      revocationRoot: randomHex(),
      challenge: randomHex(),
      validityMs: 60_000,
    });
    // tamper: keep claim, replace signature with one over a different agent key
    const attacker = generateEd25519KeyPair();
    const forged = { ...proof, proof: await signWith(attacker.privateKey, proof) };
    expect((await devProofBackend.verify(forged)).ok).toBe(false);
  });
});

describe('risc0 backend routing', () => {
  // The real zkVM prove/verify round-trip lives in risc0.test.ts (skipped without the
  // prover binary). Here we only assert backend selection.
  test('getProofBackend("risc0") resolves to the risc0 backend', () => {
    expect(getProofBackend('risc0')).toBe(risc0ProofBackend);
    expect(risc0ProofBackend.id).toBe('risc0');
  });
});

// helper that signs the same binding bytes with a different key (forgery attempt)
async function signWith(
  privateKeyHex: string,
  proof: Awaited<ReturnType<typeof devProofBackend.prove>>,
) {
  const { canonicalJson, signMessage } = await import('@azkp/credential');
  return signMessage(
    privateKeyHex,
    canonicalJson({ claim: proof.claim, credential: proof.credential }),
  );
}
