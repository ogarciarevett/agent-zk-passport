/**
 * Redaction-aware logger. The broker is the one place plaintext secrets exist, so its log
 * path is the highest-risk leak surface. This logger only ever receives explicitly-passed
 * structured fields (never a secret), and additionally scrubs anything that *looks* like a
 * secret as defense-in-depth. The secret-exfiltration test asserts nothing leaks here.
 */
export interface LogEvent {
  event: string;
  [key: string]: unknown;
}

export type LogSink = (line: string) => void;

const SECRET_PATTERNS: RegExp[] = [
  /sk_[A-Za-z0-9_]+/g, // stripe-style keys
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /0x[a-fA-F0-9]{40,}/g, // long hex (private keys)
];

export function redact(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '«redacted»');
  return out;
}

export function createLogger(sink: LogSink = (l) => console.log(l)): (e: LogEvent) => void {
  return (e: LogEvent) => sink(redact(JSON.stringify(e)));
}
