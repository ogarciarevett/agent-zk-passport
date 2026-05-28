/**
 * Sample merchant that ONLY accepts passported agent traffic. It challenges the agent, then
 * requires (1) a valid passport proof meeting its policy predicates, and (2) a payment
 * authorization (an API key the broker injects — the agent never holds it). Un-passported or
 * under-age/over-limit traffic is rejected. This is the headline acceptance target.
 */
import type { PredicateSet } from '@azkp/credential';
import type { PassportProof } from '@azkp/proof';
import type { Challenge, Verifier } from '@azkp/verifier';
import { Hono } from 'hono';
import { z } from 'zod';

export interface MerchantConfig {
  verifier: Verifier;
  /** the payment credential the merchant expects; injected by the broker, never by the agent. */
  paymentApiKey: string;
  requiredPredicates: PredicateSet;
}

const PayBody = z.object({ amount: z.number().positive() });

export function createMerchantApp(config: MerchantConfig): Hono {
  const app = new Hono();

  app.get('/challenge', (c) => c.json(config.verifier.challenge()));

  app.post('/pay', async (c) => {
    // 1. reject un-passported traffic
    const passportRaw = c.req.header('X-Passport');
    if (!passportRaw) return c.json({ error: 'un-passported traffic rejected' }, 401);

    let passport: { proof: PassportProof; challenge: Challenge };
    try {
      passport = JSON.parse(passportRaw);
    } catch {
      return c.json({ error: 'malformed passport' }, 400);
    }

    const verdict = await config.verifier.verify(
      passport.proof,
      passport.challenge,
      config.requiredPredicates,
    );
    if (!verdict.ok) return c.json({ error: `passport rejected: ${verdict.reason}` }, 403);

    // 2. require payment authorization (the broker-injected secret)
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${config.paymentApiKey}`) {
      return c.json({ error: 'payment authorization failed' }, 402);
    }

    // 3. process
    const body = PayBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid amount' }, 400);

    return c.json({
      paid: true,
      amount: body.data.amount,
      // pseudonymous handle — the human is never revealed
      agent: verdict.claim?.agentPubkey.slice(0, 16),
    });
  });

  return app;
}
