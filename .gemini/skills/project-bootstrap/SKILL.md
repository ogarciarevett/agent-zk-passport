---
name: project-bootstrap
description: Turns the blank cross-ai-template into a project-specific setup. Interviews the user for project, locked stack, Definition-of-Done commands, and hard rules, then fills .ai/context.md (and optionally seeds .ai/specs/00-requirements.md) and regenerates every tool's config with `bun run sync:ai`. Use once, right after starting from the template, while .ai/context.md still has `<!-- FILL -->` placeholders, or when the user says "bootstrap", "set up this template", or "/bootstrap".
---

# Project Bootstrap

## Overview

The template ships with a generic contract: `.ai/context.md` is full of `<!-- FILL: … -->`
markers and `.ai/specs/*` are empty skeletons. This skill turns that blank scaffold into a
project-specific setup — the way `npm create vite` turns a prompt into a configured app —
by interviewing the user, writing the answers into the source of truth, and regenerating
every tool's config from it.

It is the *Define-phase entry point* for a brand-new repo. It composes two existing skills:
`interview-me` (how to extract intent one question at a time) and, optionally,
`spec-driven-development` (to take the requirements all the way into `01-spec.md`).

## When to Use

- Right after cloning / starting from the template, while `.ai/context.md` still has
  `<!-- FILL -->` markers.
- The user invokes `/bootstrap`, or says "set up this template", "configure this for my stack".

**When NOT to use:** `.ai/context.md` is already filled (no FILL markers) — this is a one-time
setup. If asked to re-run, confirm first; you'd be overwriting a real contract.

## Workflow (gated)

### 1. Check state
Read `.ai/context.md`. If it has no `<!-- FILL -->` markers it's already bootstrapped — STOP and
ask the user whether they really want to overwrite it before continuing.

### 2. Interview (one question at a time, best guess attached)
Apply `interview-me`: ask ONE question at a time, each with your best guess, until you can
predict the answers. Gather, in order:

1. **Project** — what it does, who uses it, and the single dominant correctness/quality
   constraint (e.g. "per-tenant isolation", "p99 < 100 ms", "exactly-once", "no data loss").
2. **Stack (LOCKED)** — runtime/language, web framework, validation lib, datastore + ORM,
   queue/cache, logger, test runner, linter/formatter — and explicit **NO**s (what's out of
   bounds). Infer sensible defaults from any files already in the repo and confirm them.
3. **Definition of Done** — the exact commands: test runner + coverage threshold, typecheck
   command, lint/format command, plus any project-specific gates.
4. **Hard rules** — project-specific additions to the always/never list (the generic ones —
   never push/deploy, never commit secrets — are already there).
5. **Requirements (optional)** — enough to seed `00-requirements.md`, or defer to `/spec`.

Don't invent stack choices — if you can't infer one with confidence, ask.

### 3. Write `.ai/context.md`
Replace each `<!-- FILL -->` block with the gathered content. Keep it terse (it's inlined into
every tool's prompt). **Do not touch** the "Source-of-truth convention" or "Memory protocol"
sections — they're generic and must stay. Set the title `# Agent Operating Contract — <name>`.

### 4. Seed requirements (optional)
If you gathered requirements, write them verbatim into `.ai/specs/00-requirements.md` (replace
the skeleton). Otherwise tell the user to run `/spec` next. For a full spec now, hand off to
`spec-driven-development`.

### 5. Regenerate
Run `bun run sync:ai` (or `bun scripts/sync-ai-docs.ts`). This rewrites `AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, `.ai/generated/rules.mdc`, and every tool mirror from the new sources.

### 6. Confirm & hand off
Show what changed (the new contract + the sync summary), remind the human to commit (the agent
never pushes), and point to the next step: `/spec → /plan → /build → /test → /review`.

## Rules
1. One-time, gated: never overwrite an already-filled `.ai/context.md` without explicit confirmation.
2. Never invent the stack — infer-and-confirm, or ask.
3. Never write secrets into `context.md` or `memory.md`.
4. Keep `context.md` terse — it is loaded into every agent's context on every session.
5. Always finish by running the sync, so the generated configs match the new contract.

## Output
A filled `.ai/context.md` (+ optionally `00-requirements.md`) and regenerated per-tool configs,
ready to commit. The repo now follows the project's own contract in every supported AI tool.
