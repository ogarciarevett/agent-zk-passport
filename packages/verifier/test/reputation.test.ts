import { describe, expect, test } from 'bun:test';
import { generateEd25519KeyPair } from '@azkp/credential';
import { TransparencyLog } from '@azkp/transparency-log';
import { ReputationService } from '../src/index.js';

describe('reputation service', () => {
  test('accrues score and maps to tiers', () => {
    const log = new TransparencyLog();
    const rep = new ReputationService(log, 'merchant.demo');
    const agent = generateEd25519KeyPair().publicKey;

    expect(rep.view(agent).tier).toBe('new');
    for (let i = 0; i < 3; i++) rep.record(agent, 'success');
    expect(rep.view(agent).tier).toBe('established');
    for (let i = 0; i < 7; i++) rep.record(agent, 'success');
    expect(rep.view(agent).tier).toBe('trusted');
    rep.record(agent, 'failure', 100);
    expect(rep.view(agent).tier).toBe('flagged');
  });

  test('pseudonyms are unlinkable across contexts', () => {
    const log = new TransparencyLog();
    const agent = generateEd25519KeyPair().publicKey;
    const a = new ReputationService(log, 'merchant.A');
    const b = new ReputationService(log, 'merchant.B');
    expect(a.pseudonymFor(agent)).not.toBe(b.pseudonymFor(agent));

    // reputation built at A does not show up under B's pseudonym
    a.record(agent, 'success', 5);
    expect(a.view(agent).score).toBe(5);
    expect(b.view(agent).score).toBe(0);
  });
});
