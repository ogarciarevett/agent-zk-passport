/**
 * Broker client — what the agent process uses to reach the broker across the Unix-domain
 * socket. It mirrors the in-process `Broker` surface (challenge / mintCapabilities / exec) so
 * the agent code is identical whether the broker is in-process (tests) or a separate process
 * (production). Crucially, this client has NO method to fetch a secret — the boundary only
 * carries results.
 */
import type { Challenge } from '@azkp/verifier';
import type { OpInput, OpRequest } from './broker.js';
import type { Capability } from './capability.js';

export type MintResponse = { ok: true; capabilities: Capability[] } | { ok: false; reason: string };
export type ExecResponse =
  | { ok: true; result: import('./broker.js').OpResult }
  | { ok: false; reason: string };

export class BrokerClient {
  constructor(private readonly socketPath: string) {}

  private async call<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
    const res = await fetch(`http://localhost${path}`, {
      // Bun routes this over the filesystem socket, never the network.
      unix: this.socketPath,
      method: init?.method ?? 'GET',
      headers: init ? { 'Content-Type': 'application/json' } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
    } as RequestInit);
    return (await res.json()) as T;
  }

  challenge(): Promise<Challenge> {
    return this.call<Challenge>('/challenge');
  }

  mintCapabilities(proof: unknown, challenge: Challenge, ops: OpRequest[]): Promise<MintResponse> {
    return this.call<MintResponse>('/mint', { method: 'POST', body: { proof, challenge, ops } });
  }

  exec(cap: Capability, input: OpInput): Promise<ExecResponse> {
    return this.call<ExecResponse>('/exec', { method: 'POST', body: { cap, input } });
  }
}
