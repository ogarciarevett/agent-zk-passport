export const meta = {
	name: "evolve-scan",
	description:
		"Fan out drift analysis between the live repo (optionally a /graphify knowledge graph) and the .ai/ source-of-truth, returning ranked evolution patches. Engine behind the evolve skill.",
	phases: [
		{ title: "Scan", detail: "one analyst per drift dimension" },
		{ title: "Rank", detail: "de-dupe and order proposed patches by leverage" },
	],
};

// Claude-Code-only. The `evolve` skill runs `/graphify` (or its CLI) first so a graph
// exists at graphify-out/graph.json, then calls this workflow with { hasGraph: true }.
// With no graph the analysts fall back to direct grep/glob/Read. This script RETURNS
// ranked patches — it never edits .ai/ sources. The LEAD writes them into
// .ai/specs/97-evolution.md for the human to review and apply (hard rule: human applies).

const hasGraph = !!(args && args.hasGraph);
const graphHint = hasGraph
	? `A /graphify knowledge graph exists. Use \`graphify query "<question>"\` to map reality fast, then CONFIRM each claim against the actual files before reporting it.`
	: `No knowledge graph is available — read the repo directly with Grep / Glob / Read.`;

const DIMENSIONS = [
	{
		key: "contract",
		q: "Does .ai/context.md (Project / Stack / Definition of Done / Hard rules) still match the actual code, tooling, and scripts?",
	},
	{
		key: "stack",
		q: "Have dependencies, frameworks, runtimes, or the build/test/lint/typecheck commands drifted from what .ai/context.md and the package manifests declare?",
	},
	{
		key: "specs",
		q: "Do .ai/specs/ (00-requirements, 01-spec, 02-plan) still describe what the code actually does? Surface implemented-but-unspecced behavior AND specced-but-unbuilt items.",
	},
	{
		key: "pipeline",
		q: "Do .ai/commands/, .ai/skills/, and .ai/pipeline.md still reflect how work is actually done here? Are there new commands/skills, or stale references?",
	},
	{
		key: "surface",
		q: "New public interfaces, env vars, or security-relevant surfaces (external inputs, secret handling) that are undocumented in .ai/?",
	},
];

const FINDING_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["dimension", "drift"],
	properties: {
		dimension: { type: "string" },
		drift: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"where",
					"observed",
					"documented",
					"target",
					"proposedPatch",
					"confidence",
				],
				properties: {
					where: { type: "string", description: "ground-truth code path / file:line" },
					observed: { type: "string", description: "what the code/tooling actually does now" },
					documented: { type: "string", description: "what .ai/ currently says, or 'absent'" },
					target: { type: "string", description: ".ai/ source file the patch would touch" },
					proposedPatch: { type: "string", description: "concrete edit to the .ai/ source" },
					confidence: { enum: ["high", "medium", "low"] },
				},
			},
		},
	},
};

phase("Scan");
const findings = await parallel(
	DIMENSIONS.map((d) => () =>
		agent(
			`You audit DRIFT between the live repo (ground truth) and the .ai/ source-of-truth docs.\n` +
				`${graphHint}\n\n` +
				`Dimension: ${d.key}\nQuestion: ${d.q}\n\n` +
				`For each drift item: cite the ground-truth location, state what the code does vs what .ai/\n` +
				`says, name the .ai/ file to patch, and write the CONCRETE proposed edit. Propose patches\n` +
				`ONLY to .ai/ sources (context.md, pipeline.md, specs/, commands/, skills/) — NEVER to\n` +
				`generated files (AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/, .gemini/, .opencode/, .claude/).\n` +
				`Be honest about confidence. Return an empty drift list if the docs already match reality.`,
			{ label: d.key, phase: "Scan", schema: FINDING_SCHEMA },
		),
	),
);

const all = findings
	.filter(Boolean)
	.flatMap((f) => (f.drift || []).map((x) => ({ dimension: f.dimension, ...x })));
log(`${all.length} drift item(s) across ${DIMENSIONS.length} dimensions`);

if (!all.length) {
	return { drift: [], note: "No drift — .ai/ is in sync with the repo." };
}

phase("Rank");
const ranked = await agent(
	`These are drift findings between the repo and its .ai/ source-of-truth docs:\n\n` +
		`${JSON.stringify(all, null, 2)}\n\n` +
		`De-duplicate overlapping items, drop anything purely cosmetic, then order the rest by\n` +
		`LEVERAGE (impact on agent correctness × confidence). Keep every field on each item.`,
	{
		label: "rank",
		phase: "Rank",
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["ranked"],
			properties: { ranked: { type: "array", items: { type: "object" } } },
		},
	},
);

return { drift: (ranked && ranked.ranked) || all };
