export * from './types.js';
export { DevProofBackend, devProofBackend } from './dev-backend.js';
export { Risc0ProofBackend, risc0ProofBackend } from './risc0-backend.js';

import { devProofBackend } from './dev-backend.js';
import { risc0ProofBackend } from './risc0-backend.js';
import type { ProofBackend, ProofBackendId } from './types.js';

/** Resolve a backend by id. Defaults to the dev backend used by the reference demo. */
export function getProofBackend(id: ProofBackendId = 'dev-ed25519'): ProofBackend {
  return id === 'risc0' ? risc0ProofBackend : devProofBackend;
}
