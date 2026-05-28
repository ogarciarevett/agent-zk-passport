# `.ai/workflows/` — dynamic Workflow scripts (Claude Code ONLY)

These are **dynamic Workflow** scripts for the Claude Code `Workflow` tool. They
orchestrate fleets of subagents deterministically (fan-out, gate, pipeline) for the
parallel stages of `.ai/pipeline.md`.

> ⚠️ **Claude-Code-only — like `/graphify`.** The `Workflow` tool does not exist in
> Codex, Gemini CLI, or opencode. In those tools, run the same stage with their native
> sub-agents (see the "Parallel work" section of `.ai/pipeline.md`). These scripts are
> therefore the single source of truth and live ONLY here — `sync-ai-docs.ts` does not
> copy them into any per-tool tree; the `Workflow` tool reads them by path.

## How to run

From the repo root, inside a Claude Code session:

```
Workflow({ scriptPath: ".ai/workflows/consensus-review.workflow.js", args: { base: "main" } })
```

The tool runs the script in the background and notifies you on completion. Each script
**returns data** — it never commits or edits `.ai/` sources itself. The lead (you)
acts on the returned data: writes the spec/review file, applies fixes, re-runs the gate.

## The scripts

| Script | Pipeline stage | What it does |
|---|---|---|
| `consensus-review.workflow.js` | step 6 `/consensus-review` | Three reviewers (code / security / performance) score the branch concurrently; returns a 2-of-3 gate verdict. Lead writes `.ai/specs/03-review.md`. |
| `parallel-slices.workflow.js` | `/build` (parallel) | Builds **file-disjoint** vertical slices concurrently, one agent per slice. Lead runs the integrated lint+typecheck+test and `/review`. |
| `evolve-scan.workflow.js` | `/evolve` (optional) | Fans out drift analysis between the live repo (optionally a `/graphify` graph) and the `.ai/` source-of-truth; returns ranked evolution patches. Backs the `evolve` skill. |

## When NOT to use a Workflow

Same rule as Agent Teams: single-file edits, trivial changes, and doc tweaks are cheaper
and better as one focused agent. Reach for a Workflow only for genuine parallel fan-out
(the consensus panel, file-disjoint slices) or large scripted sweeps (evolve).
