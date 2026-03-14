import type { DiagramOptions, GraphInput } from "./types.js";

/**
 * Generates a Mermaid stateDiagram-v2 from a workflow graph.
 * Output is a string of Mermaid source code.
 */
export function toMermaid(graph: GraphInput, options: DiagramOptions = {}): string {
	const lines: string[] = [];

	if (options.title) {
		lines.push("---");
		lines.push(`title: ${options.title}`);
		lines.push("---");
	}

	lines.push("stateDiagram-v2");

	for (const transition of graph.transitions) {
		for (const target of transition.to) {
			lines.push(`    ${transition.from} --> ${target} : ${transition.command}`);
		}
	}

	if (options.highlightTerminal) {
		const statesWithOutgoing = new Set(
			graph.transitions.filter((t) => t.to.length > 0).map((t) => t.from),
		);
		for (const state of graph.definition.states) {
			if (!statesWithOutgoing.has(state)) {
				lines.push(`    ${state} --> [*]`);
			}
		}
	}

	return lines.join("\n");
}
