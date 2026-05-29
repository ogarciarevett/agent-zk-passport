/**
 * Integration test for the REAL RISC Zero backend. It is skipped unless the prover binary is
 * built (`cd zkvm && cargo build --release`), so `bun test` stays green without the toolchain.
 * When the binary is present it generates and verifies an actual zkVM receipt.
 */
import { describe, expect, test } from 'bun:test';
import {
  type CredentialBody,
  commitAttributes,
  generateEd25519KeyPair,
  randomHex,
  signCredential,
} from '@azkp/credential';
import { proverStatus, risc0ProofBackend } from '../src/index.js';

const status = proverStatus();
const itZk = status.available ? test : test.skip;

if (!status.available) {
  console.log(`[risc0.test] skipped — ${status.reason}`);
}

function mint(age: number) {
  const issuer = generateEd25519KeyPair();
  const agent = generateEd25519KeyPair();
  const { commitments, openings } = commitAttributes({ age });
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
  return { issuer, agent, credential: signCredential(issuer.privateKey, body), openings };
}

describe('risc0 backend (real zkVM)', () => {
  itZk(
    'proves a true predicate and verifies the receipt; age stays private',
    async () => {
      const { issuer, agent, credential, openings } = mint(21);
      const proof = await risc0ProofBackend.prove({
        credential,
        openings,
        agentPrivateKeyHex: agent.privateKey,
        issuerPubkeyHex: issuer.publicKey,
        predicates: [{ attribute: 'age', op: 'gte', value: 18 }],
        revocationRoot: randomHex(),
        challenge: randomHex(),
        validityMs: 60_000,
      });
      expect(proof.backend).toBe('risc0');
      // the private age must not appear in the proof claim or receipt journal
      expect(JSON.stringify(proof.claim)).not.toContain('"age":21');
      expect((await risc0ProofBackend.verify(proof)).ok).toBe(true);
    },
    120_000,
  );

  itZk(
    'refuses to prove a false predicate',
    async () => {
      const { issuer, agent, credential, openings } = mint(16);
      await expect(
        risc0ProofBackend.prove({
          credential,
          openings,
          agentPrivateKeyHex: agent.privateKey,
          issuerPubkeyHex: issuer.publicKey,
          predicates: [{ attribute: 'age', op: 'gte', value: 18 }],
          revocationRoot: randomHex(),
          challenge: randomHex(),
          validityMs: 60_000,
        }),
      ).rejects.toThrow(/predicates do not hold/);
    },
    120_000,
  );
});
