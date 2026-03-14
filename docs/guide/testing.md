# Testing

`@rytejs/testing` provides utilities that reduce workflow testing boilerplate. Framework-agnostic — works with Vitest, Jest, or any test runner.

## Installation

```bash
npm install -D @rytejs/testing
```

`@rytejs/core` is a peer dependency.

## Creating Test Workflows

`createTestWorkflow` places a workflow directly into any state without dispatching through handlers:

```ts
import { createTestWorkflow } from "@rytejs/testing";

const wf = createTestWorkflow(definition, "Placed", {
	orderId: "123",
	items: [{ sku: "ABC", qty: 1 }],
});

// wf.state === "Placed"
// wf.data === { orderId: "123", items: [...] }
```

Data is validated against the state's Zod schema — invalid data throws.

You can provide a custom ID:

```ts
const wf = createTestWorkflow(definition, "Draft", { items: [] }, { id: "my-id" });
```

## Asserting Results

### expectOk

Asserts a dispatch result is ok. Optionally checks the resulting state:

```ts
import { expectOk } from "@rytejs/testing";

const result = await router.dispatch(wf, { type: "PlaceOrder", payload: {} });

expectOk(result);                // asserts ok, narrows type
expectOk(result, "Placed");     // also checks state
```

Throws with a descriptive message if the result is an error.

### expectError

Asserts a dispatch result is an error with a specific category. Optionally checks the error code:

```ts
import { expectError } from "@rytejs/testing";

const result = await router.dispatch(wf, { type: "PlaceOrder", payload: {} });

expectError(result, "domain");                  // asserts domain error
expectError(result, "domain", "OutOfStock");    // also checks code
expectError(result, "validation");              // asserts validation error
```

## Transition Path Testing

`testPath` verifies a sequence of commands produces the expected state journey:

```ts
import { testPath } from "@rytejs/testing";

await testPath(router, definition, [
	{ start: "Todo", data: { title: "Fix bug" }, command: "Start", payload: { assignee: "alice" }, expect: "InProgress" },
	{ command: "Complete", payload: {}, expect: "Done" },
]);
```

The first step must have `start` and `data` to create the initial workflow. Subsequent steps chain from the previous result. Throws if any dispatch fails or produces an unexpected state.

## Stubbing Dependencies

`createTestDeps` creates a dependencies object from a partial — provide only what your test needs:

```ts
import { createTestDeps } from "@rytejs/testing";

const deps = createTestDeps<MyDeps>({
	paymentService: { charge: vi.fn().mockResolvedValue(true) },
});

const router = new WorkflowRouter(definition, deps);
```

Missing properties are `undefined` at runtime. The return type is the full `T`, so TypeScript is satisfied.
