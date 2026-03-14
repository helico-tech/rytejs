import type { DiagramOptions, GraphInput } from "./types.js";

/**
 * Generates a D2 diagram from a workflow graph.
 * Output is a string of D2 source code.
 */
export function toD2(graph: GraphInput, options: DiagramOptions = {}): string {
	const lines: string[] = [];

	if (options.title) {
		lines.push(`# ${options.title}`);
		lines.push("");
	}

	// Declare all states
	for (const state of graph.definition.states) {
		lines.push(state);
	}

	if (graph.transitions.length > 0) {
		lines.push("");
	}

	for (const transition of graph.transitions) {
		for (const target of transition.to) {
			lines.push(`${transition.from} -> ${target}: ${transition.command}`);
		}
	}

	if (options.highlightTerminal) {
		const statesWithOutgoing = new Set(
			graph.transitions.filter((t) => t.to.length > 0).map((t) => t.from),
		);
		lines.push("");
		for (const state of graph.definition.states) {
			if (!statesWithOutgoing.has(state)) {
				lines.push(`${state}.style.fill: "#e0e0e0"`);
			}
		}
	}

	return lines.join("\n");
}
