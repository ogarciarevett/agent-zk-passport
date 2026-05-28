---
description: "Write .ai/specs/99-acceptance.md — per-requirement traceability matrix (requirement → file:line → test → ✅/⚠️/❌)"
---

# /acceptance — traceability & gate (pipeline step 9)

Produce `.ai/specs/99-acceptance.md`: prove every requirement in `00-requirements.md` is both
implemented and tested. ✅ requires BOTH a `file:line` implementation pointer AND a passing test.

## Steps
1. Run the gate commands and capture their output — tests, coverage vs threshold, typecheck,
   lint (the exact commands from `.ai/context.md`'s Definition of Done).
2. For each requirement in `00-requirements.md`, fill a row:
   `| # | requirement | implementation (file:line) | proving test | ✅ / ⚠️ / ❌ |`.
   ⚠️ = implemented but with a documented limitation; ❌ = not done.
3. List honest gaps & limitations, each pointing to `98-nice-to-haves.md`.
4. End with a one-line verdict (GOAL MET / NOT YET).

## Notes
- Status legend: ✅ done & tested · ⚠️ done with a documented limitation · ❌ not done.
- This is the evidence step before `/goal` (the built-in completion loop) closes the work.
  `/goal` keeps iterating until this acceptance file is green — it does not author its own file.
