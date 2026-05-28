# Agent lifecycle (GENERIC — reusable across projects)

> The generic addyosmani/agent-skills lifecycle. Project-specific contract lives in
> `.ai/context.md`. `bun run sync:ai` assembles both into the generated entry files.

## Per-feature pipeline (MANDATORY)
For ANY non-trivial change a developer agent makes, follow the
addyosmani/agent-skills lifecycle, per vertical slice:
1. `/spec`   — if the slice introduces a new contract/behavior, write/extend the
               spec in `.ai/specs/` before code (skill: spec-driven-development).
               If it's covered by the approved `.ai/specs/01-spec.md`, cite the section.
2. `/plan`   — decompose into tasks (skill: planning-and-task-breakdown);
               append to `.ai/specs/02-plan.md`.
3. `/build`  — implement ONE thin vertical slice at a time
               (skill: incremental-implementation). Append every error hit to
               `.ai/memory.md` as `symptom → root cause → fix`.
4. `/test`   — red-green-refactor, prove with evidence, with the project's test runner
               (skill: test-driven-development). Reuse fixtures; no dup tests.
               Record out-of-scope items in `.ai/specs/98-nice-to-haves.md`.
5. `/review` — self-review against the five-axis checklist
               (skill: code-review-and-quality). Push back on nested ifs >2,
               functions >50 lines, duplication, over-abstraction, bad names.
Repeat per slice until the feature is complete.

## Project-level finish (run ONCE, after all slices)
6. `/consensus-review` — parallel fan-out: code-reviewer + security-auditor +
   performance-reviewer; require 2-of-3 APPROVE; write `.ai/specs/03-review.md`.
   (This is the "parallel fan-out" stage — it lives here, not in `/ship`.) In Claude Code,
   run it as a dynamic Workflow: `.ai/workflows/consensus-review.workflow.js`.
7. `/code-simplify` — apply reviewer findings (Chesterton's Fence).
8. `/ship` — Conventional, atomic commits ONLY. NEVER push, NEVER open a PR,
   NEVER touch a remote. Print `git log`, clean tree, and a ready-to-paste PR body.
9. `/acceptance` (custom) — write `.ai/specs/99-acceptance.md`: per-requirement
   traceability matrix (requirement → file:line → test → ✅/⚠️/❌), evidence, gaps,
   one-line verdict. ✅ requires BOTH implementation AND a passing test.
10. `/goal` (built-in completion loop — the closer) — keep working across turns until
    acceptance holds; do NOT author a `goal.md`. Completion is local commits + green
    acceptance, never a push.

## Continuous evolution (OPTIONAL — all CLIs)
11. `/evolve` (skill: evolve) — periodically, or after a big feature, scan the repo and
    keep the `.ai/` source-of-truth honest. It diffs **code-reality vs `.ai/context.md` +
    `.ai/specs/`** across five dimensions and writes proposed patches to
    `.ai/specs/97-evolution.md`. It PROPOSES, never applies — a human reviews and applies,
    then re-runs `bun run sync:ai`. On **Claude Code** it accelerates with a `/graphify`
    knowledge graph + the `evolve-scan` dynamic Workflow; **other CLIs** (and Claude Code
    without graphify) fall back to a direct scan + native sub-agents. Same report either way.

## Parallel work — Agent Teams / dynamic Workflows (Claude Code) / sub-agents (generic tools)
Same idea, named per tool. In **Claude Code** you have two mechanisms:
- an **Agent Team** — parallel teammates coordinating via the shared task list / SendMessage
  (best when teammates need to talk mid-flight);
- a **dynamic `Workflow`** — a deterministic script that fans out subagents with a gate /
  pipeline (best for scripted, repeatable fan-out). Ready-made scripts live in
  `.ai/workflows/` (Claude-Code-only; see its README): `consensus-review.workflow.js`
  (the 2-of-3 panel), `parallel-slices.workflow.js` (file-disjoint slices),
  `evolve-scan.workflow.js` (the `/evolve` engine). Run e.g.
  `Workflow({ scriptPath: ".ai/workflows/consensus-review.workflow.js", args: { base: "main" } })`.

In **generic agents** (Codex, Gemini, opencode) launch **sub-agents** — same intent, no
`Workflow` tool. USE any of these for:
- a concurrency-sensitive module (one teammate proves ordering/correctness, one hunts races);
- the `/consensus-review` 2-of-3 panel (code-reviewer + security-auditor + performance-reviewer);
- independent, file-disjoint slices built in parallel (e.g. app/routes vs core vs workers vs db).
ALWAYS brief each teammate/sub-agent with FRESH, verified context — the relevant
`.ai/specs/` section, the actual source files to read, and confirmed library APIs (not
guesses). Each writes ONLY its own files; the lead then runs the integrated lint + typecheck +
test suite and a `/review` pass before any commit. NO stale info — make them read ground truth.
DON'T use a team/Workflow for single-file edits, trivial changes, or doc tweaks — the 3–5×
token cost isn't worth it; one focused agent is better there.
