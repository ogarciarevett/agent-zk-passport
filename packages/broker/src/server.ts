/**
 * Broker IPC server — exposes the broker over a Unix-domain socket, NOT a network port. This
 * is what makes the broker a genuinely separate trust domain: the secret-bearing process and
 * the (prompt-injectable) agent process share only this socket, and the only messages that
 * cross it are challenge/mint/exec requests and operation *results*. A compromised agent
 * cannot read the broker's memory.
 *
 * Run standalone: `bun run broker` (see apps/demo/src/broker-server.ts).
 */
import { existsSync, unlinkSync } from 'node:fs';
import type { Challenge } from '@azkp/verifier';
import { Hono } from 'hono';
import type { Broker, OpInput, OpRequest } from './broker.js';
import type { Capability } from './capability.js';

interface MintRequest {
  proof: unknown;
  challenge: Challenge;
  ops: OpRequest[];
}
interface ExecRequest {
  cap: Capability;
  input: OpInput;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Build the broker's HTTP surface. Mounted on a UDS by `serveBrokerOverUnixSocket`. */
export function createBrokerApp(broker: Broker): Hono {
  const app = new Hono();

  app.get('/challenge', (c) => c.json(broker.challenge()));

  app.post('/mint', async (c) => {
    const body = (await c.req.json().catch(() => null)) as MintRequest | null;
    if (!isObject(body) || !body.proof || !body.challenge || !Array.isArray(body.ops)) {
      return c.json({ ok: false, reason: 'malformed mint request' }, 400);
    }
    // The broker re-verifies the proof cryptographically; this is only an envelope check.
    const result = await broker.mintCapabilities(
      body.proof as Parameters<Broker['mintCapabilities']>[0],
      body.challenge,
      body.ops,
    );
    return c.json(result);
  });

  app.post('/exec', async (c) => {
    const body = (await c.req.json().catch(() => null)) as ExecRequest | null;
    if (!isObject(body) || !isObject(body.cap) || !isObject(body.input)) {
      return c.json({ ok: false, reason: 'malformed exec request' }, 400);
    }
    const result = await broker.exec(body.cap, body.input);
    return c.json(result);
  });

  return app;
}

export interface BrokerServerHandle {
  socketPath: string;
  stop: () => void;
}

/** Serve the broker on a Unix-domain socket. Removes a stale socket file first. */
export function serveBrokerOverUnixSocket(broker: Broker, socketPath: string): BrokerServerHandle {
  if (existsSync(socketPath)) unlinkSync(socketPath);
  const server = Bun.serve({ unix: socketPath, fetch: createBrokerApp(broker).fetch });
  return {
    socketPath,
    stop: () => {
      server.stop(true);
      if (existsSync(socketPath)) unlinkSync(socketPath);
    },
  };
}
