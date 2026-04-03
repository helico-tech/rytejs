# Server Field Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `server()` schema marker that prevents sensitive fields from being serialized to clients, with full TypeScript type safety.

**Architecture:** `server()` brands Zod schemas at both runtime (Symbol) and type level (phantom property). `defineWorkflow` pre-computes `_clientResolved` types alongside existing `_resolved`. Two new methods on `WorkflowDefinition` — `serializeForClient()` strips data, `forClient()` returns a client-safe definition with derived schemas.

**Tech Stack:** TypeScript, Zod v4, Vitest

**Spec:** `docs/superpowers/specs/2026-04-03-server-field-visibility-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/server.ts` | Create | `server()`, `Server<T>`, `isServerField()`, `stripServerData()`, `deriveClientSchema()`, `ClientInfer` type |
| `packages/core/src/types.ts` | Modify | Add `ClientStateData`, `ClientWorkflowOf`, `ClientWorkflow`; extend `WorkflowConfig` with `_clientResolved` |
| `packages/core/src/definition.ts` | Modify | Add `ClientWorkflowDefinition` interface, `serializeForClient()`, `forClient()` methods; update `defineWorkflow` return type with `_clientResolved` |
| `packages/core/src/index.ts` | Modify | Export new public types and `server` function |
| `packages/core/__tests__/server.test.ts` | Create | All tests for server field visibility |

---

### Task 1: `server()` marker and `isServerField()`

**Files:**
- Create: `packages/core/src/server.ts`
- Create: `packages/core/__tests__/server.test.ts`

- [ ] **Step 1: Write failing tests for `server()` and `isServerField()`**

```typescript
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { isServerField, server } from "../src/server.js";

describe("server()", () => {
	test("marks a schema as server-only", () => {
		const schema = server(z.string());
		expect(isServerField(schema)).toBe(true);
	});

	test("unmarked schemas are not server-only", () => {
		const schema = z.string();
		expect(isServerField(schema)).toBe(false);
	});

	test("preserves Zod validation behavior", () => {
		const schema = server(z.string().min(3));
		expect(schema.safeParse("hello").success).toBe(true);
		expect(schema.safeParse("hi").success).toBe(false);
		expect(schema.safeParse(123).success).toBe(false);
	});

	test("works with complex schemas", () => {
		const schema = server(z.object({ a: z.number(), b: z.string() }));
		expect(isServerField(schema)).toBe(true);
		expect(schema.safeParse({ a: 1, b: "x" }).success).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: FAIL — module `../src/server.js` not found

- [ ] **Step 3: Implement `server()` and `isServerField()`**

Create `packages/core/src/server.ts`:

```typescript
import type { ZodType } from "zod";

const SERVER_BRAND: unique symbol = Symbol("ryte.server");

/** Brands a Zod schema type as server-only at the TypeScript level. */
export type Server<T extends ZodType> = T & { readonly [SERVER_BRAND]: true };

/**
 * Marks a Zod schema as server-only. Fields wrapped in `server()` are stripped
 * from client snapshots and excluded from client TypeScript types.
 */
export function server<T extends ZodType>(schema: T): Server<T> {
	// biome-ignore lint/suspicious/noExplicitAny: attaching runtime brand to Zod schema for server field detection
	(schema as any)[SERVER_BRAND] = true;
	return schema as Server<T>;
}

/** Returns `true` if the schema was wrapped with `server()`. */
export function isServerField(schema: ZodType): boolean {
	// biome-ignore lint/suspicious/noExplicitAny: reading runtime brand from Zod schema
	return (schema as any)[SERVER_BRAND] === true;
}

export { SERVER_BRAND };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server.ts packages/core/__tests__/server.test.ts
git commit -m "feat: add server() marker and isServerField()"
git push
```

---

### Task 2: `stripServerData()` — runtime data stripping

**Files:**
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/__tests__/server.test.ts`

- [ ] **Step 1: Write failing tests for `stripServerData()`**

Append to `packages/core/__tests__/server.test.ts`:

```typescript
import { stripServerData } from "../src/server.js";

describe("stripServerData()", () => {
	test("strips top-level server fields", () => {
		const schema = z.object({
			name: z.string(),
			ssn: server(z.string()),
		});
		const data = { name: "Alice", ssn: "123-45-6789" };
		expect(stripServerData(schema, data)).toEqual({ name: "Alice" });
	});

	test("strips nested server fields", () => {
		const schema = z.object({
			applicant: z.object({
				name: z.string(),
				ssn: server(z.string()),
			}),
			total: z.number(),
		});
		const data = { applicant: { name: "Alice", ssn: "123-45-6789" }, total: 100 };
		expect(stripServerData(schema, data)).toEqual({
			applicant: { name: "Alice" },
			total: 100,
		});
	});

	test("returns identical data when no server fields", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});
		const data = { name: "Alice", age: 30 };
		expect(stripServerData(schema, data)).toEqual({ name: "Alice", age: 30 });
	});

	test("returns empty object when all fields are server-only", () => {
		const schema = z.object({
			ssn: server(z.string()),
			secret: server(z.number()),
		});
		const data = { ssn: "123-45-6789", secret: 42 };
		expect(stripServerData(schema, data)).toEqual({});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: FAIL — `stripServerData` is not exported

- [ ] **Step 3: Implement `stripServerData()`**

Add to `packages/core/src/server.ts`:

```typescript
/**
 * Strips server-only fields from workflow data based on the state's Zod schema.
 * Recursively processes nested z.object() schemas.
 */
export function stripServerData(schema: ZodType, data: Record<string, unknown>): Record<string, unknown> {
	// biome-ignore lint/suspicious/noExplicitAny: accessing Zod v4 internal _zod.def.shape for schema introspection
	const def = (schema as any)._zod?.def;
	if (def?.type !== "object" || !def.shape) return data;

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(data)) {
		const fieldSchema = def.shape[key] as ZodType | undefined;
		if (fieldSchema && isServerField(fieldSchema)) continue;

		if (
			fieldSchema &&
			// biome-ignore lint/suspicious/noExplicitAny: checking Zod v4 internal def.type for nested object detection
			(fieldSchema as any)._zod?.def?.type === "object" &&
			data[key] !== null &&
			typeof data[key] === "object"
		) {
			result[key] = stripServerData(fieldSchema, data[key] as Record<string, unknown>);
		} else {
			result[key] = data[key];
		}
	}
	return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server.ts packages/core/__tests__/server.test.ts
git commit -m "feat: add stripServerData() for runtime field stripping"
git push
```

---

### Task 3: `deriveClientSchema()` — runtime schema derivation

**Files:**
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/__tests__/server.test.ts`

- [ ] **Step 1: Write failing tests for `deriveClientSchema()`**

Append to `packages/core/__tests__/server.test.ts`:

```typescript
import { deriveClientSchema } from "../src/server.js";

describe("deriveClientSchema()", () => {
	test("derives schema without server fields", () => {
		const schema = z.object({
			name: z.string(),
			ssn: server(z.string()),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({ name: "Alice" }).success).toBe(true);
		expect(clientSchema.safeParse({ name: "Alice", ssn: "123" }).success).toBe(false);
	});

	test("derives schema with nested server fields", () => {
		const schema = z.object({
			applicant: z.object({
				name: z.string(),
				ssn: server(z.string()),
			}),
			total: z.number(),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({ applicant: { name: "Alice" }, total: 100 }).success).toBe(true);
		expect(
			clientSchema.safeParse({ applicant: { name: "Alice", ssn: "123" }, total: 100 }).success,
		).toBe(false);
	});

	test("returns equivalent schema when no server fields", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
		expect(clientSchema.safeParse({ name: "Alice" }).success).toBe(false);
	});

	test("returns empty object schema when all fields are server-only", () => {
		const schema = z.object({
			ssn: server(z.string()),
			secret: server(z.number()),
		});
		const clientSchema = deriveClientSchema(schema);

		expect(clientSchema.safeParse({}).success).toBe(true);
		expect(clientSchema.safeParse({ ssn: "123" }).success).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: FAIL — `deriveClientSchema` is not exported

- [ ] **Step 3: Implement `deriveClientSchema()`**

Add to `packages/core/src/server.ts`:

```typescript
import { z } from "zod";

/**
 * Derives a client-safe Zod schema by removing server-only fields.
 * Recursively processes nested z.object() schemas.
 * Returns the original schema unchanged for non-object schemas.
 */
export function deriveClientSchema(schema: ZodType): ZodType {
	// biome-ignore lint/suspicious/noExplicitAny: accessing Zod v4 internal _zod.def.shape for schema introspection
	const def = (schema as any)._zod?.def;
	if (def?.type !== "object" || !def.shape) return schema;

	const clientShape: Record<string, ZodType> = {};
	for (const [key, fieldSchema] of Object.entries(def.shape as Record<string, ZodType>)) {
		if (isServerField(fieldSchema)) continue;

		// biome-ignore lint/suspicious/noExplicitAny: checking Zod v4 internal def.type for nested object detection
		if ((fieldSchema as any)._zod?.def?.type === "object") {
			clientShape[key] = deriveClientSchema(fieldSchema);
		} else {
			clientShape[key] = fieldSchema;
		}
	}
	return z.object(clientShape);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server.ts packages/core/__tests__/server.test.ts
git commit -m "feat: add deriveClientSchema() for client schema derivation"
git push
```

---

### Task 4: `serializeForClient()` on WorkflowDefinition

**Files:**
- Modify: `packages/core/src/definition.ts`
- Modify: `packages/core/__tests__/server.test.ts`

- [ ] **Step 1: Write failing tests for `serializeForClient()`**

Append to `packages/core/__tests__/server.test.ts`:

```typescript
import { defineWorkflow } from "../src/definition.js";

describe("serializeForClient()", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: z.object({
				applicantName: z.string(),
				ssn: server(z.string()),
				internalScore: server(z.number()),
			}),
			Approved: z.object({
				applicantName: z.string(),
				approvedAmount: z.number(),
				underwriterNotes: server(z.string()),
			}),
		},
		commands: {
			Approve: z.object({ amount: z.number() }),
		},
		events: {
			LoanApproved: z.object({ loanId: z.string() }),
		},
		errors: {
			CreditCheckFailed: z.object({ reason: z.string() }),
		},
	});

	test("strips server fields from snapshot data", () => {
		const wf = loanDef.createWorkflow("loan-1", {
			initialState: "Review",
			data: { applicantName: "Alice", ssn: "123-45-6789", internalScore: 95 },
		});

		const fullSnapshot = loanDef.serialize(wf);
		const clientSnapshot = loanDef.serializeForClient(wf);

		expect(fullSnapshot.data).toEqual({
			applicantName: "Alice",
			ssn: "123-45-6789",
			internalScore: 95,
		});
		expect(clientSnapshot.data).toEqual({
			applicantName: "Alice",
		});
	});

	test("preserves all non-data snapshot fields", () => {
		const wf = loanDef.createWorkflow("loan-1", {
			initialState: "Review",
			data: { applicantName: "Alice", ssn: "123-45-6789", internalScore: 95 },
		});

		const fullSnapshot = loanDef.serialize(wf);
		const clientSnapshot = loanDef.serializeForClient(wf);

		expect(clientSnapshot.id).toBe(fullSnapshot.id);
		expect(clientSnapshot.definitionName).toBe(fullSnapshot.definitionName);
		expect(clientSnapshot.state).toBe(fullSnapshot.state);
		expect(clientSnapshot.createdAt).toBe(fullSnapshot.createdAt);
		expect(clientSnapshot.updatedAt).toBe(fullSnapshot.updatedAt);
		expect(clientSnapshot.modelVersion).toBe(fullSnapshot.modelVersion);
		expect(clientSnapshot.version).toBe(fullSnapshot.version);
	});

	test("works with different states", () => {
		const wf = loanDef.createWorkflow("loan-2", {
			initialState: "Approved",
			data: { applicantName: "Bob", approvedAmount: 50000, underwriterNotes: "Good credit" },
		});

		const clientSnapshot = loanDef.serializeForClient(wf);
		expect(clientSnapshot.data).toEqual({
			applicantName: "Bob",
			approvedAmount: 50000,
		});
	});

	test("returns same data as serialize() when no server fields", () => {
		const simpleDef = defineWorkflow("simple", {
			states: { Active: z.object({ name: z.string() }) },
			commands: { DoThing: z.object({}) },
			events: { ThingDone: z.object({}) },
			errors: { Oops: z.object({}) },
		});
		const wf = simpleDef.createWorkflow("s-1", {
			initialState: "Active",
			data: { name: "test" },
		});

		const full = simpleDef.serialize(wf);
		const client = simpleDef.serializeForClient(wf);
		expect(client.data).toEqual(full.data);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: FAIL — `serializeForClient` does not exist on definition

- [ ] **Step 3: Implement `serializeForClient()`**

In `packages/core/src/definition.ts`, add the import:

```typescript
import { stripServerData } from "./server.js";
```

Add to the `WorkflowDefinition` interface (after `serialize`):

```typescript
/**
 * Serializes a workflow into a client-safe snapshot with server-only fields stripped.
 *
 * @param workflow - The workflow instance to serialize
 * @returns A {@link WorkflowSnapshot} with server-only fields removed from data
 */
serializeForClient(workflow: Workflow<TConfig>): WorkflowSnapshot<TConfig>;
```

Add to the `defineWorkflow` implementation object (after the `serialize` method):

```typescript
serializeForClient(workflow: {
	id: string;
	state: string;
	data: unknown;
	createdAt: Date;
	updatedAt: Date;
	version?: number;
}) {
	const stateSchema = config.states[workflow.state];
	const strippedData = stateSchema
		? stripServerData(stateSchema, workflow.data as Record<string, unknown>)
		: workflow.data;

	return {
		id: workflow.id,
		definitionName: name,
		state: workflow.state,
		data: strippedData,
		createdAt: workflow.createdAt.toISOString(),
		updatedAt: workflow.updatedAt.toISOString(),
		modelVersion: config.modelVersion ?? 1,
		version: workflow.version ?? 1,
	};
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: 16 tests PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All 149+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/definition.ts packages/core/__tests__/server.test.ts
git commit -m "feat: add serializeForClient() to WorkflowDefinition"
git push
```

---

### Task 5: `ClientWorkflowDefinition` and `forClient()`

**Files:**
- Modify: `packages/core/src/definition.ts`
- Modify: `packages/core/__tests__/server.test.ts`

- [ ] **Step 1: Write failing tests for `forClient()`**

Append to `packages/core/__tests__/server.test.ts`:

```typescript
describe("forClient()", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: z.object({
				applicantName: z.string(),
				ssn: server(z.string()),
				internalScore: server(z.number()),
			}),
			Approved: z.object({
				applicantName: z.string(),
				approvedAmount: z.number(),
				underwriterNotes: server(z.string()),
			}),
		},
		commands: {
			Approve: z.object({ amount: z.number() }),
		},
		events: {
			LoanApproved: z.object({ loanId: z.string() }),
		},
		errors: {
			CreditCheckFailed: z.object({ reason: z.string() }),
		},
	});

	test("returns a client definition with name", () => {
		const clientDef = loanDef.forClient();
		expect(clientDef.name).toBe("loan");
	});

	test("is memoized — returns same instance", () => {
		const a = loanDef.forClient();
		const b = loanDef.forClient();
		expect(a).toBe(b);
	});

	test("hasState() works for all states", () => {
		const clientDef = loanDef.forClient();
		expect(clientDef.hasState("Review")).toBe(true);
		expect(clientDef.hasState("Approved")).toBe(true);
		expect(clientDef.hasState("NonExistent")).toBe(false);
	});

	test("getStateSchema() returns client schema without server fields", () => {
		const clientDef = loanDef.forClient();
		const reviewSchema = clientDef.getStateSchema("Review");

		expect(reviewSchema.safeParse({ applicantName: "Alice" }).success).toBe(true);
		expect(reviewSchema.safeParse({ applicantName: "Alice", ssn: "123" }).success).toBe(false);
	});

	test("deserialize() validates against client schema", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "Review",
			data: { applicantName: "Alice" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.workflow.state).toBe("Review");
			expect(result.workflow.data).toEqual({ applicantName: "Alice" });
		}
	});

	test("deserialize() rejects data with server fields", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "Review",
			data: { applicantName: "Alice", ssn: "123-45-6789" },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(false);
	});

	test("deserialize() rejects unknown state", () => {
		const clientDef = loanDef.forClient();

		const result = clientDef.deserialize({
			id: "loan-1",
			definitionName: "loan",
			state: "NonExistent",
			data: {},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			modelVersion: 1,
			version: 1,
		});

		expect(result.ok).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: FAIL — `forClient` does not exist on definition

- [ ] **Step 3: Implement `ClientWorkflowDefinition` and `forClient()`**

In `packages/core/src/definition.ts`, add the import:

```typescript
import { deriveClientSchema } from "./server.js";
```

Add the `ClientWorkflowDefinition` interface (after the `WorkflowDefinition` interface):

```typescript
/**
 * A client-safe projection of a workflow definition.
 * State schemas have server-only fields removed. Returned by {@link WorkflowDefinition.forClient}.
 */
export interface ClientWorkflowDefinition<TConfig extends WorkflowConfig = WorkflowConfig> {
	/** The workflow definition name. */
	readonly name: string;
	/**
	 * Returns the client-safe Zod schema for a given state name.
	 * Server-only fields are removed from the schema.
	 *
	 * @param stateName - The state name to look up
	 * @throws If the state name is not found
	 */
	getStateSchema(stateName: string): ZodType;
	/**
	 * Returns `true` if the given state name exists.
	 */
	hasState(stateName: string): boolean;
	/**
	 * Deserializes a client snapshot, validating against client-safe schemas.
	 *
	 * @param snapshot - The snapshot to deserialize (should have server fields already stripped)
	 */
	deserialize(
		snapshot: WorkflowSnapshot<TConfig>,
	): { ok: true; workflow: Workflow<TConfig> } | { ok: false; error: ValidationError };
}
```

Add `forClient()` to the `WorkflowDefinition` interface (after `serializeForClient`):

```typescript
/**
 * Returns a client-safe projection of this definition.
 * State schemas have server-only fields removed. Memoized — returns the same instance on repeated calls.
 */
forClient(): ClientWorkflowDefinition<TConfig>;
```

Add to the `defineWorkflow` implementation object, right before the closing `};`:

```typescript
forClient() {
	if (cachedClientDef) return cachedClientDef;

	const clientSchemas: Record<string, ZodType> = {};
	for (const [stateName, schema] of Object.entries(config.states)) {
		clientSchemas[stateName] = deriveClientSchema(schema);
	}

	cachedClientDef = {
		name,

		getStateSchema(stateName: string): ZodType {
			const schema = clientSchemas[stateName];
			if (!schema) throw new Error(`Unknown state: ${stateName}`);
			return schema;
		},

		hasState(stateName: string): boolean {
			return stateName in clientSchemas;
		},

		deserialize(snap: {
			id: string;
			definitionName: string;
			state: string;
			data: unknown;
			createdAt: string;
			updatedAt: string;
		}) {
			const stateSchema = clientSchemas[snap.state];
			if (!stateSchema) {
				return {
					ok: false,
					error: new ValidationError("restore", [
						{
							code: "custom",
							message: `Unknown state: ${snap.state}`,
							input: snap.state,
							path: ["state"],
						},
					]),
				};
			}

			const result = stateSchema.safeParse(snap.data);
			if (!result.success) {
				return {
					ok: false,
					error: new ValidationError("restore", result.error.issues),
				};
			}

			return {
				ok: true,
				workflow: {
					id: snap.id,
					definitionName: snap.definitionName,
					state: snap.state,
					data: result.data,
					createdAt: new Date(snap.createdAt),
					updatedAt: new Date(snap.updatedAt),
				},
			};
		},
	};

	return cachedClientDef;
},
```

Also add the cache variable inside `defineWorkflow` implementation, before `return {`:

```typescript
// biome-ignore lint/suspicious/noExplicitAny: memoized client definition — typed via public overload
let cachedClientDef: any = null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: 23 tests PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All 149+ tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/definition.ts packages/core/__tests__/server.test.ts
git commit -m "feat: add forClient() and ClientWorkflowDefinition"
git push
```

---

### Task 6: Client type utilities and `_clientResolved`

**Files:**
- Modify: `packages/core/src/server.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/definition.ts`
- Modify: `packages/core/__tests__/server.test.ts`

- [ ] **Step 1: Write failing type-level tests**

Append to `packages/core/__tests__/server.test.ts`:

```typescript
import type { ClientStateData, Workflow } from "../src/types.js";

describe("client types", () => {
	const loanDef = defineWorkflow("loan", {
		states: {
			Review: z.object({
				applicantName: z.string(),
				ssn: server(z.string()),
				internalScore: server(z.number()),
			}),
			Approved: z.object({
				applicantName: z.string(),
				approvedAmount: z.number(),
			}),
		},
		commands: {
			Approve: z.object({ amount: z.number() }),
		},
		events: {
			LoanApproved: z.object({ loanId: z.string() }),
		},
		errors: {
			CreditCheckFailed: z.object({ reason: z.string() }),
		},
	});

	type LoanConfig = typeof loanDef.config;

	test("ClientStateData excludes server fields", () => {
		type ReviewClient = ClientStateData<LoanConfig, "Review">;

		// Type-level assertions via assignability
		const valid: ReviewClient = { applicantName: "Alice" };
		expect(valid.applicantName).toBe("Alice");

		// @ts-expect-error — ssn should not exist on client type
		const _ssn: ReviewClient = { applicantName: "Alice", ssn: "123" };

		// @ts-expect-error — internalScore should not exist on client type
		const _score: ReviewClient = { applicantName: "Alice", internalScore: 95 };
	});

	test("ClientStateData preserves all fields when no server markers", () => {
		type ApprovedClient = ClientStateData<LoanConfig, "Approved">;
		const valid: ApprovedClient = { applicantName: "Bob", approvedAmount: 50000 };
		expect(valid.approvedAmount).toBe(50000);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: FAIL — `ClientStateData` is not exported from types

- [ ] **Step 3: Add `ClientInfer` type to `server.ts`**

Add to `packages/core/src/server.ts`:

```typescript
import type { z } from "zod";

/**
 * Computes the client-safe inferred type from a Zod schema by stripping
 * server-branded fields. Recurses into nested z.object() schemas.
 *
 * For non-object schemas, falls back to `z.infer<T>`.
 */
// biome-ignore lint/suspicious/noExplicitAny: required for conditional type matching against Server brand
export type ClientInfer<T extends ZodType> = T extends z.ZodObject<infer Shape>
	? {
			[K in keyof Shape as Shape[K] extends Server<any> ? never : K]: Shape[K] extends z.ZodObject<
				// biome-ignore lint/suspicious/noExplicitAny: recursive type matching for nested objects
				any
			>
				? ClientInfer<Shape[K]>
				: z.infer<Shape[K]>;
		}
	: z.infer<T>;
```

**Note:** The exact Zod v4 type for `z.ZodObject<Shape>` may need adjustment. If `z.ZodObject` is not directly pattern-matchable, use `z.core.$ZodObject<Shape>` instead. Verify with `pnpm --filter @rytejs/core tsc --noEmit`.

- [ ] **Step 4: Add client types to `types.ts`**

In `packages/core/src/types.ts`, add the import:

```typescript
import type { ClientInfer } from "./server.js";
```

Extend `WorkflowConfig` with `_clientResolved`:

```typescript
export interface WorkflowConfig extends WorkflowConfigInput {
	_resolved: {
		states: Record<string, unknown>;
		commands: Record<string, unknown>;
		events: Record<string, unknown>;
		errors: Record<string, unknown>;
	};
	_clientResolved: {
		states: Record<string, unknown>;
	};
}
```

Add client type utilities (after `StateData`):

```typescript
/** Resolves the client-safe data type for a given state (server fields stripped). */
export type ClientStateData<T extends WorkflowConfig, S extends StateNames<T>> = Prettify<
	T["_clientResolved"]["states"][S]
>;

/** Client-side workflow narrowed to a specific known state. */
export interface ClientWorkflowOf<TConfig extends WorkflowConfig, S extends StateNames<TConfig>> {
	readonly id: string;
	readonly definitionName: string;
	readonly state: S;
	readonly data: ClientStateData<TConfig, S>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** Discriminated union of all possible client-side workflow states. */
export type ClientWorkflow<TConfig extends WorkflowConfig = WorkflowConfig> = {
	[S in StateNames<TConfig>]: ClientWorkflowOf<TConfig, S>;
}[StateNames<TConfig>];
```

- [ ] **Step 5: Update `defineWorkflow` return type with `_clientResolved`**

In `packages/core/src/definition.ts`, update the public overload signature:

```typescript
export function defineWorkflow<const TConfig extends WorkflowConfigInput>(
	name: string,
	config: TConfig,
): WorkflowDefinition<
	TConfig & {
		_resolved: {
			states: { [K in keyof TConfig["states"]]: z.infer<TConfig["states"][K]> };
			commands: { [K in keyof TConfig["commands"]]: z.infer<TConfig["commands"][K]> };
			events: { [K in keyof TConfig["events"]]: z.infer<TConfig["events"][K]> };
			errors: { [K in keyof TConfig["errors"]]: z.infer<TConfig["errors"][K]> };
		};
		_clientResolved: {
			states: { [K in keyof TConfig["states"]]: ClientInfer<TConfig["states"][K]> };
		};
	}
>;
```

Add the import for `ClientInfer`:

```typescript
import type { ClientInfer } from "./server.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @rytejs/core vitest run __tests__/server.test.ts`
Expected: 25 tests PASS

- [ ] **Step 7: Typecheck the entire package**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: No errors

If `z.ZodObject<infer Shape>` doesn't match in Zod v4, try `z.core.$ZodObject<infer Shape>` in the `ClientInfer` type definition. Verify which form Zod v4 exports by checking the TypeScript error messages.

- [ ] **Step 8: Run all existing tests to verify no regressions**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All 149+ tests PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/server.ts packages/core/src/types.ts packages/core/src/definition.ts packages/core/__tests__/server.test.ts
git commit -m "feat: add ClientStateData, ClientWorkflow types and _clientResolved"
git push
```

---

### Task 7: Exports, build, and full verification

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports to `index.ts`**

Add to `packages/core/src/index.ts`:

```typescript
export type { ClientWorkflowDefinition } from "./definition.js";
export { server, isServerField } from "./server.js";
export type { Server } from "./server.js";
export type {
	ClientStateData,
	ClientWorkflow,
	ClientWorkflowOf,
} from "./types.js";
```

Note: `stripServerData`, `deriveClientSchema`, `ClientInfer`, and `SERVER_BRAND` are internal — not exported.

- [ ] **Step 2: Build core**

Run: `cd packages/core && pnpm tsup`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run all core tests**

Run: `pnpm --filter @rytejs/core vitest run`
Expected: All tests PASS (149+ existing + ~25 new)

- [ ] **Step 4: Typecheck core**

Run: `pnpm --filter @rytejs/core tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Build and test testing package**

Run: `cd packages/core && pnpm tsup && pnpm --filter @rytejs/testing vitest run`
Expected: Build succeeds, 29 tests PASS

- [ ] **Step 6: Run full workspace check**

Run: `pnpm run check`
Expected: All typecheck, test, and lint steps pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export server field visibility API"
git push
```
