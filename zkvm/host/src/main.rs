//! CLI bridge so the TypeScript `risc0` proof backend can prove/verify by spawning this binary
//! (no FFI needed). Protocol is line-oriented JSON on stdin/stdout:
//!
//!   passport-prover prove   < {GuestInput}            > {"journal":..,"proof":"<b64>"}
//!   passport-prover verify  < {"proof":"<b64>"}       > {"ok":true,"journal":..}
//!
//! Build once: `cargo build --release` in zkvm/. See packages/proof/src/risc0-backend.ts.
use std::io::{self, Read};

use anyhow::{anyhow, Result};
use passport_prover::{decode_receipt, encode_receipt, prove, verify};
use serde::Deserialize;
use zk_predicates::GuestInput;

#[derive(Deserialize)]
struct VerifyRequest {
    proof: String,
}

fn main() -> Result<()> {
    let mode = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow!("usage: passport-prover <prove|verify>"))?;
    let mut stdin = String::new();
    io::stdin().read_to_string(&mut stdin)?;

    match mode.as_str() {
        "prove" => {
            let input: GuestInput = serde_json::from_str(&stdin)?;
            let receipt = prove(&input)?;
            let journal = verify(&receipt)?;
            println!(
                "{}",
                serde_json::json!({ "journal": journal, "proof": encode_receipt(&receipt)? })
            );
        }
        "verify" => {
            let req: VerifyRequest = serde_json::from_str(&stdin)?;
            match decode_receipt(&req.proof).and_then(|r| verify(&r)) {
                Ok(journal) => {
                    println!("{}", serde_json::json!({ "ok": true, "journal": journal }))
                }
                Err(e) => println!(
                    "{}",
                    serde_json::json!({ "ok": false, "reason": e.to_string() })
                ),
            }
        }
        other => return Err(anyhow!("unknown mode '{other}' (expected prove|verify)")),
    }
    Ok(())
}
