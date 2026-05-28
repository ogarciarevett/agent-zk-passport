import { describe, expect, test } from 'bun:test';
import {
  EphemeralMasterKeyProvider,
  MemoryVaultStore,
  SealedVault,
  type SecretPolicy,
} from '../src/index.js';

const policy: SecretPolicy = {
  operations: ['http_proxy'],
  scopes: ['api.example.com:POST:/charge'],
  requiredPredicates: [],
  maxUsesPerCapability: 1,
  capabilityTtlMs: 60_000,
};

function vault() {
  return new SealedVault(new EphemeralMasterKeyProvider(), new MemoryVaultStore());
}

describe('sealed vault', () => {
  test('seals and uses a secret via withSecret', () => {
    const v = vault();
    v.putSecret({ id: 'stripe', type: 'api_key', secret: 'sk_live_TOPSECRET', policy });
    const len = v.withSecret('stripe', (pt) => pt.toString('utf8').length);
    expect(len).toBe('sk_live_TOPSECRET'.length);
  });

  test('record info and stored bytes never contain the plaintext', () => {
    const v = vault();
    const store = new MemoryVaultStore();
    const v2 = new SealedVault(new EphemeralMasterKeyProvider(), store);
    v2.putSecret({ id: 'k', type: 'api_key', secret: 'sk_live_TOPSECRET', policy });

    // public info carries no secret material
    const info = v2.getInfo('k')!;
    expect(JSON.stringify(info)).not.toContain('TOPSECRET');

    // the sealed record on disk/store is ciphertext only
    const raw = JSON.stringify(store.get('k'));
    expect(raw).not.toContain('TOPSECRET');
    expect(raw).not.toContain('sk_live');
    void v;
  });

  test('there is no plaintext-returning method on the vault surface', () => {
    const v = vault();
    // @ts-expect-error — getSecret must not exist by design
    expect(v.getSecret).toBeUndefined();
    // @ts-expect-error — exportSecret must not exist by design
    expect(v.exportSecret).toBeUndefined();
  });

  test('wrong/missing secret id throws', () => {
    const v = vault();
    expect(() => v.withSecret('nope', () => 1)).toThrow(/no secret/);
  });

  test('different secrets get different wrapped data keys', () => {
    const store = new MemoryVaultStore();
    const v = new SealedVault(new EphemeralMasterKeyProvider(), store);
    v.putSecret({ id: 'a', type: 'generic', secret: 'same', policy });
    v.putSecret({ id: 'b', type: 'generic', secret: 'same', policy });
    expect(store.get('a')!.envelope.wrappedDataKey.ct).not.toBe(
      store.get('b')!.envelope.wrappedDataKey.ct,
    );
  });
});
