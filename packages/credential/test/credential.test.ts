import { describe, expect, test } from 'bun:test';
import {
  type CredentialBody,
  commitAttributes,
  computeCommitment,
  evaluatePredicateSet,
  generateEd25519KeyPair,
  signCredential,
  signMessage,
  verifyCredential,
  verifyMessage,
  verifyOpening,
} from '../src/index.js';

describe('crypto', () => {
  test('ed25519 sign/verify round-trips and rejects tampering', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const sig = signMessage(privateKey, 'hello');
    expect(verifyMessage(publicKey, 'hello', sig)).toBe(true);
    expect(verifyMessage(publicKey, 'hello!', sig)).toBe(false);
    const other = generateEd25519KeyPair();
    expect(verifyMessage(other.publicKey, 'hello', sig)).toBe(false);
  });
});

describe('commitments', () => {
  test('commit then open verifies; wrong value fails', () => {
    const { commitments, openings } = commitAttributes({ age: 21, jurisdiction: 'EU' });
    expect(verifyOpening('age', commitments.age!, openings.age!)).toBe(true);
    expect(verifyOpening('age', commitments.age!, { value: 18, salt: openings.age!.salt })).toBe(
      false,
    );
  });

  test('commitments are hiding: same value, different salt => different commitment', () => {
    const a = computeCommitment('age', 21, 'aaaa');
    const b = computeCommitment('age', 21, 'bbbb');
    expect(a).not.toBe(b);
  });
});

describe('predicates', () => {
  test('AND semantics over hidden attributes', () => {
    const { openings } = commitAttributes({ age: 21, dailySpend: 50, jurisdiction: 'EU' });
    expect(
      evaluatePredicateSet(
        [
          { attribute: 'age', op: 'gte', value: 18 },
          { attribute: 'dailySpend', op: 'lte', value: 200 },
          { attribute: 'jurisdiction', op: 'eq', value: 'EU' },
        ],
        openings,
      ),
    ).toBe(true);
  });

  test('fails when one predicate is false', () => {
    const { openings } = commitAttributes({ age: 16 });
    expect(evaluatePredicateSet([{ attribute: 'age', op: 'gte', value: 18 }], openings)).toBe(
      false,
    );
  });
});

describe('credential', () => {
  const body = (agentPubkey: string): CredentialBody => ({
    version: 1,
    issuerId: 'issuer.test',
    schemaId: 'personhood.v1',
    agentPubkey,
    attributeCommitments: { age: computeCommitment('age', 21, 'salt') },
    revocationId: 'deadbeef',
    issuedAt: 1000,
    expiresAt: 9_999_999_999_999,
  });

  test('signs and verifies; detects tamper, expiry, wrong issuer', () => {
    const issuer = generateEd25519KeyPair();
    const agent = generateEd25519KeyPair();
    const cred = signCredential(issuer.privateKey, body(agent.publicKey));

    expect(verifyCredential(issuer.publicKey, cred, 2000).ok).toBe(true);

    const expired = verifyCredential(issuer.publicKey, cred, 10_000_000_000_000);
    expect(expired.ok).toBe(false);
    expect(expired.reason).toBe('credential expired');

    const wrongIssuer = generateEd25519KeyPair();
    expect(verifyCredential(wrongIssuer.publicKey, cred, 2000).ok).toBe(false);

    const tampered = { ...cred, agentPubkey: generateEd25519KeyPair().publicKey };
    expect(verifyCredential(issuer.publicKey, tampered, 2000).ok).toBe(false);
  });
});
