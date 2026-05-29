/**
 * Standalone broker process. Run this in its OWN OS process so the secret-bearing vault never
 * shares an address space with the agent:
 *
 *   AZKP_BROKER_SOCKET=/tmp/azkp.sock \
 *   AZKP_ISSUER_PUBKEY=<hex> \
 *   AZKP_PAYMENT_KEY=<the api key to custody> \
 *   AZKP_PAY_URL='POST http://127.0.0.1:8788/pay' \
 *   bun run broker
 *
 * The agent process then talks to it via `new BrokerClient(socketPath)`. The only things that
 * cross the socket are challenge/mint/exec requests and operation results — never the key.
 * Secrets are read from the environment (never a committed file).
 */
import { Broker, serveBrokerOverUnixSocket } from '@azkp/broker';
import { RevocationChecker, TransparencyLog } from '@azkp/transparency-log';
import { FileMasterKeyProvider, SealedVault, type SecretPolicy } from '@azkp/vault';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`broker-server: ${name} is required (see header of broker-server.ts)`);
    process.exit(1);
  }
  return value;
}

const socketPath = required('AZKP_BROKER_SOCKET');
const issuerPubkey = required('AZKP_ISSUER_PUBKEY');
const paymentKey = required('AZKP_PAYMENT_KEY');
const payScope = process.env.AZKP_PAY_URL ?? 'POST http://127.0.0.1:8788/pay';

// Master key is hardware-sealed in production; here it's a 0600 file under demo-state/.
const vault = new SealedVault(new FileMasterKeyProvider('demo-state/broker-master.key'));
const policy: SecretPolicy = {
  operations: ['http_proxy'],
  scopes: [payScope],
  requiredPredicates: [{ attribute: 'age', op: 'gte', value: 18 }],
  maxUsesPerCapability: 1,
  capabilityTtlMs: 60_000,
};
vault.putSecret({
  id: 'merchant-pay',
  type: 'api_key',
  secret: paymentKey,
  policy,
  metadata: { injectHeader: 'Authorization', injectPrefix: 'Bearer ' },
});

// NOTE: this standalone process starts with an empty revocation snapshot. A production broker
// would subscribe to the transparency log and refresh its signed root periodically.
const demoLog = new TransparencyLog();
const revocation = new RevocationChecker(demoLog.logPubkey, demoLog.snapshot());

const broker = new Broker({ vault, trustedIssuerPubkeys: [issuerPubkey], revocation });
const handle = serveBrokerOverUnixSocket(broker, socketPath);
console.log(
  `broker listening on unix:${handle.socketPath} (broker pubkey ${broker.brokerPubkey.slice(0, 12)}…)`,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    handle.stop();
    process.exit(0);
  });
}
