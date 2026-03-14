/** Minimal transition info needed for diagram generation. */
export interface TransitionEdge {
	readonly from: string;
	readonly command: string;
	readonly to: readonly string[];
}

/**
 * Input for diagram generation functions.
 * Matches the shape returned by WorkflowRouter.inspect().
 */
export interface GraphInput {
	readonly definition: {
		readonly name: string;
		readonly states: readonly string[];
	};
	readonly transitions: readonly TransitionEdge[];
}

/** Options for diagram generation. */
export interface DiagramOptions {
	/** Title for the diagram. Defaults to the definition name. */
	title?: string;
	/** States with no outgoing transitions are highlighted as terminal. */
	highlightTerminal?: boolean;
}
