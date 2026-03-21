import type { WorkflowSnapshot } from "@rytejs/core";
import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

// ── Order workflow definition used throughout this file ─────────────────────

const definition = defineWorkflow("order", {
	states: {
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
	},
	commands: {
		Ship: z.object({}),
	},
	events: {
		OrderShipped: z.object({ orderId: z.string() }),
	},
	errors: {
		AlreadyShipped: z.object({}),
	},
});

// #region snapshot
const wf = definition.createWorkflow("order-1", {
	initialState: "Placed",
	data: { items: ["apple"], placedAt: new Date() },
});

const snap = definition.serialize(wf);
// {
//   id: "order-1",
//   definitionName: "order",
//   state: "Placed",
//   data: { items: ["apple"], placedAt: "2026-03-14T..." },
//   createdAt: "2026-03-14T10:00:00.000Z",
//   updatedAt: "2026-03-14T10:00:00.000Z",
//   modelVersion: 1,
// }
// #endregion snapshot

// #region restore
const result = definition.deserialize(snap);

if (result.ok) {
	// result.workflow is a fully typed Workflow<TConfig>
	// Dates are reconstructed from ISO strings
	console.log(result.workflow.createdAt instanceof Date); // true
} else {
	// result.error is a ValidationError with source: "restore"
	console.log(result.error.issues);
}
// #endregion restore

// ── Persistence stubs ───────────────────────────────────────────────────────

declare const db: {
	put(key: string, value: string): Promise<void>;
	get(key: string): Promise<string>;
};

// #region persistence
(async () => {
	const workflow = definition.createWorkflow("order-2", {
		initialState: "Placed",
		data: { items: ["banana"], placedAt: new Date() },
	});

	// Save
	const snap = definition.serialize(workflow);
	await db.put(`workflow:${snap.id}`, JSON.stringify(snap));

	// Load
	const json = await db.get(`workflow:${workflow.id}`);
	const result = definition.deserialize(JSON.parse(json));
})();
// #endregion persistence

// ── Model versioning ────────────────────────────────────────────────────────

const definitionV2 = defineWorkflow("order", {
	modelVersion: 2,
	states: {
		Placed: z.object({ items: z.array(z.string()), placedAt: z.coerce.date() }),
	},
	commands: {
		Ship: z.object({}),
	},
	events: {
		OrderShipped: z.object({ orderId: z.string() }),
	},
	errors: {
		AlreadyShipped: z.object({}),
	},
});

// #region model-version
const wfV2 = definitionV2.createWorkflow("order-3", {
	initialState: "Placed",
	data: { items: ["cherry"], placedAt: new Date() },
});

const snapV2 = definitionV2.serialize(wfV2);
snapV2.modelVersion; // 2
// #endregion model-version

// ── Version-check stubs ─────────────────────────────────────────────────────

declare const stored: string;
declare function migrateV1toV2(data: unknown): unknown;

// #region version-check
{
	const snap = JSON.parse(stored) as {
		modelVersion: number;
		data: unknown;
		[key: string]: unknown;
	};

	if (snap.modelVersion === 1) {
		// Transform v1 data to v2 shape
		snap.data = migrateV1toV2(snap.data);
		snap.modelVersion = 2;
	}

	const result = definitionV2.deserialize(snap as unknown as WorkflowSnapshot);
}
// #endregion version-check
