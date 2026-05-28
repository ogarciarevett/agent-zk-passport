export const meta = {
	name: "parallel-slices",
	description:
		"Build file-disjoint vertical slices concurrently (one agent per slice), then hand back for the integrated lint+typecheck+test and /review.",
	phases: [{ title: "Build", detail: "one agent per file-disjoint slice" }],
};

// Claude-Code-only. Use ONLY for genuinely file-disjoint slices (e.g. app/routes vs
// core vs workers vs db) — that is what makes concurrent edits in one tree safe. For
// slices that would touch the same files, add `isolation: "worktree"` per agent (each
// gets its own git worktree) and merge afterwards. Pass slices as args:
//   Workflow({ scriptPath: ".ai/workflows/parallel-slices.workflow.js", args: {
//     slices: [
//       { label: "routes", files: "app/routes/**", task: "Add POST /orders ..." },
//       { label: "core",   files: "src/core/**",   task: "Implement the Order model ..." },
//     ] } })
// Each agent writes ONLY its own files. The LEAD then runs the integrated suite + /review
// before any commit. NEVER push (hard rule).

const slices = (args && args.slices) || [];
if (!slices.length) {
	log("No slices passed in args.slices — nothing to build.");
	return { built: [] };
}

const SLICE_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["label", "status", "summary", "files"],
	properties: {
		label: { type: "string" },
		status: { enum: ["done", "blocked"] },
		summary: { type: "string" },
		files: { type: "array", items: { type: "string" } },
		notes: { type: "string" },
	},
};

phase("Build");
const built = await parallel(
	slices.map((s) => () =>
		agent(
			`Build ONE vertical slice of the feature, TDD-style (RED → GREEN → refactor).\n\n` +
				`Slice: ${s.label}\n` +
				`You may ONLY create or edit files under: ${s.files}. Touch nothing else — another\n` +
				`agent owns the rest in parallel.\n` +
				`Read the relevant .ai/specs/ section and the existing patterns in your area before writing.\n\n` +
				`Task:\n${s.task}\n\n` +
				`Write a failing test first, implement the minimum to pass it, then refactor. Append any\n` +
				`error you hit to .ai/memory.md as "symptom → root cause → fix". Report the files you\n` +
				`changed and whether the slice is done or blocked (with the blocker).`,
			{
				label: s.label,
				phase: "Build",
				schema: SLICE_SCHEMA,
				...(s.isolate ? { isolation: "worktree" } : {}),
			},
		),
	),
);

const ok = built.filter(Boolean);
const done = ok.filter((b) => b.status === "done").length;
log(`${done}/${slices.length} slices done — lead now runs the integrated suite + /review`);
return { built: ok };
