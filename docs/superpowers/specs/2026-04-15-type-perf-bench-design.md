# Type-Resolution Performance Benchmark Suite

## Problem

Type resolution inside `WorkflowRouter` is slow. Prior work (see
`2026-03-16-precomputed-config-types-design.md`) eliminated Zod v4's deferred
conditionals from the resolution chain, but anecdotal IDE latency and tsc check
times suggest there is still significant cost in `Prettify`, mapped-indexed
unions (`Workflow`, `Command`, `ClientWorkflow`), and variadic-tuple overloads
on `StateBuilder.on` and the wildcard `WorkflowRouter.on`.

We need a way to **measure** type-resolution cost reliably so we can
**iteratively** optimize it without flying blind.

This spec defines a benchmark harness — fixtures, runner, baseline, and
regression detection — that lets us answer:

- "Did this PR make types slower?" (numeric delta vs baseline)
- "Where is the cost going?" (flamegraph via opt-in trace)
- "Does the cost scale linearly or quadratically with workflow size?" (synthetic tiers)

## Solution

A new private workspace package, `@rytejs/type-bench`, containing fixture
workflows, a `tsc` driver, and a baseline-comparator. Three commands:
`pnpm bench`, `pnpm bench:trace <fixture>`, `pnpm bench:baseline`.

No CI integration in v1 — the harness runs locally. Once we have confidence in
run-to-run variance and the baseline is stable, the next iteration adds
label-gated CI (out of scope for this spec).

## Package Layout

```
packages/type-bench/
	package.json                    # @rytejs/type-bench, private: true
	tsconfig.json                   # base for harness src
	README.md                       # how to run, update baseline, hardware notes
	baseline.json                   # checked-in baseline (median of 5 runs)
	baseline.meta.json              # hardware fingerprint of baseline machine
	src/
		generate.ts                 # synthetic fixture generator
		run.ts                      # runs tsc per fixture, emits results.json
		compare.ts                  # results vs baseline + threshold
		trace.ts                    # opt-in tsc --generateTrace runner
		parse-diagnostics.ts        # extendedDiagnostics stderr parser
		types.ts                    # DiagnosticsResult, FixtureResult, etc.
	fixtures/
		synthetic/
			small/                  #   5 states ×   5 commands ×  5 events ×  3 errors
			medium/                 #  20 states ×  20 commands × 10 events ×  5 errors
			large/                  #  50 states ×  50 commands × 20 events × 10 errors
			xl/                     # 100 states × 100 commands × 50 events × 20 errors
		realistic/
			order/                  # e-commerce: Draft → Submitted → Paid → Shipped → Delivered + refunds
			publishing/             # Draft → InReview → Approved → Published → Archived
			billing/                # Trial → Active → PastDue → Canceled → Reactivated
	__tests__/
		parse-diagnostics.test.ts
		compare.test.ts
		generate.test.ts
	results/                        # gitignored: per-run output
	trace-out/                      # gitignored: trace.json output
```

Each fixture directory contains:
- `tsconfig.json` — extends a shared base in `fixtures/tsconfig.base.json`
- `definition.ts` — a `defineWorkflow({...})` call
- `router.ts` — a `new WorkflowRouter(definition)` registering every command on
  every state, exercising `ctx.update`, `ctx.transition`, `ctx.emit`, `ctx.error`

Synthetic fixtures are produced by `src/generate.ts` and **committed to git** —
the same bytes are measured every run.

## Components

### Fixture generator (`src/generate.ts`)

Takes a tier configuration `{ tier, states, commands, events, errors }` and
emits `definition.ts` + `router.ts` + `tsconfig.json`. Schema mix per state:
strings, numbers, booleans, an optional field, a nested object, and one
discriminated union. Flat schemas are explicitly **not** sufficient — they
don't trigger the conditional types we're measuring.

Run via `pnpm --filter @rytejs/type-bench generate`. Idempotent — produces
identical output for identical input.

### Realistic fixtures

Hand-written. Three domains (order, publishing, billing). In addition to the
patterns synthetic fixtures cover, each realistic fixture includes:

- State-scoped `use()` middleware with typed `deps`
- The `ctx.match()` exhaustive matcher
- At least one wildcard `on("*", ...)` handler

These mirror patterns we expect to be over-represented in real apps.

### Runner (`src/run.ts`)

For each fixture under `fixtures/**`:

1. Run `tsc --noEmit --extendedDiagnostics -p <fixture>/tsconfig.json` **3 times**
   in clean child processes.
2. Parse stderr via `parse-diagnostics.ts` into `{ checkTime, instantiations,
   types, memory, totalTime }`.
3. Take the median of each metric across the 3 runs.
4. Write `results/<timestamp>.json`: `{ [fixture]: FixtureResult }`.
5. Print a colored table to stdout: fixture × metric, with delta vs `baseline.json`.
6. If `--ci` flag set, exit non-zero when any metric exceeds threshold.

Default thresholds:
- `checkTime`: +10%
- `instantiations`: +15%
- `types`: +10%
- `memory`: +20%

### Trace runner (`src/trace.ts`)

`pnpm bench:trace <fixture>` runs:

```
tsc --noEmit --generateTrace ./trace-out -p fixtures/<fixture>/tsconfig.json
```

Then prints next-step instructions:

> Open `chrome://tracing` and load `trace-out/trace.json`
> Or run `npx @typescript/analyze-trace trace-out` for a text summary

Not invoked by `pnpm bench` — opt-in for active optimization sessions.

### Baseline runner (`pnpm bench:baseline`, alias for `src/run.ts --baseline`)

Runs the workflow **5 times**, takes per-metric median, writes `baseline.json`.
Prints a diff vs the prior baseline so the bump is reviewable. Records hardware
fingerprint (CPU model, node version, TS version) in `baseline.meta.json`.

### Comparator (`src/compare.ts`)

Pure function: `compare(results, baseline, thresholds) → ComparisonReport`.
Used by `run.ts` for the inline table and the `--ci` exit code. Tested in
isolation — `__tests__/compare.test.ts` covers regression detection,
improvement reporting, and threshold edge cases.

### Diagnostics parser (`src/parse-diagnostics.ts`)

Pure function: `parseDiagnostics(stderr: string) → DiagnosticsResult`. Strict
shape — unknown lines are dropped explicitly (not coerced to `unknown`). If
required fields are missing (TS bumped and changed format), throws with a
clear `extendedDiagnostics format unrecognized for TS x.y.z` message. Tested
in isolation against checked-in stderr fixtures.

## Data Flow

```
fixture generator → fixtures/synthetic/*/
                    fixtures/realistic/*/
                                |
                                v
                    tsc per fixture (3x)
                                |
                                v
                  parse-diagnostics.ts
                                |
                                v
                       median across runs
                                |
                                v
                       results/<ts>.json
                                |
                                v
                     compare.ts (vs baseline.json)
                                |
                                v
                       table + exit code
```

## Constraints from CLAUDE.md

The "no `any` / no `unknown` in consumer-facing types" rule applies fully:

- All fixture handler bodies are fully typed end-to-end. No `(ctx) => ctx.data
  as any`, no `// @ts-expect-error`. Untyped handlers short-circuit inference
  and would invalidate the measurement anyway.
- Generator and runner code use concrete TypeScript types — `DiagnosticsResult`,
  `FixtureResult`, `BenchRun`. Never `Record<string, unknown>` or `any`.
- Fixture `definition.ts` files import `defineWorkflow` and `z` exactly as a
  real consumer would. No internal-API shortcuts.
- The package is included in workspace `check` — `pnpm --filter
  @rytejs/type-bench tsc --noEmit` must pass, and Biome rules apply.

## Failure Modes (Explicit)

| Condition | Behavior |
|-----------|----------|
| Fixture has compile errors | Runner aborts that fixture loud (red); other fixtures continue. Type errors invalidate measurement. |
| Diagnostics parse fails | Hard error: `extendedDiagnostics format unrecognized for TS x.y.z; update parser.` Fail closed. |
| TS version differs from baseline | Comparator prints a `MISMATCH` warning header but still runs. Forces baseline refresh in same PR as TS upgrade. |
| Hardware fingerprint differs from baseline | Runner prints `MISMATCH` warning at top of table; cross-machine comparisons are not meaningful. |
| Threshold exceeded, no `--ci` flag | Printed in red, but exits 0. |
| Threshold exceeded, `--ci` flag | Exits non-zero with a summary of which metric × fixture failed. |

## Variance Handling

- Inner `pnpm bench`: 3 runs per fixture, median.
- `pnpm bench:baseline`: 5 runs per fixture, median.
- Same-machine comparisons only — README documents that cross-machine numbers
  are meaningless.
- For the small synthetic tier, `tsc` startup (100–200ms) may dominate
  check-time (~10ms). The runner highlights `instantiations` and `types` as
  primary metrics for small/medium tiers; `checkTime` is primary for large/xl.

## Testing

- `__tests__/parse-diagnostics.test.ts` — parser correctness against
  checked-in stderr samples (one per supported TS version).
- `__tests__/compare.test.ts` — comparator flags regressions, reports
  improvements, respects thresholds, handles missing baseline entries.
- `__tests__/generate.test.ts` — generator output is deterministic and
  produces compilable fixtures (spot-check the small tier).
- Fixtures themselves don't need vitest tests — `tsc --noEmit` succeeding is
  the test.

## Out of Scope (Explicit)

These are deferred — they are mechanical extensions once v1 is stable:

- Reactor / `@rytejs/react` / `@rytejs/testing` fixtures.
- CI integration (label-gated PR runs + nightly on `master`).
- Flamegraph diffing across runs (`analyze-trace` stays manual).
- Memory leak detection across runs.
- A web UI for browsing historical results.

## Open Questions

None at spec time. Open questions discovered during implementation will be
raised before the implementation plan is executed.

## Success Criteria

1. `pnpm --filter @rytejs/type-bench bench` produces a table of results for
   all 7 fixtures in under 2 minutes on the machine recorded in
   `baseline.meta.json`.
2. `pnpm --filter @rytejs/type-bench bench --ci` exits non-zero when any
   metric regresses past threshold.
3. `pnpm --filter @rytejs/type-bench bench:trace small` produces a
   `trace-out/trace.json` openable in `chrome://tracing`.
4. The harness itself passes `tsc --noEmit` and `biome check` with no `any`
   or `unknown` in consumer-facing positions.
5. Running the harness twice in succession on the same checkout produces
   results within the configured threshold (variance ≤ noise floor).
