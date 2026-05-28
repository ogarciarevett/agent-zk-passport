/** Minimal binary Merkle tree over hex leaves. Root commits to the (ordered) leaf set. */
import { sha256Hex } from '@azkp/credential';

const EMPTY_ROOT = sha256Hex('azkp:empty-log');

/** Merkle root over sorted leaves (sorting makes the root independent of insertion order). */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return EMPTY_ROOT;
  let level = [...leaves].sort().map((l) => sha256Hex(`leaf:${l}`));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left; // duplicate last node on odd count
      next.push(sha256Hex(`node:${left}${right}`));
    }
    level = next;
  }
  return level[0]!;
}
