//! Predicate logic for the zk-passport — the statement the RISC Zero guest proves.
//!
//! This crate is intentionally `std`-only and side-effect-free so it can be compiled into a
//! RISC Zero guest unchanged (the guest will additionally prove knowledge of commitment
//! openings + the agent key + non-revocation around this core). It mirrors
//! `packages/credential/src/predicates.ts` so the TS dev backend and the future zkVM backend
//! evaluate identical semantics. See .ai/specs/02-plan.md S3.0.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A committed attribute value. Strings and integers cover age/jurisdiction/spend/tier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AttributeValue {
    Int(i64),
    Text(String),
}

/// Comparison operators, matching the TypeScript predicate language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Comparison {
    Gte,
    Lte,
    Gt,
    Lt,
    Eq,
    Neq,
}

/// One predicate over a named attribute.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Predicate {
    pub attribute: String,
    pub op: Comparison,
    pub value: AttributeValue,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PredicateError {
    MissingAttribute(String),
    NonNumericOrdering,
    TypeMismatch,
}

/// Public statement the proof commits to its journal (mirrors `ProofClaim` in TS, minus the
/// revocation id which the in-guest non-revocation check would consume). Carries NO attribute
/// values — only the predicates' boolean result lives alongside it in [`Journal`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicClaim {
    pub issuer_id: String,
    pub issuer_pubkey: String,
    pub agent_pubkey: String,
    pub revocation_root: String,
    pub challenge: String,
}

/// Private witness + public claim fed into the guest. `attributes` are the secret openings —
/// they are the zkVM witness and never appear in the journal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestInput {
    pub predicates: Vec<Predicate>,
    pub attributes: BTreeMap<String, AttributeValue>,
    pub claim: PublicClaim,
}

/// What the guest commits publicly: the claim + whether the predicates held. Selective
/// disclosure of the *result*, never the attributes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Journal {
    pub claim: PublicClaim,
    pub predicates_hold: bool,
}

fn compare(
    left: &AttributeValue,
    op: Comparison,
    right: &AttributeValue,
) -> Result<bool, PredicateError> {
    use AttributeValue::{Int, Text};
    use Comparison::*;
    match op {
        Eq => Ok(left == right),
        Neq => Ok(left != right),
        Gte | Lte | Gt | Lt => match (left, right) {
            (Int(l), Int(r)) => Ok(match op {
                Gte => l >= r,
                Lte => l <= r,
                Gt => l > r,
                Lt => l < r,
                _ => unreachable!(),
            }),
            (Text(_), Text(_)) => Err(PredicateError::NonNumericOrdering),
            _ => Err(PredicateError::TypeMismatch),
        },
    }
}

/// Evaluate one predicate against the holder's (private) attribute openings.
pub fn evaluate_predicate(
    predicate: &Predicate,
    attributes: &BTreeMap<String, AttributeValue>,
) -> Result<bool, PredicateError> {
    let value = attributes
        .get(&predicate.attribute)
        .ok_or_else(|| PredicateError::MissingAttribute(predicate.attribute.clone()))?;
    compare(value, predicate.op, &predicate.value)
}

/// Evaluate a predicate set as a conjunction (all must hold). This is the boolean the zkVM
/// guest commits to its journal.
pub fn evaluate_all(
    predicates: &[Predicate],
    attributes: &BTreeMap<String, AttributeValue>,
) -> Result<bool, PredicateError> {
    for p in predicates {
        if !evaluate_predicate(p, attributes)? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attrs() -> BTreeMap<String, AttributeValue> {
        BTreeMap::from([
            ("age".into(), AttributeValue::Int(21)),
            ("dailySpend".into(), AttributeValue::Int(50)),
            ("jurisdiction".into(), AttributeValue::Text("EU".into())),
        ])
    }

    fn p(attribute: &str, op: Comparison, value: AttributeValue) -> Predicate {
        Predicate {
            attribute: attribute.into(),
            op,
            value,
        }
    }

    #[test]
    fn conjunction_holds() {
        let preds = vec![
            p("age", Comparison::Gte, AttributeValue::Int(18)),
            p("dailySpend", Comparison::Lte, AttributeValue::Int(200)),
            p(
                "jurisdiction",
                Comparison::Eq,
                AttributeValue::Text("EU".into()),
            ),
        ];
        assert_eq!(evaluate_all(&preds, &attrs()), Ok(true));
    }

    #[test]
    fn fails_when_one_false() {
        let preds = vec![p("age", Comparison::Gte, AttributeValue::Int(65))];
        assert_eq!(evaluate_all(&preds, &attrs()), Ok(false));
    }

    #[test]
    fn missing_attribute_errors() {
        let preds = vec![p("ssn", Comparison::Eq, AttributeValue::Int(1))];
        assert_eq!(
            evaluate_all(&preds, &attrs()),
            Err(PredicateError::MissingAttribute("ssn".into()))
        );
    }

    #[test]
    fn ordered_comparison_on_text_errors() {
        let preds = vec![p(
            "jurisdiction",
            Comparison::Gt,
            AttributeValue::Text("AA".into()),
        )];
        assert_eq!(
            evaluate_all(&preds, &attrs()),
            Err(PredicateError::NonNumericOrdering)
        );
    }
}
