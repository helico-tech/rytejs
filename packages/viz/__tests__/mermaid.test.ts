import { describe, expect, test } from "vitest";
import { toMermaid } from "../src/mermaid.js";
import type { GraphInput } from "../src/types.js";

const graph: GraphInput = {
	definition: {
		name: "order",
		states: ["Draft", "Placed", "Shipped", "Delivered", "Cancelled"],
	},
	transitions: [
		{ from: "Draft", command: "PlaceOrder", to: ["Placed"] },
		{ from: "Draft", command: "CancelOrder", to: ["Cancelled"] },
		{ from: "Placed", command: "ShipOrder", to: ["Shipped"] },
		{ from: "Placed", command: "CancelOrder", to: ["Cancelled"] },
		{ from: "Shipped", command: "ConfirmDelivery", to: ["Delivered"] },
	],
};

describe("toMermaid", () => {
	test("generates valid stateDiagram-v2", () => {
		const result = toMermaid(graph);
		expect(result).toContain("stateDiagram-v2");
		expect(result).toContain("Draft --> Placed : PlaceOrder");
		expect(result).toContain("Draft --> Cancelled : CancelOrder");
		expect(result).toContain("Placed --> Shipped : ShipOrder");
		expect(result).toContain("Placed --> Cancelled : CancelOrder");
		expect(result).toContain("Shipped --> Delivered : ConfirmDelivery");
	});

	test("handles multiple targets per transition", () => {
		const g: GraphInput = {
			definition: { name: "test", states: ["A", "B", "C"] },
			transitions: [{ from: "A", command: "Go", to: ["B", "C"] }],
		};
		const result = toMermaid(g);
		expect(result).toContain("A --> B : Go");
		expect(result).toContain("A --> C : Go");
	});

	test("skips transitions with no targets", () => {
		const g: GraphInput = {
			definition: { name: "test", states: ["A", "B"] },
			transitions: [{ from: "A", command: "Noop", to: [] }],
		};
		const result = toMermaid(g);
		expect(result).not.toContain("Noop");
	});

	test("highlights terminal states", () => {
		const result = toMermaid(graph, { highlightTerminal: true });
		expect(result).toContain("Delivered --> [*]");
		expect(result).toContain("Cancelled --> [*]");
		expect(result).not.toContain("Draft --> [*]");
	});

	test("uses custom title", () => {
		const result = toMermaid(graph, { title: "Order Flow" });
		expect(result).toContain("---");
		expect(result).toContain("title: Order Flow");
	});

	test("handles empty transitions", () => {
		const g: GraphInput = {
			definition: { name: "empty", states: ["A"] },
			transitions: [],
		};
		const result = toMermaid(g);
		expect(result).toContain("stateDiagram-v2");
	});
});
