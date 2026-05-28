/**
 * The predicate language. A passport proof demonstrates that a set of predicates over the
 * holder's (hidden) attributes all hold — selective disclosure of the *result*, never the
 * underlying values. Predicates are combined with AND semantics in v1.
 */
import { z } from 'zod';
import type { AttributeValue, OpeningMap } from './commitments.js';

export const ComparisonSchema = z.enum(['gte', 'lte', 'gt', 'lt', 'eq', 'neq']);
export type Comparison = z.infer<typeof ComparisonSchema>;

export const PredicateSchema = z.object({
  attribute: z.string().min(1),
  op: ComparisonSchema,
  value: z.union([z.number(), z.string()]),
});
export type Predicate = z.infer<typeof PredicateSchema>;

/** A set of predicates, evaluated as a conjunction (all must hold). */
export const PredicateSetSchema = z.array(PredicateSchema).min(1);
export type PredicateSet = z.infer<typeof PredicateSetSchema>;

function compare(left: AttributeValue, op: Comparison, right: AttributeValue): boolean {
  if (op === 'eq') return left === right;
  if (op === 'neq') return left !== right;
  // ordered comparisons require both sides to be numbers
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new Error(`ordered comparison '${op}' requires numeric operands`);
  }
  switch (op) {
    case 'gte':
      return left >= right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'lt':
      return left < right;
  }
}

/** Evaluate one predicate against the holder's openings. Throws if the attribute is absent. */
export function evaluatePredicate(predicate: Predicate, openings: OpeningMap): boolean {
  const opening = openings[predicate.attribute];
  if (!opening) throw new Error(`no opening for attribute '${predicate.attribute}'`);
  return compare(opening.value, predicate.op, predicate.value);
}

/** Evaluate a full predicate set (AND). */
export function evaluatePredicateSet(predicates: PredicateSet, openings: OpeningMap): boolean {
  return predicates.every((p) => evaluatePredicate(p, openings));
}

/** Stable human-readable rendering, handy for logs and capability scoping. */
export function describePredicate(p: Predicate): string {
  const symbol: Record<Comparison, string> = {
    gte: '>=',
    lte: '<=',
    gt: '>',
    lt: '<',
    eq: '==',
    neq: '!=',
  };
  return `${p.attribute} ${symbol[p.op]} ${p.value}`;
}
