/** Hono HTTP surface for the reference issuer. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Issuer } from './issuer.js';

const OnboardBody = z.object({
  provider: z.literal('mock-oidc'),
  claims: z.record(z.union([z.number(), z.string()])),
});
const MintBody = z.object({
  sessionId: z.string().min(1),
  agentPubkey: z.string().regex(/^[0-9a-f]+$/),
});

export function createIssuerApp(issuer: Issuer): Hono {
  const app = new Hono();

  app.get('/.well-known/issuer-keys', (c) => c.json(issuer.publicInfo()));

  app.post('/onboard', async (c) => {
    const parsed = OnboardBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid onboarding request' }, 400);
    const session = issuer.onboard(parsed.data.claims);
    return c.json({ sessionId: session.sessionId });
  });

  app.post('/mint', async (c) => {
    const parsed = MintBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid mint request' }, 400);
    try {
      const { credential, openings } = issuer.mint(parsed.data.sessionId, parsed.data.agentPubkey);
      return c.json({ credential, openings });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  return app;
}
