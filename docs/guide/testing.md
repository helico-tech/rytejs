# Testing

`@rytejs/testing` provides utilities that reduce workflow testing boilerplate. Framework-agnostic — works with Vitest, Jest, or any test runner.

## Installation

```bash
npm install -D @rytejs/testing
```

`@rytejs/core` is a peer dependency.

## Creating Test Workflows

`createTestWorkflow` places a workflow directly into any state without dispatching through handlers:

<<< @/snippets/guide/testing.ts#create-test-workflow

Data is validated against the state's Zod schema — invalid data throws.

You can provide a custom ID:

<<< @/snippets/guide/testing.ts#create-with-id

## Asserting Results

### expectOk

Asserts a dispatch result is ok. Optionally checks the resulting state:

<<< @/snippets/guide/testing.ts#expect-ok

Throws with a descriptive message if the result is an error.

### expectError

Asserts a dispatch result is an error with a specific category. Optionally checks the error code:

<<< @/snippets/guide/testing.ts#expect-error

## Transition Path Testing

`testPath` verifies a sequence of commands produces the expected state journey:

<<< @/snippets/guide/testing.ts#test-path

The first step must have `start` and `data` to create the initial workflow. Subsequent steps chain from the previous result. Throws if any dispatch fails or produces an unexpected state.

## Stubbing Dependencies

`createTestDeps` creates a dependencies object from a partial — provide only what your test needs:

<<< @/snippets/guide/testing.ts#test-deps

Missing properties are `undefined` at runtime. The return type is the full `T`, so TypeScript is satisfied.
