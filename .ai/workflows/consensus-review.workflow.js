export const meta = {
	name: "consensus-review",
	description:
		"2-of-3 reviewer fan-out (code-reviewer + security-auditor + performance-reviewer) with a hard gate. Pipeline step 6.",
	phases: [
		{ title: "Review", detail: "three reviewers score the branch concurrently" },
		{ title: "Gate", detail: "require 2-of-3 APPROVE; any Critical blocks" },
	],
};

// Claude-Code-only. Run once a feature's slices are all built, from the repo root:
//   Workflow({ scriptPath: ".ai/workflows/consensus-review.workflow.js", args: { base: "main" } })
// Reviewers are READ-ONLY; this script returns a verdict object. The LEAD writes
// .ai/specs/03-review.md from it (verdict table + per-finding disposition + gate evidence)
// and applies any fixes, then re-runs the gate.

const base = (args && args.base) || "main";

const VERDICT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["verdict", "summary", "findings"],
	properties: {
		verdict: { enum: ["APPROVE", "REQUEST_CHANGES"] },
		summary: { type: "string" },
		findings: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["severity", "file", "title", "detail"],
				properties: {
					severity: { enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
					file: { type: "string" },
					title: { type: "string" },
					detail: { type: "string" },
					fix: { type: "string" },
				},
			},
		},
	},
};

const REVIEWERS = [
	{
		key: "code-reviewer",
		agentType: "code-reviewer",
		lens: "five-axis review: correctness, readability, architecture, security, performance",
	},
	{
		key: "security-auditor",
		agentType: "security-auditor",
		lens: "vulnerability / OWASP-style audit: injection, authz, secrets in logs, unsafe input handling",
	},
	{
		key: "performance-reviewer",
		agentType: "performance-reviewer",
		lens: "hot paths, allocations, I/O & query cost, concurrency, throughput under load",
	},
];

phase("Review");
const reviews = await parallel(
	REVIEWERS.map((r) => () =>
		agent(
			`You are reviewing the change set on this branch against \`${base}\` (pipeline step 6).\n\n` +
				`Read GROUND TRUTH first — do not review from guesses:\n` +
				`  - \`git diff ${base}...HEAD\` for the full diff and \`git diff ${base}...HEAD --stat\` for scope\n` +
				`  - read every changed source file in full, not just the hunks\n` +
				`  - read the relevant .ai/specs/ sections (00-requirements, 01-spec) the change claims to satisfy\n\n` +
				`Apply your lens: ${r.lens}.\n` +
				`Return a verdict (APPROVE or REQUEST_CHANGES) and a findings list. Anything that breaks ` +
				`correctness, leaks a secret, or opens a vulnerability is CRITICAL. Cite file:line in each finding.`,
			{
				label: r.key,
				phase: "Review",
				agentType: r.agentType,
				schema: VERDICT_SCHEMA,
			},
		),
	),
);

phase("Gate");
const reviewers = REVIEWERS.map((r, i) => ({ reviewer: r.key, result: reviews[i] }));
const valid = reviews.filter(Boolean);
const approvals = valid.filter((v) => v.verdict === "APPROVE").length;
const criticals = valid
	.flatMap((v) => v.findings || [])
	.filter((f) => f.severity === "CRITICAL");
const gate = approvals >= 2 && criticals.length === 0 ? "PASS" : "FAIL";

log(
	`${approvals}/3 APPROVE · ${criticals.length} CRITICAL finding(s) · gate ${gate}`,
);

// Lead next: write .ai/specs/03-review.md (verdict table, per-finding disposition
// — ✅ FIXED now vs 📋 DEFERRED → 98-nice-to-haves.md — and gate-command evidence).
// If gate === "FAIL", remediate (often via /code-simplify) and re-run this workflow.
return { gate, approvals, criticalCount: criticals.length, criticals, reviewers };
