import { describe, expect, test } from 'bun:test';
import { merkleRoot } from '../src/index.js';

describe('merkleRoot', () => {
  test('empty set has a stable sentinel root', () => {
    expect(merkleRoot([])).toBe(merkleRoot([]));
    expect(merkleRoot([])).not.toBe(merkleRoot(['a']));
  });

  test('is independent of insertion order (sorted leaves)', () => {
    const a = merkleRoot(['c', 'a', 'b', 'd', 'e']);
    const b = merkleRoot(['e', 'd', 'c', 'b', 'a']);
    expect(a).toBe(b);
  });

  test('exercises the tree for odd and even leaf counts', () => {
    // odd count (5) hits the duplicate-last-node branch; even (4) does not
    const odd = merkleRoot(['1', '2', '3', '4', '5']);
    const even = merkleRoot(['1', '2', '3', '4']);
    expect(odd).toHaveLength(64); // sha256 hex
    expect(even).toHaveLength(64);
    expect(odd).not.toBe(even);
  });

  test('adding a leaf changes the root', () => {
    const before = merkleRoot(['x', 'y']);
    const after = merkleRoot(['x', 'y', 'z']);
    expect(before).not.toBe(after);
  });
});
