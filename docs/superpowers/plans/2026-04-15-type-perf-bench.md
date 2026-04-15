# Type-Performance Benchmark Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@rytejs/type-bench`, a private workspace package that measures TypeScript type-resolution cost across a tiered set of synthetic and realistic workflow fixtures, with baseline + relative-regression detection.

**Architecture:** A new workspace package containing fixture workflows (one `tsconfig.json` per fixture), a `tsc --extendedDiagnostics` driver that runs each fixture multiple times and takes the median, a comparator that diffs results against a checked-in `baseline.json`, and an opt-in `--generateTrace` runner. Pure helpers (parser, comparator, median, formatter) are unit-tested with vitest; the runner is one integration test against the small fixture.

**Tech Stack:** TypeScript 5.9, Node ≥20, pnpm workspaces, vitest 4, tsx (for running the CLI), Zod 4, `@rytejs/core`. No new runtime dependencies — only devDependencies.

**Spec:** `docs/superpowers/specs/2026-04-15-type-perf-bench-design.md`

---

## File Structure

```
packages/type-bench/
	package.json                          # workspace package, private
	tsconfig.json                         # strict TS for harness src
	vitest.config.ts                      # vitest runner config
	README.md                             # how to run, baseline policy, hardware notes
	baseline.json                         # checked-in baseline
	baseline.meta.json                    # hardware fingerprint
	.gitignore                            # results/, trace-out/, node_modules/
	fixtures/
		tsconfig.base.json                # shared base for fixtures
		synthetic/
			small/{tsconfig.json, definition.ts, router.ts}
			medium/{tsconfig.json, definition.ts, router.ts}
			large/{tsconfig.json, definition.ts, router.ts}
			xl/{tsconfig.json, definition.ts, router.ts}
		realistic/
			order/{tsconfig.json, definition.ts, router.ts}
			publishing/{tsconfig.json, definition.ts, router.ts}
			billing/{tsconfig.json, definition.ts, router.ts}
	src/
		types.ts                          # DiagnosticsResult, FixtureResult, ComparisonReport, Tier
		parse-diagnostics.ts              # parseDiagnostics(stderr) → DiagnosticsResult
		median.ts                         # median(numbers[]) → number
		compare.ts                        # compare(results, baseline, thresholds) → ComparisonReport
		format-table.ts                   # renderTable(report) → string
		generate.ts                       # generateSyntheticFixture(tier) → file contents
		run-fixture.ts                    # runFixture(path, runs) → DiagnosticsResult
		run.ts                            # main runner orchestrator
		trace.ts                          # opt-in trace runner
		cli.ts                            # argv parsing + dispatch
	__tests__/
		parse-diagnostics.test.ts
		compare.test.ts
		median.test.ts
		generate.test.ts
		run-fixture.integration.test.ts   # smoke test against small fixture
		__fixtures__/
			extended-diagnostics.sample.txt
```

---

### Task 1: Set up workspace package skeleton

**Files:**
- Create: `packages/type-bench/package.json`
- Create: `packages/type-bench/tsconfig.json`
- Create: `packages/type-bench/vitest.config.ts`
- Create: `packages/type-bench/.gitignore`
- Create: `packages/type-bench/src/.gitkeep` (placeholder so tsc has something to compile)

- [ ] **Step 1: Create `packages/type-bench/package.json`**

```json
{
	"name": "@rytejs/type-bench",
	"version": "0.0.0",
	"private": true,
	"description": "Type-resolution performance benchmarks for @rytejs/core",
	"type": "module",
	"scripts": {
		"typecheck": "tsc --noEmit",
		"test": "vitest run",
		"test:watch": "vitest",
		"bench": "tsx src/cli.ts bench",
		"bench:baseline": "tsx src/cli.ts bench --baseline",
		"bench:trace": "tsx src/cli.ts trace",
		"generate": "tsx src/cli.ts generate"
	},
	"devDependencies": {
		"@rytejs/core": "workspace:*",
		"tsx": "^4.19.0",
		"typescript": "^5.9.0",
		"vitest": "^4.0.0",
		"zod": "^4.3.0"
	},
	"engines": {
		"node": ">=20"
	}
}
```

- [ ] **Step 2: Create `packages/type-bench/tsconfig.json`**

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": ".",
		"noEmit": true
	},
	"include": ["src", "__tests__"],
	"exclude": ["node_modules", "fixtures"]
}
```

The `exclude: ["fixtures"]` is critical — fixtures have their own tsconfigs and must not be type-checked as part of the harness's own typecheck, since they're the *input* we measure.

- [ ] **Step 3: Create `packages/type-bench/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__tests__/**/*.test.ts"],
		exclude: ["__tests__/**/*.integration.test.ts", "node_modules", "fixtures"],
	},
});
```

Integration tests are excluded from default `test` (they shell out to `tsc` and are slow). They run via `vitest run __tests__/run-fixture.integration.test.ts` explicitly.

- [ ] **Step 4: Create `packages/type-bench/.gitignore`**

```
node_modules/
results/
trace-out/
```

- [ ] **Step 5: Create placeholder `packages/type-bench/src/.gitkeep`**

Empty file. Lets `tsc --noEmit` run without "no input files" errors before any source exists.

- [ ] **Step 6: Install dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: `@rytejs/type-bench` linked, `tsx`, `vitest`, `typescript`, `zod` installed.

- [ ] **Step 7: Verify typecheck and test commands run (empty results expected)**

```bash
pnpm --filter @rytejs/type-bench typecheck
pnpm --filter @rytejs/type-bench test
```

Expected: typecheck passes (no source), test reports 0 tests with no failure.

- [ ] **Step 8: Commit**

```bash
git add packages/type-bench pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: scaffold @rytejs/type-bench workspace package

Empty package skeleton for the type-resolution performance benchmark
suite. Adds package.json, tsconfig.json, vitest.config.ts, .gitignore.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 2: Define core types

**Files:**
- Create: `packages/type-bench/src/types.ts`

- [ ] **Step 1: Create `packages/type-bench/src/types.ts`**

```typescript
export type Tier = "small" | "medium" | "large" | "xl";

export interface TierConfig {
	readonly tier: Tier;
	readonly states: number;
	readonly commands: number;
	readonly events: number;
	readonly errors: number;
}

export const TIER_CONFIGS: readonly TierConfig[] = [
	{ tier: "small", states: 5, commands: 5, events: 5, errors: 3 },
	{ tier: "medium", states: 20, commands: 20, events: 10, errors: 5 },
	{ tier: "large", states: 50, commands: 50, events: 20, errors: 10 },
	{ tier: "xl", states: 100, commands: 100, events: 50, errors: 20 },
];

export interface DiagnosticsResult {
	readonly checkTimeMs: number;
	readonly totalTimeMs: number;
	readonly instantiations: number;
	readonly types: number;
	readonly memoryKb: number;
}

export interface FixtureRunResult {
	readonly fixture: string;
	readonly runs: readonly DiagnosticsResult[];
	readonly median: DiagnosticsResult;
}

export interface BenchRun {
	readonly timestamp: string;
	readonly tsVersion: string;
	readonly nodeVersion: string;
	readonly cpuModel: string;
	readonly fixtures: Readonly<Record<string, DiagnosticsResult>>;
}

export interface Thresholds {
	readonly checkTimeMs: number;
	readonly instantiations: number;
	readonly types: number;
	readonly memoryKb: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
	checkTimeMs: 0.10,
	instantiations: 0.15,
	types: 0.10,
	memoryKb: 0.20,
};

export type RegressionStatus = "ok" | "regressed" | "improved" | "missing-baseline";

export interface FixtureComparison {
	readonly fixture: string;
	readonly metric: keyof DiagnosticsResult;
	readonly current: number;
	readonly baseline: number | null;
	readonly deltaRatio: number | null;
	readonly threshold: number;
	readonly status: RegressionStatus;
}

export interface ComparisonReport {
	readonly comparisons: readonly FixtureComparison[];
	readonly hasRegression: boolean;
	readonly hardwareMismatch: boolean;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @rytejs/type-bench typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/type-bench/src/types.ts
git rm packages/type-bench/src/.gitkeep
git commit -m "$(cat <<'EOF'
feat(type-bench): add core types

Defines DiagnosticsResult, FixtureRunResult, BenchRun, Thresholds,
ComparisonReport — consumed by parser, runner, comparator.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 3: Implement diagnostics parser (TDD)

**Files:**
- Create: `packages/type-bench/__tests__/__fixtures__/extended-diagnostics.sample.txt`
- Create: `packages/type-bench/__tests__/parse-diagnostics.test.ts`
- Create: `packages/type-bench/src/parse-diagnostics.ts`

- [ ] **Step 1: Create stderr sample fixture**

`packages/type-bench/__tests__/__fixtures__/extended-diagnostics.sample.txt`:

```
Files:                          123
Lines of Library:              42153
Lines of Definitions:           5234
Lines of TypeScript:             567
Lines of JavaScript:               0
Lines of JSON:                     0
Lines of Other:                    0
Identifiers:                   12345
Symbols:                       45678
Types:                          8901
Instantiations:                23456
Memory used:                  123456K
Assignability cache size:       1234
Identity cache size:               0
Subtype cache size:                0
Strict subtype cache size:         0
I/O Read time:                 0.01s
Parse time:                    0.20s
ResolveModule time:            0.05s
ResolveLibrary time:           0.03s
ResolveTypeReference time:     0.01s
Program time:                  0.30s
Bind time:                     0.10s
Check time:                    1.50s
printTime time:                0.00s
Emit time:                     0.00s
Total time:                    1.90s
```

- [ ] **Step 2: Write failing tests**

`packages/type-bench/__tests__/parse-diagnostics.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parseDiagnostics } from "../src/parse-diagnostics.js";

const sampleStderr = readFileSync(
	fileURLToPath(new URL("./__fixtures__/extended-diagnostics.sample.txt", import.meta.url)),
	"utf8",
);

describe("parseDiagnostics", () => {
	test("extracts checkTimeMs from 'Check time: 1.50s'", () => {
		const result = parseDiagnostics(sampleStderr);
		expect(result.checkTimeMs).toBe(1500);
	});

	test("extracts totalTimeMs from 'Total time: 1.90s'", () => {
		const result = parseDiagnostics(sampleStderr);
		expect(result.totalTimeMs).toBe(1900);
	});

	test("extracts instantiations as integer", () => {
		const result = parseDiagnostics(sampleStderr);
		expect(result.instantiations).toBe(23456);
	});

	test("extracts types as integer", () => {
		const result = parseDiagnostics(sampleStderr);
		expect(result.types).toBe(8901);
	});

	test("extracts memoryKb from '123456K'", () => {
		const result = parseDiagnostics(sampleStderr);
		expect(result.memoryKb).toBe(123456);
	});

	test("throws when a required field is missing", () => {
		const truncated = "Files: 1\nTotal time: 0.10s\n";
		expect(() => parseDiagnostics(truncated)).toThrow(/Check time/);
	});

	test("throws clear error message naming the missing field", () => {
		expect(() => parseDiagnostics("")).toThrow(/extendedDiagnostics format unrecognized/);
	});
});
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: FAIL with "Cannot find module '../src/parse-diagnostics.js'".

- [ ] **Step 4: Implement `parseDiagnostics`**

`packages/type-bench/src/parse-diagnostics.ts`:

```typescript
import type { DiagnosticsResult } from "./types.js";

const TIME_PATTERN = /^([A-Za-z ]+? time):\s+([\d.]+)s$/;
const COUNT_PATTERN = /^([A-Za-z ]+):\s+(\d+)$/;
const MEMORY_PATTERN = /^Memory used:\s+(\d+)K$/;

interface RawFields {
	checkTimeMs?: number;
	totalTimeMs?: number;
	instantiations?: number;
	types?: number;
	memoryKb?: number;
}

export function parseDiagnostics(stderr: string): DiagnosticsResult {
	const fields: RawFields = {};

	for (const rawLine of stderr.split("\n")) {
		const line = rawLine.trim();
		if (line === "") continue;

		const memoryMatch = MEMORY_PATTERN.exec(line);
		if (memoryMatch !== null) {
			fields.memoryKb = Number(memoryMatch[1]);
			continue;
		}

		const timeMatch = TIME_PATTERN.exec(line);
		if (timeMatch !== null) {
			const label = timeMatch[1];
			const seconds = Number(timeMatch[2]);
			const ms = Math.round(seconds * 1000);
			if (label === "Check time") fields.checkTimeMs = ms;
			else if (label === "Total time") fields.totalTimeMs = ms;
			continue;
		}

		const countMatch = COUNT_PATTERN.exec(line);
		if (countMatch !== null) {
			const label = countMatch[1];
			const value = Number(countMatch[2]);
			if (label === "Instantiations") fields.instantiations = value;
			else if (label === "Types") fields.types = value;
		}
	}

	const missing: string[] = [];
	if (fields.checkTimeMs === undefined) missing.push("Check time");
	if (fields.totalTimeMs === undefined) missing.push("Total time");
	if (fields.instantiations === undefined) missing.push("Instantiations");
	if (fields.types === undefined) missing.push("Types");
	if (fields.memoryKb === undefined) missing.push("Memory used");

	if (missing.length > 0) {
		throw new Error(
			`extendedDiagnostics format unrecognized — missing required field(s): ${missing.join(", ")}. ` +
				`This usually means the TypeScript version changed its output format. Update parse-diagnostics.ts.`,
		);
	}

	return {
		checkTimeMs: fields.checkTimeMs as number,
		totalTimeMs: fields.totalTimeMs as number,
		instantiations: fields.instantiations as number,
		types: fields.types as number,
		memoryKb: fields.memoryKb as number,
	};
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/type-bench/__tests__ packages/type-bench/src/parse-diagnostics.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): parse tsc --extendedDiagnostics stderr

Strict parser. Throws a clear error if TS bumps and changes output
format, naming the missing field. Tests against a checked-in stderr
sample.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 4: Implement median helper (TDD)

**Files:**
- Create: `packages/type-bench/__tests__/median.test.ts`
- Create: `packages/type-bench/src/median.ts`

- [ ] **Step 1: Write failing tests**

`packages/type-bench/__tests__/median.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { median, medianDiagnostics } from "../src/median.js";

describe("median", () => {
	test("single value", () => {
		expect(median([42])).toBe(42);
	});

	test("odd length picks middle", () => {
		expect(median([1, 5, 3])).toBe(3);
	});

	test("even length averages middle two", () => {
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});

	test("does not mutate input", () => {
		const input = [3, 1, 2];
		median(input);
		expect(input).toEqual([3, 1, 2]);
	});

	test("throws on empty array", () => {
		expect(() => median([])).toThrow(/empty/);
	});
});

describe("medianDiagnostics", () => {
	test("computes median per metric", () => {
		const result = medianDiagnostics([
			{ checkTimeMs: 100, totalTimeMs: 200, instantiations: 1000, types: 500, memoryKb: 50000 },
			{ checkTimeMs: 110, totalTimeMs: 220, instantiations: 1100, types: 520, memoryKb: 51000 },
			{ checkTimeMs: 105, totalTimeMs: 210, instantiations: 1050, types: 510, memoryKb: 50500 },
		]);
		expect(result.checkTimeMs).toBe(105);
		expect(result.totalTimeMs).toBe(210);
		expect(result.instantiations).toBe(1050);
		expect(result.types).toBe(510);
		expect(result.memoryKb).toBe(50500);
	});
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: FAIL with "Cannot find module '../src/median.js'".

- [ ] **Step 3: Implement**

`packages/type-bench/src/median.ts`:

```typescript
import type { DiagnosticsResult } from "./types.js";

export function median(values: readonly number[]): number {
	if (values.length === 0) {
		throw new Error("median: cannot compute median of empty array");
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid] as number;
	}
	const lo = sorted[mid - 1] as number;
	const hi = sorted[mid] as number;
	return (lo + hi) / 2;
}

export function medianDiagnostics(runs: readonly DiagnosticsResult[]): DiagnosticsResult {
	return {
		checkTimeMs: median(runs.map((r) => r.checkTimeMs)),
		totalTimeMs: median(runs.map((r) => r.totalTimeMs)),
		instantiations: median(runs.map((r) => r.instantiations)),
		types: median(runs.map((r) => r.types)),
		memoryKb: median(runs.map((r) => r.memoryKb)),
	};
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: PASS, 6 new tests (13 total with parser tests).

- [ ] **Step 5: Commit**

```bash
git add packages/type-bench/__tests__/median.test.ts packages/type-bench/src/median.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): median helper for run aggregation

Pure median + per-metric medianDiagnostics. Used by runner to collapse
N runs into one stable number per metric.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 5: Implement comparator (TDD)

**Files:**
- Create: `packages/type-bench/__tests__/compare.test.ts`
- Create: `packages/type-bench/src/compare.ts`

- [ ] **Step 1: Write failing tests**

`packages/type-bench/__tests__/compare.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { compare } from "../src/compare.js";
import type { BenchRun, Thresholds } from "../src/types.js";

const baselineRun: BenchRun = {
	timestamp: "2026-04-15T00:00:00Z",
	tsVersion: "5.9.0",
	nodeVersion: "v20.0.0",
	cpuModel: "TestCPU",
	fixtures: {
		small: {
			checkTimeMs: 100,
			totalTimeMs: 200,
			instantiations: 1000,
			types: 500,
			memoryKb: 50000,
		},
	},
};

const thresholds: Thresholds = {
	checkTimeMs: 0.10,
	instantiations: 0.15,
	types: 0.10,
	memoryKb: 0.20,
};

describe("compare", () => {
	test("flags regression when checkTimeMs grows past threshold", () => {
		const current: BenchRun = {
			...baselineRun,
			fixtures: {
				small: { ...baselineRun.fixtures.small!, checkTimeMs: 120 },
			},
		};
		const report = compare(current, baselineRun, thresholds);
		expect(report.hasRegression).toBe(true);
		const checkTimeComparison = report.comparisons.find(
			(c) => c.fixture === "small" && c.metric === "checkTimeMs",
		);
		expect(checkTimeComparison?.status).toBe("regressed");
		expect(checkTimeComparison?.deltaRatio).toBeCloseTo(0.20, 2);
	});

	test("does not flag regression when growth is below threshold", () => {
		const current: BenchRun = {
			...baselineRun,
			fixtures: {
				small: { ...baselineRun.fixtures.small!, checkTimeMs: 105 },
			},
		};
		const report = compare(current, baselineRun, thresholds);
		expect(report.hasRegression).toBe(false);
		const c = report.comparisons.find((x) => x.metric === "checkTimeMs");
		expect(c?.status).toBe("ok");
	});

	test("marks improvement when current is meaningfully lower", () => {
		const current: BenchRun = {
			...baselineRun,
			fixtures: {
				small: { ...baselineRun.fixtures.small!, checkTimeMs: 80 },
			},
		};
		const report = compare(current, baselineRun, thresholds);
		const c = report.comparisons.find((x) => x.metric === "checkTimeMs");
		expect(c?.status).toBe("improved");
	});

	test("marks missing-baseline when fixture is new", () => {
		const current: BenchRun = {
			...baselineRun,
			fixtures: {
				newFixture: {
					checkTimeMs: 50,
					totalTimeMs: 100,
					instantiations: 200,
					types: 100,
					memoryKb: 10000,
				},
			},
		};
		const report = compare(current, baselineRun, thresholds);
		const c = report.comparisons.find((x) => x.fixture === "newFixture");
		expect(c?.status).toBe("missing-baseline");
		expect(c?.baseline).toBeNull();
		expect(report.hasRegression).toBe(false);
	});

	test("flags hardwareMismatch when cpuModel or tsVersion differs", () => {
		const current: BenchRun = { ...baselineRun, cpuModel: "OtherCPU" };
		const report = compare(current, baselineRun, thresholds);
		expect(report.hardwareMismatch).toBe(true);
	});

	test("respects per-metric threshold (instantiations 15% allows 12% growth)", () => {
		const current: BenchRun = {
			...baselineRun,
			fixtures: {
				small: { ...baselineRun.fixtures.small!, instantiations: 1120 },
			},
		};
		const report = compare(current, baselineRun, thresholds);
		const c = report.comparisons.find((x) => x.metric === "instantiations");
		expect(c?.status).toBe("ok");
	});
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: FAIL with "Cannot find module '../src/compare.js'".

- [ ] **Step 3: Implement**

`packages/type-bench/src/compare.ts`:

```typescript
import type {
	BenchRun,
	ComparisonReport,
	DiagnosticsResult,
	FixtureComparison,
	RegressionStatus,
	Thresholds,
} from "./types.js";

const METRICS: readonly (keyof DiagnosticsResult)[] = [
	"checkTimeMs",
	"totalTimeMs",
	"instantiations",
	"types",
	"memoryKb",
];

const IMPROVEMENT_THRESHOLD = 0.05;

function thresholdFor(metric: keyof DiagnosticsResult, thresholds: Thresholds): number {
	switch (metric) {
		case "checkTimeMs":
		case "totalTimeMs":
			return thresholds.checkTimeMs;
		case "instantiations":
			return thresholds.instantiations;
		case "types":
			return thresholds.types;
		case "memoryKb":
			return thresholds.memoryKb;
	}
}

function classify(
	deltaRatio: number,
	threshold: number,
): RegressionStatus {
	if (deltaRatio > threshold) return "regressed";
	if (deltaRatio < -IMPROVEMENT_THRESHOLD) return "improved";
	return "ok";
}

export function compare(
	current: BenchRun,
	baseline: BenchRun,
	thresholds: Thresholds,
): ComparisonReport {
	const comparisons: FixtureComparison[] = [];
	let hasRegression = false;

	for (const [fixture, currentResult] of Object.entries(current.fixtures)) {
		const baselineResult = baseline.fixtures[fixture];
		for (const metric of METRICS) {
			const currentValue = currentResult[metric];
			const threshold = thresholdFor(metric, thresholds);
			if (baselineResult === undefined) {
				comparisons.push({
					fixture,
					metric,
					current: currentValue,
					baseline: null,
					deltaRatio: null,
					threshold,
					status: "missing-baseline",
				});
				continue;
			}
			const baselineValue = baselineResult[metric];
			const deltaRatio = baselineValue === 0
				? 0
				: (currentValue - baselineValue) / baselineValue;
			const status = classify(deltaRatio, threshold);
			if (status === "regressed") hasRegression = true;
			comparisons.push({
				fixture,
				metric,
				current: currentValue,
				baseline: baselineValue,
				deltaRatio,
				threshold,
				status,
			});
		}
	}

	const hardwareMismatch =
		current.cpuModel !== baseline.cpuModel ||
		current.tsVersion !== baseline.tsVersion;

	return { comparisons, hasRegression, hardwareMismatch };
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: PASS, 6 new tests (19 total).

- [ ] **Step 5: Commit**

```bash
git add packages/type-bench/__tests__/compare.test.ts packages/type-bench/src/compare.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): comparator with relative regression detection

Per-metric thresholds. Marks regressed/improved/ok/missing-baseline.
Detects hardware mismatch via cpuModel + tsVersion fingerprint.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 6: Implement table formatter (no TDD — pure rendering)

**Files:**
- Create: `packages/type-bench/src/format-table.ts`

- [ ] **Step 1: Implement**

`packages/type-bench/src/format-table.ts`:

```typescript
import type { ComparisonReport, FixtureComparison } from "./types.js";

const COLOR = {
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

function colorize(status: FixtureComparison["status"], text: string): string {
	switch (status) {
		case "regressed":
			return `${COLOR.red}${text}${COLOR.reset}`;
		case "improved":
			return `${COLOR.green}${text}${COLOR.reset}`;
		case "missing-baseline":
			return `${COLOR.yellow}${text}${COLOR.reset}`;
		case "ok":
			return `${COLOR.dim}${text}${COLOR.reset}`;
	}
}

function formatDelta(c: FixtureComparison): string {
	if (c.deltaRatio === null) return "(new)";
	const pct = (c.deltaRatio * 100).toFixed(1);
	const sign = c.deltaRatio >= 0 ? "+" : "";
	return `${sign}${pct}%`;
}

function formatValue(metric: FixtureComparison["metric"], value: number): string {
	if (metric === "checkTimeMs" || metric === "totalTimeMs") return `${value}ms`;
	if (metric === "memoryKb") return `${(value / 1024).toFixed(1)}MB`;
	return value.toLocaleString();
}

export function renderTable(report: ComparisonReport): string {
	const lines: string[] = [];

	if (report.hardwareMismatch) {
		lines.push(
			`${COLOR.yellow}MISMATCH:${COLOR.reset} hardware/TS-version differs from baseline — numbers are not directly comparable.`,
		);
		lines.push("");
	}

	const header = ["fixture", "metric", "current", "baseline", "delta", "status"];
	const rows: string[][] = [header];

	for (const c of report.comparisons) {
		rows.push([
			c.fixture,
			c.metric,
			formatValue(c.metric, c.current),
			c.baseline === null ? "—" : formatValue(c.metric, c.baseline),
			formatDelta(c),
			colorize(c.status, c.status),
		]);
	}

	const widths = header.map((_, i) =>
		Math.max(...rows.map((row) => stripAnsi(row[i] ?? "").length)),
	);

	for (const row of rows) {
		lines.push(
			row
				.map((cell, i) => {
					const visibleLen = stripAnsi(cell).length;
					const pad = " ".repeat((widths[i] ?? 0) - visibleLen);
					return cell + pad;
				})
				.join("  "),
		);
	}

	if (report.hasRegression) {
		lines.push("");
		lines.push(`${COLOR.red}REGRESSION:${COLOR.reset} one or more metrics exceeded threshold.`);
	}

	return lines.join("\n");
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @rytejs/type-bench typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/type-bench/src/format-table.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): colored table renderer for comparison reports

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 7: Implement synthetic fixture generator (TDD)

The generator produces three files per tier: `definition.ts`, `router.ts`, `tsconfig.json`. All states use the same uniform schema with a per-state literal discriminator (`which`) so TS still tracks per-state types without needing N hand-crafted schemas. All commands use the same payload shape; same for events and errors.

**Files:**
- Create: `packages/type-bench/__tests__/generate.test.ts`
- Create: `packages/type-bench/src/generate.ts`

- [ ] **Step 1: Write failing tests**

`packages/type-bench/__tests__/generate.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import {
	generateDefinition,
	generateRouter,
	generateTsconfig,
} from "../src/generate.js";
import type { TierConfig } from "../src/types.js";

const smallTier: TierConfig = {
	tier: "small",
	states: 3,
	commands: 2,
	events: 2,
	errors: 1,
};

describe("generateDefinition", () => {
	test("emits import + defineWorkflow call", () => {
		const code = generateDefinition(smallTier);
		expect(code).toContain('import { defineWorkflow } from "@rytejs/core";');
		expect(code).toContain('import { z } from "zod";');
		expect(code).toMatch(/export const workflow = defineWorkflow\("synthetic_small"/);
	});

	test("emits one Zod schema per state with discriminator", () => {
		const code = generateDefinition(smallTier);
		expect(code).toContain('State0:');
		expect(code).toContain('State1:');
		expect(code).toContain('State2:');
		expect(code).toContain('z.literal("State0")');
		expect(code).toContain('z.literal("State2")');
	});

	test("emits one Zod schema per command", () => {
		const code = generateDefinition(smallTier);
		expect(code).toContain('Cmd0:');
		expect(code).toContain('Cmd1:');
	});

	test("is deterministic (same input → same output)", () => {
		expect(generateDefinition(smallTier)).toBe(generateDefinition(smallTier));
	});
});

describe("generateRouter", () => {
	test("registers every command on every state", () => {
		const code = generateRouter(smallTier);
		expect(code).toContain('router.state("State0"');
		expect(code).toContain('router.state("State1"');
		expect(code).toContain('router.state("State2"');
		expect((code.match(/state\.on\("Cmd0"/g) ?? []).length).toBe(3);
		expect((code.match(/state\.on\("Cmd1"/g) ?? []).length).toBe(3);
	});

	test("each handler calls update, transition, emit, error paths", () => {
		const code = generateRouter(smallTier);
		expect(code).toContain("ctx.update");
		expect(code).toContain("ctx.transition");
		expect(code).toContain("ctx.emit");
		expect(code).toContain("ctx.error");
	});
});

describe("generateTsconfig", () => {
	test("extends shared base", () => {
		const code = generateTsconfig();
		const parsed = JSON.parse(code) as { extends: string; include: string[] };
		expect(parsed.extends).toBe("../../tsconfig.base.json");
		expect(parsed.include).toEqual(["definition.ts", "router.ts"]);
	});
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: FAIL with "Cannot find module '../src/generate.js'".

- [ ] **Step 3: Implement**

`packages/type-bench/src/generate.ts`:

```typescript
import type { TierConfig } from "./types.js";

function stateNames(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `State${i}`);
}

function commandNames(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `Cmd${i}`);
}

function eventNames(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `Evt${i}`);
}

function errorNames(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `Err${i}`);
}

function stateSchema(name: string): string {
	return [
		"\t\tz.object({",
		"\t\t\tid: z.string(),",
		"\t\t\tcount: z.number(),",
		"\t\t\tactive: z.boolean(),",
		"\t\t\ttag: z.string().optional(),",
		"\t\t\tmeta: z.object({ created: z.coerce.date(), source: z.string() }),",
		"\t\t\tkind: z.discriminatedUnion(\"type\", [",
		"\t\t\t\tz.object({ type: z.literal(\"a\"), valueA: z.string() }),",
		"\t\t\t\tz.object({ type: z.literal(\"b\"), valueB: z.number() }),",
		"\t\t\t]),",
		`\t\t\twhich: z.literal("${name}"),`,
		"\t\t})",
	].join("\n");
}

function commandSchema(): string {
	return "z.object({ payload: z.string(), n: z.number() })";
}

function eventSchema(): string {
	return "z.object({ data: z.string(), ts: z.number() })";
}

function errorSchema(): string {
	return "z.object({ code: z.string(), detail: z.string() })";
}

export function generateDefinition(tier: TierConfig): string {
	const states = stateNames(tier.states);
	const commands = commandNames(tier.commands);
	const events = eventNames(tier.events);
	const errors = errorNames(tier.errors);

	const stateEntries = states.map((s) => `\t\t${s}: ${stateSchema(s).trimStart()}`).join(",\n");
	const commandEntries = commands.map((c) => `\t\t${c}: ${commandSchema()}`).join(",\n");
	const eventEntries = events.map((e) => `\t\t${e}: ${eventSchema()}`).join(",\n");
	const errorEntries = errors.map((e) => `\t\t${e}: ${errorSchema()}`).join(",\n");

	return [
		'import { defineWorkflow } from "@rytejs/core";',
		'import { z } from "zod";',
		"",
		`export const workflow = defineWorkflow("synthetic_${tier.tier}", {`,
		"\tstates: {",
		stateEntries,
		"\t},",
		"\tcommands: {",
		commandEntries,
		"\t},",
		"\tevents: {",
		eventEntries,
		"\t},",
		"\terrors: {",
		errorEntries,
		"\t},",
		"});",
		"",
	].join("\n");
}

function handlerBody(
	stateIdx: number,
	stateCount: number,
	firstEvent: string,
	firstError: string,
): string {
	const nextState = `State${(stateIdx + 1) % stateCount}`;
	return [
		"\t\t\tctx.update({ count: ctx.payload.n + ctx.data.count });",
		`\t\t\tctx.emit("${firstEvent}", { data: ctx.payload.payload, ts: Date.now() });`,
		"\t\t\tif (ctx.payload.n < 0) {",
		`\t\t\t\tctx.error("${firstError}", { code: "negative", detail: ctx.payload.payload });`,
		"\t\t\t}",
		`\t\t\tctx.transition("${nextState}", {`,
		"\t\t\t\tid: ctx.data.id,",
		"\t\t\t\tcount: ctx.payload.n,",
		"\t\t\t\tactive: true,",
		"\t\t\t\tmeta: { created: new Date(), source: ctx.payload.payload },",
		'\t\t\t\tkind: { type: "a" as const, valueA: ctx.payload.payload },',
		`\t\t\t\twhich: "${nextState}" as const,`,
		"\t\t\t});",
	].join("\n");
}

export function generateRouter(tier: TierConfig): string {
	const states = stateNames(tier.states);
	const commands = commandNames(tier.commands);
	const firstEvent = `Evt0`;
	const firstError = `Err0`;

	const stateBlocks = states.map((stateName, stateIdx) => {
		const handlers = commands
			.map((cmd) => {
				const body = handlerBody(stateIdx, states.length, firstEvent, firstError);
				return [
					`\tstate.on("${cmd}", (ctx) => {`,
					body,
					"\t});",
				].join("\n");
			})
			.join("\n");
		return [
			`router.state("${stateName}", (state) => {`,
			handlers,
			"});",
		].join("\n");
	});

	return [
		'import { WorkflowRouter } from "@rytejs/core";',
		'import { workflow } from "./definition.js";',
		"",
		"export const router = new WorkflowRouter(workflow);",
		"",
		stateBlocks.join("\n\n"),
		"",
	].join("\n");
}

export function generateTsconfig(): string {
	return `${JSON.stringify(
		{
			extends: "../../tsconfig.base.json",
			include: ["definition.ts", "router.ts"],
		},
		null,
		"\t",
	)}\n`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
pnpm --filter @rytejs/type-bench test
```

Expected: PASS, 7 new tests (26 total).

- [ ] **Step 5: Commit**

```bash
git add packages/type-bench/__tests__/generate.test.ts packages/type-bench/src/generate.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): synthetic fixture generator

Emits definition.ts + router.ts + tsconfig.json per tier. Uniform
schemas with per-state literal discriminator so TS tracks per-state
types without N hand-crafted schemas. Deterministic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 8: Implement run-fixture spawner

**Files:**
- Create: `packages/type-bench/src/run-fixture.ts`
- Create: `packages/type-bench/__tests__/run-fixture.integration.test.ts`

- [ ] **Step 1: Implement spawner**

`packages/type-bench/src/run-fixture.ts`:

```typescript
import { spawnSync } from "node:child_process";
import { medianDiagnostics } from "./median.js";
import { parseDiagnostics } from "./parse-diagnostics.js";
import type { DiagnosticsResult, FixtureRunResult } from "./types.js";

export interface RunFixtureOptions {
	readonly runs: number;
	readonly tscBin?: string;
}

export function runFixture(
	fixturePath: string,
	fixtureName: string,
	options: RunFixtureOptions,
): FixtureRunResult {
	const tscBin = options.tscBin ?? "tsc";
	const runs: DiagnosticsResult[] = [];

	for (let i = 0; i < options.runs; i++) {
		const result = spawnSync(
			tscBin,
			["--noEmit", "--extendedDiagnostics", "-p", fixturePath],
			{ encoding: "utf8" },
		);

		if (result.error !== undefined) {
			throw new Error(
				`Failed to spawn tsc for ${fixtureName}: ${result.error.message}`,
			);
		}

		if (result.status !== 0 && result.status !== null) {
			throw new Error(
				`tsc exited with status ${result.status} for fixture ${fixtureName}.\n` +
					`stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
			);
		}

		const combined = `${result.stdout}\n${result.stderr}`;
		runs.push(parseDiagnostics(combined));
	}

	return {
		fixture: fixtureName,
		runs,
		median: medianDiagnostics(runs),
	};
}
```

Note: `tsc --extendedDiagnostics` writes its output to stdout (not stderr) — combining both is the safe choice.

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @rytejs/type-bench typecheck
```

Expected: PASS.

- [ ] **Step 3: Write integration test (will only pass after Task 9 produces a fixture)**

`packages/type-bench/__tests__/run-fixture.integration.test.ts`:

```typescript
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runFixture } from "../src/run-fixture.js";

const smallFixture = fileURLToPath(new URL("../fixtures/synthetic/small", import.meta.url));

describe.skipIf(!existsSync(smallFixture))("runFixture (integration)", () => {
	test("runs tsc against small fixture and returns diagnostics", () => {
		const result = runFixture(smallFixture, "small", { runs: 1 });
		expect(result.fixture).toBe("small");
		expect(result.runs.length).toBe(1);
		expect(result.median.checkTimeMs).toBeGreaterThan(0);
		expect(result.median.instantiations).toBeGreaterThan(0);
	}, 30000);
});
```

`describe.skipIf` makes this test no-op until the fixture exists (Task 9).

- [ ] **Step 4: Commit**

```bash
git add packages/type-bench/src/run-fixture.ts packages/type-bench/__tests__/run-fixture.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): runFixture spawns tsc per fixture

Spawns tsc --extendedDiagnostics N times, parses output, returns
per-run results plus median. Integration test skipped until fixtures
are generated.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 9: Generate and commit synthetic fixtures

**Files:**
- Create: `packages/type-bench/fixtures/tsconfig.base.json`
- Create: `packages/type-bench/fixtures/synthetic/{small,medium,large,xl}/{definition.ts, router.ts, tsconfig.json}`
- Modify: `packages/type-bench/src/cli.ts` (will be created in Task 13; for now, write a small one-off script)

- [ ] **Step 1: Create shared fixture base tsconfig**

`packages/type-bench/fixtures/tsconfig.base.json`:

```json
{
	"extends": "../../../tsconfig.base.json",
	"compilerOptions": {
		"noEmit": true
	}
}
```

The `../../../` resolves to repo root `tsconfig.base.json`.

- [ ] **Step 2: Write a one-off generation script**

`packages/type-bench/src/generate-fixtures.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDefinition, generateRouter, generateTsconfig } from "./generate.js";
import { TIER_CONFIGS } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures", "synthetic");

for (const tier of TIER_CONFIGS) {
	const dir = join(fixturesRoot, tier.tier);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "definition.ts"), generateDefinition(tier), "utf8");
	writeFileSync(join(dir, "router.ts"), generateRouter(tier), "utf8");
	writeFileSync(join(dir, "tsconfig.json"), generateTsconfig(), "utf8");
	console.log(`Generated ${tier.tier} (${tier.states} states × ${tier.commands} commands)`);
}
```

- [ ] **Step 3: Run the generator**

```bash
cd packages/type-bench && npx tsx src/generate-fixtures.ts
```

Expected: prints 4 lines, creates 12 files (3 per tier × 4 tiers).

- [ ] **Step 4: Verify each fixture compiles**

```bash
cd packages/type-bench && for tier in small medium large xl; do
  echo "=== $tier ==="
  npx tsc --noEmit -p fixtures/synthetic/$tier
done
```

Expected: all four pass with no output. If any fails, fix the generator (Task 7) and re-run Step 3 before continuing.

- [ ] **Step 5: Verify the integration test now passes**

```bash
pnpm --filter @rytejs/type-bench vitest run __tests__/run-fixture.integration.test.ts
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/type-bench/fixtures packages/type-bench/src/generate-fixtures.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): generate synthetic fixtures (small/medium/large/xl)

Tiers: 5/5/5/3, 20/20/10/5, 50/50/20/10, 100/100/50/20 (states ×
commands × events × errors). All four fixtures compile cleanly.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 10: Realistic fixture — order

**Files:**
- Create: `packages/type-bench/fixtures/realistic/order/{tsconfig.json, definition.ts, router.ts}`

- [ ] **Step 1: Create `tsconfig.json`**

`packages/type-bench/fixtures/realistic/order/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["definition.ts", "router.ts"]
}
```

- [ ] **Step 2: Create `definition.ts`**

`packages/type-bench/fixtures/realistic/order/definition.ts`:

```typescript
import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

const lineItem = z.object({
	sku: z.string(),
	quantity: z.number().int().positive(),
	unitPrice: z.number().positive(),
});

const address = z.object({
	street: z.string(),
	city: z.string(),
	postalCode: z.string(),
	country: z.string().length(2),
});

export const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({
			items: z.array(lineItem),
			customerId: z.string(),
		}),
		Submitted: z.object({
			items: z.array(lineItem),
			customerId: z.string(),
			submittedAt: z.coerce.date(),
			shippingAddress: address,
		}),
		Paid: z.object({
			items: z.array(lineItem),
			customerId: z.string(),
			submittedAt: z.coerce.date(),
			shippingAddress: address,
			paidAt: z.coerce.date(),
			paymentMethod: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("card"), last4: z.string().length(4) }),
				z.object({ kind: z.literal("paypal"), email: z.string().email() }),
				z.object({ kind: z.literal("bank"), reference: z.string() }),
			]),
		}),
		Shipped: z.object({
			items: z.array(lineItem),
			customerId: z.string(),
			submittedAt: z.coerce.date(),
			shippingAddress: address,
			paidAt: z.coerce.date(),
			shippedAt: z.coerce.date(),
			tracking: z.string(),
		}),
		Delivered: z.object({
			items: z.array(lineItem),
			customerId: z.string(),
			submittedAt: z.coerce.date(),
			shippingAddress: address,
			paidAt: z.coerce.date(),
			shippedAt: z.coerce.date(),
			tracking: z.string(),
			deliveredAt: z.coerce.date(),
		}),
		Refunded: z.object({
			items: z.array(lineItem),
			customerId: z.string(),
			refundedAt: z.coerce.date(),
			reason: z.string(),
			amount: z.number(),
		}),
		Cancelled: z.object({
			customerId: z.string(),
			cancelledAt: z.coerce.date(),
			reason: z.string(),
		}),
	},
	commands: {
		AddItem: z.object({ item: lineItem }),
		RemoveItem: z.object({ sku: z.string() }),
		Submit: z.object({ shippingAddress: address }),
		Pay: z.object({
			method: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("card"), last4: z.string().length(4) }),
				z.object({ kind: z.literal("paypal"), email: z.string().email() }),
				z.object({ kind: z.literal("bank"), reference: z.string() }),
			]),
		}),
		Ship: z.object({ tracking: z.string() }),
		Deliver: z.object({}),
		Refund: z.object({ reason: z.string(), amount: z.number().positive() }),
		Cancel: z.object({ reason: z.string() }),
	},
	events: {
		ItemAdded: z.object({ orderId: z.string(), sku: z.string() }),
		ItemRemoved: z.object({ orderId: z.string(), sku: z.string() }),
		OrderSubmitted: z.object({ orderId: z.string(), customerId: z.string() }),
		OrderPaid: z.object({ orderId: z.string(), amount: z.number() }),
		OrderShipped: z.object({ orderId: z.string(), tracking: z.string() }),
		OrderDelivered: z.object({ orderId: z.string() }),
		OrderRefunded: z.object({ orderId: z.string(), amount: z.number() }),
		OrderCancelled: z.object({ orderId: z.string(), reason: z.string() }),
	},
	errors: {
		EmptyCart: z.object({}),
		AlreadyPaid: z.object({}),
		PaymentFailed: z.object({ provider: z.string(), message: z.string() }),
		ItemNotFound: z.object({ sku: z.string() }),
		InvalidAddress: z.object({ field: z.string() }),
	},
});
```

- [ ] **Step 3: Create `router.ts`**

`packages/type-bench/fixtures/realistic/order/router.ts`:

```typescript
import { createKey, WorkflowRouter } from "@rytejs/core";
import { orderWorkflow } from "./definition.js";

interface Deps {
	clock: { now: () => Date };
	payments: { charge: (last4: string, amount: number) => Promise<{ ok: boolean }> };
	logger: { info: (msg: string) => void };
}

const RequestIdKey = createKey<string>("requestId");

const deps: Deps = {
	clock: { now: () => new Date() },
	payments: { charge: async () => ({ ok: true }) },
	logger: { info: () => {} },
};

export const orderRouter = new WorkflowRouter(orderWorkflow, deps);

orderRouter.use(async (ctx, next) => {
	ctx.set(RequestIdKey, `req-${Date.now()}`);
	ctx.deps.logger.info(`[${ctx.get(RequestIdKey)}] ${ctx.command.type}`);
	await next();
});

orderRouter.state("Draft", (state) => {
	state.use(async (ctx, next) => {
		if (ctx.data.items.length === 0 && ctx.command.type === "Submit") {
			ctx.error("EmptyCart", {});
		}
		await next();
	});

	state.on("AddItem", (ctx) => {
		ctx.update({ items: [...ctx.data.items, ctx.payload.item] });
		ctx.emit("ItemAdded", { orderId: ctx.workflow.id, sku: ctx.payload.item.sku });
	});

	state.on("RemoveItem", (ctx) => {
		const item = ctx.data.items.find((i) => i.sku === ctx.payload.sku);
		if (item === undefined) {
			ctx.error("ItemNotFound", { sku: ctx.payload.sku });
		}
		ctx.update({ items: ctx.data.items.filter((i) => i.sku !== ctx.payload.sku) });
		ctx.emit("ItemRemoved", { orderId: ctx.workflow.id, sku: ctx.payload.sku });
	});

	state.on("Submit", (ctx) => {
		if (ctx.payload.shippingAddress.country.length !== 2) {
			ctx.error("InvalidAddress", { field: "country" });
		}
		ctx.transition("Submitted", {
			items: ctx.data.items,
			customerId: ctx.data.customerId,
			submittedAt: ctx.deps.clock.now(),
			shippingAddress: ctx.payload.shippingAddress,
		});
		ctx.emit("OrderSubmitted", { orderId: ctx.workflow.id, customerId: ctx.data.customerId });
	});

	state.on("Cancel", (ctx) => {
		ctx.transition("Cancelled", {
			customerId: ctx.data.customerId,
			cancelledAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
		});
		ctx.emit("OrderCancelled", { orderId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});

orderRouter.state("Submitted", (state) => {
	state.on("Pay", (ctx) => {
		const total = ctx.data.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
		ctx.transition("Paid", {
			items: ctx.data.items,
			customerId: ctx.data.customerId,
			submittedAt: ctx.data.submittedAt,
			shippingAddress: ctx.data.shippingAddress,
			paidAt: ctx.deps.clock.now(),
			paymentMethod: ctx.payload.method,
		});
		ctx.emit("OrderPaid", { orderId: ctx.workflow.id, amount: total });
	});

	state.on("Cancel", (ctx) => {
		ctx.transition("Cancelled", {
			customerId: ctx.data.customerId,
			cancelledAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
		});
		ctx.emit("OrderCancelled", { orderId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});

orderRouter.state("Paid", (state) => {
	state.on("Ship", (ctx) => {
		ctx.transition("Shipped", {
			items: ctx.data.items,
			customerId: ctx.data.customerId,
			submittedAt: ctx.data.submittedAt,
			shippingAddress: ctx.data.shippingAddress,
			paidAt: ctx.data.paidAt,
			shippedAt: ctx.deps.clock.now(),
			tracking: ctx.payload.tracking,
		});
		ctx.emit("OrderShipped", { orderId: ctx.workflow.id, tracking: ctx.payload.tracking });
	});

	state.on("Refund", (ctx) => {
		ctx.transition("Refunded", {
			items: ctx.data.items,
			customerId: ctx.data.customerId,
			refundedAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
			amount: ctx.payload.amount,
		});
		ctx.emit("OrderRefunded", { orderId: ctx.workflow.id, amount: ctx.payload.amount });
	});
});

orderRouter.state("Shipped", (state) => {
	state.on("Deliver", (ctx) => {
		ctx.transition("Delivered", {
			items: ctx.data.items,
			customerId: ctx.data.customerId,
			submittedAt: ctx.data.submittedAt,
			shippingAddress: ctx.data.shippingAddress,
			paidAt: ctx.data.paidAt,
			shippedAt: ctx.data.shippedAt,
			tracking: ctx.data.tracking,
			deliveredAt: ctx.deps.clock.now(),
		});
		ctx.emit("OrderDelivered", { orderId: ctx.workflow.id });
	});
});

orderRouter.on("*", "Cancel", (ctx) => {
	const summary = ctx.match({
		Draft: (data) => `draft with ${data.items.length} items`,
		Submitted: (data) => `submitted by ${data.customerId}`,
		Paid: (data) => `paid via ${data.paymentMethod.kind}`,
		Shipped: (data) => `shipped (${data.tracking})`,
		Delivered: (data) => `delivered at ${data.deliveredAt.toISOString()}`,
		Refunded: () => "already refunded",
		Cancelled: () => "already cancelled",
	});
	ctx.deps.logger.info(`Wildcard cancel on: ${summary}`);
});
```

- [ ] **Step 4: Verify it compiles**

```bash
cd packages/type-bench && npx tsc --noEmit -p fixtures/realistic/order
```

Expected: PASS, no output.

- [ ] **Step 5: Commit**

```bash
git add packages/type-bench/fixtures/realistic/order
git commit -m "$(cat <<'EOF'
feat(type-bench): realistic fixture — order workflow

7 states (Draft → Submitted → Paid → Shipped → Delivered + Refunded +
Cancelled), 8 commands, 8 events, 5 errors. Exercises typed deps,
state-scoped middleware, ctx.match, and a wildcard handler.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 11: Realistic fixture — publishing

**Files:**
- Create: `packages/type-bench/fixtures/realistic/publishing/{tsconfig.json, definition.ts, router.ts}`

- [ ] **Step 1: Create `tsconfig.json`**

`packages/type-bench/fixtures/realistic/publishing/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["definition.ts", "router.ts"]
}
```

- [ ] **Step 2: Create `definition.ts`**

`packages/type-bench/fixtures/realistic/publishing/definition.ts`:

```typescript
import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

const author = z.object({ id: z.string(), name: z.string(), email: z.string().email() });
const reviewer = z.object({ id: z.string(), role: z.enum(["editor", "legal", "seo"]) });

export const publishingWorkflow = defineWorkflow("publishing", {
	states: {
		Draft: z.object({
			title: z.string(),
			body: z.string(),
			author: author,
			tags: z.array(z.string()),
			lastEditedAt: z.coerce.date(),
		}),
		InReview: z.object({
			title: z.string(),
			body: z.string(),
			author: author,
			tags: z.array(z.string()),
			submittedAt: z.coerce.date(),
			reviewers: z.array(reviewer),
			comments: z.array(z.object({ reviewerId: z.string(), text: z.string() })),
		}),
		Approved: z.object({
			title: z.string(),
			body: z.string(),
			author: author,
			tags: z.array(z.string()),
			approvedAt: z.coerce.date(),
			approvedBy: z.array(reviewer),
		}),
		Published: z.object({
			title: z.string(),
			body: z.string(),
			author: author,
			tags: z.array(z.string()),
			publishedAt: z.coerce.date(),
			url: z.string().url(),
			views: z.number().int().nonnegative(),
		}),
		Archived: z.object({
			title: z.string(),
			author: author,
			archivedAt: z.coerce.date(),
			reason: z.string(),
		}),
	},
	commands: {
		Edit: z.object({ title: z.string().optional(), body: z.string().optional() }),
		AddTag: z.object({ tag: z.string() }),
		Submit: z.object({ reviewers: z.array(reviewer) }),
		Comment: z.object({ reviewerId: z.string(), text: z.string() }),
		Approve: z.object({ reviewerId: z.string() }),
		Reject: z.object({ reviewerId: z.string(), reason: z.string() }),
		Publish: z.object({ url: z.string().url() }),
		RecordView: z.object({}),
		Archive: z.object({ reason: z.string() }),
	},
	events: {
		Edited: z.object({ articleId: z.string() }),
		TagAdded: z.object({ articleId: z.string(), tag: z.string() }),
		Submitted: z.object({ articleId: z.string(), reviewerCount: z.number() }),
		Commented: z.object({ articleId: z.string(), reviewerId: z.string() }),
		Approved: z.object({ articleId: z.string(), reviewerId: z.string() }),
		Rejected: z.object({ articleId: z.string(), reason: z.string() }),
		Published: z.object({ articleId: z.string(), url: z.string() }),
		Viewed: z.object({ articleId: z.string() }),
		Archived: z.object({ articleId: z.string(), reason: z.string() }),
	},
	errors: {
		EmptyContent: z.object({ field: z.enum(["title", "body"]) }),
		NotAReviewer: z.object({ reviewerId: z.string() }),
		AlreadyPublished: z.object({}),
		InvalidUrl: z.object({ url: z.string() }),
	},
});
```

- [ ] **Step 3: Create `router.ts`**

`packages/type-bench/fixtures/realistic/publishing/router.ts`:

```typescript
import { WorkflowRouter } from "@rytejs/core";
import { publishingWorkflow } from "./definition.js";

interface Deps {
	clock: { now: () => Date };
	urlValidator: { isValid: (url: string) => boolean };
}

const deps: Deps = {
	clock: { now: () => new Date() },
	urlValidator: { isValid: (u) => u.startsWith("https://") },
};

export const publishingRouter = new WorkflowRouter(publishingWorkflow, deps);

publishingRouter.state("Draft", (state) => {
	state.on("Edit", (ctx) => {
		if (ctx.payload.title === "" || ctx.payload.body === "") {
			ctx.error("EmptyContent", { field: ctx.payload.title === "" ? "title" : "body" });
		}
		ctx.update({
			title: ctx.payload.title ?? ctx.data.title,
			body: ctx.payload.body ?? ctx.data.body,
			lastEditedAt: ctx.deps.clock.now(),
		});
		ctx.emit("Edited", { articleId: ctx.workflow.id });
	});

	state.on("AddTag", (ctx) => {
		ctx.update({ tags: [...ctx.data.tags, ctx.payload.tag] });
		ctx.emit("TagAdded", { articleId: ctx.workflow.id, tag: ctx.payload.tag });
	});

	state.on("Submit", (ctx) => {
		ctx.transition("InReview", {
			title: ctx.data.title,
			body: ctx.data.body,
			author: ctx.data.author,
			tags: ctx.data.tags,
			submittedAt: ctx.deps.clock.now(),
			reviewers: ctx.payload.reviewers,
			comments: [],
		});
		ctx.emit("Submitted", {
			articleId: ctx.workflow.id,
			reviewerCount: ctx.payload.reviewers.length,
		});
	});
});

publishingRouter.state("InReview", (state) => {
	state.use(async (ctx, next) => {
		if (
			(ctx.command.type === "Comment" ||
				ctx.command.type === "Approve" ||
				ctx.command.type === "Reject") &&
			!ctx.data.reviewers.some((r) => r.id === ctx.command.payload.reviewerId)
		) {
			ctx.error("NotAReviewer", { reviewerId: ctx.command.payload.reviewerId });
		}
		await next();
	});

	state.on("Comment", (ctx) => {
		ctx.update({
			comments: [
				...ctx.data.comments,
				{ reviewerId: ctx.payload.reviewerId, text: ctx.payload.text },
			],
		});
		ctx.emit("Commented", {
			articleId: ctx.workflow.id,
			reviewerId: ctx.payload.reviewerId,
		});
	});

	state.on("Approve", (ctx) => {
		const reviewer = ctx.data.reviewers.find((r) => r.id === ctx.payload.reviewerId);
		if (reviewer === undefined) {
			ctx.error("NotAReviewer", { reviewerId: ctx.payload.reviewerId });
		}
		ctx.transition("Approved", {
			title: ctx.data.title,
			body: ctx.data.body,
			author: ctx.data.author,
			tags: ctx.data.tags,
			approvedAt: ctx.deps.clock.now(),
			approvedBy: [reviewer],
		});
		ctx.emit("Approved", {
			articleId: ctx.workflow.id,
			reviewerId: ctx.payload.reviewerId,
		});
	});

	state.on("Reject", (ctx) => {
		ctx.transition("Draft", {
			title: ctx.data.title,
			body: ctx.data.body,
			author: ctx.data.author,
			tags: ctx.data.tags,
			lastEditedAt: ctx.deps.clock.now(),
		});
		ctx.emit("Rejected", { articleId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});

publishingRouter.state("Approved", (state) => {
	state.on("Publish", (ctx) => {
		if (!ctx.deps.urlValidator.isValid(ctx.payload.url)) {
			ctx.error("InvalidUrl", { url: ctx.payload.url });
		}
		ctx.transition("Published", {
			title: ctx.data.title,
			body: ctx.data.body,
			author: ctx.data.author,
			tags: ctx.data.tags,
			publishedAt: ctx.deps.clock.now(),
			url: ctx.payload.url,
			views: 0,
		});
		ctx.emit("Published", { articleId: ctx.workflow.id, url: ctx.payload.url });
	});
});

publishingRouter.state("Published", (state) => {
	state.on("RecordView", (ctx) => {
		ctx.update({ views: ctx.data.views + 1 });
		ctx.emit("Viewed", { articleId: ctx.workflow.id });
	});

	state.on("Archive", (ctx) => {
		ctx.transition("Archived", {
			title: ctx.data.title,
			author: ctx.data.author,
			archivedAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
		});
		ctx.emit("Archived", { articleId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});
```

- [ ] **Step 4: Verify it compiles**

```bash
cd packages/type-bench && npx tsc --noEmit -p fixtures/realistic/publishing
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/type-bench/fixtures/realistic/publishing
git commit -m "$(cat <<'EOF'
feat(type-bench): realistic fixture — publishing workflow

5 states (Draft → InReview → Approved → Published → Archived),
9 commands, 9 events, 4 errors. Exercises typed deps, state-scoped
middleware that inspects command payload via discriminated union.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 12: Realistic fixture — billing

**Files:**
- Create: `packages/type-bench/fixtures/realistic/billing/{tsconfig.json, definition.ts, router.ts}`

- [ ] **Step 1: Create `tsconfig.json`**

`packages/type-bench/fixtures/realistic/billing/tsconfig.json`:

```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["definition.ts", "router.ts"]
}
```

- [ ] **Step 2: Create `definition.ts`**

`packages/type-bench/fixtures/realistic/billing/definition.ts`:

```typescript
import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

const tier = z.discriminatedUnion("name", [
	z.object({ name: z.literal("free"), seats: z.literal(1) }),
	z.object({ name: z.literal("pro"), seats: z.number().int().min(1).max(10) }),
	z.object({ name: z.literal("enterprise"), seats: z.number().int().min(1), supportLevel: z.enum(["standard", "premium"]) }),
]);

const subscription = z.object({
	customerId: z.string(),
	tier: tier,
	startedAt: z.coerce.date(),
});

export const billingWorkflow = defineWorkflow("billing", {
	states: {
		Trial: subscription.extend({
			trialEndsAt: z.coerce.date(),
		}),
		Active: subscription.extend({
			activatedAt: z.coerce.date(),
			nextBillingAt: z.coerce.date(),
			invoices: z.array(z.object({ id: z.string(), amount: z.number(), paidAt: z.coerce.date() })),
		}),
		PastDue: subscription.extend({
			activatedAt: z.coerce.date(),
			pastDueSince: z.coerce.date(),
			amountOwed: z.number().positive(),
			retryCount: z.number().int().nonnegative(),
		}),
		Canceled: subscription.extend({
			canceledAt: z.coerce.date(),
			reason: z.string(),
			finalInvoice: z.object({ id: z.string(), amount: z.number() }).optional(),
		}),
		Reactivated: subscription.extend({
			reactivatedAt: z.coerce.date(),
			previousState: z.enum(["PastDue", "Canceled"]),
		}),
	},
	commands: {
		Activate: z.object({ paymentMethodId: z.string() }),
		Charge: z.object({ amount: z.number().positive(), invoiceId: z.string() }),
		FailPayment: z.object({ amount: z.number().positive(), reason: z.string() }),
		RetryPayment: z.object({ paymentMethodId: z.string() }),
		Cancel: z.object({ reason: z.string() }),
		Reactivate: z.object({ paymentMethodId: z.string() }),
		ChangeTier: z.object({ newTier: tier }),
	},
	events: {
		Activated: z.object({ subscriptionId: z.string() }),
		Charged: z.object({ subscriptionId: z.string(), amount: z.number(), invoiceId: z.string() }),
		PaymentFailed: z.object({ subscriptionId: z.string(), reason: z.string() }),
		PaymentRetried: z.object({ subscriptionId: z.string() }),
		Canceled: z.object({ subscriptionId: z.string(), reason: z.string() }),
		Reactivated: z.object({ subscriptionId: z.string() }),
		TierChanged: z.object({ subscriptionId: z.string(), newTierName: z.string() }),
	},
	errors: {
		PaymentDeclined: z.object({ reason: z.string() }),
		MaxRetriesExceeded: z.object({ retries: z.number() }),
		InvalidTierTransition: z.object({ from: z.string(), to: z.string() }),
		AlreadyCanceled: z.object({}),
	},
});
```

- [ ] **Step 3: Create `router.ts`**

`packages/type-bench/fixtures/realistic/billing/router.ts`:

```typescript
import { WorkflowRouter } from "@rytejs/core";
import { billingWorkflow } from "./definition.js";

interface Deps {
	clock: { now: () => Date };
	gateway: { charge: (methodId: string, amount: number) => Promise<{ ok: boolean; reason?: string }> };
}

const MAX_RETRIES = 3;

const deps: Deps = {
	clock: { now: () => new Date() },
	gateway: { charge: async () => ({ ok: true }) },
};

export const billingRouter = new WorkflowRouter(billingWorkflow, deps);

billingRouter.state("Trial", (state) => {
	state.on("Activate", (ctx) => {
		const now = ctx.deps.clock.now();
		const next = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
		ctx.transition("Active", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			activatedAt: now,
			nextBillingAt: next,
			invoices: [],
		});
		ctx.emit("Activated", { subscriptionId: ctx.workflow.id });
	});

	state.on("Cancel", (ctx) => {
		ctx.transition("Canceled", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			canceledAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
		});
		ctx.emit("Canceled", { subscriptionId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});

billingRouter.state("Active", (state) => {
	state.on("Charge", (ctx) => {
		ctx.update({
			invoices: [
				...ctx.data.invoices,
				{ id: ctx.payload.invoiceId, amount: ctx.payload.amount, paidAt: ctx.deps.clock.now() },
			],
		});
		ctx.emit("Charged", {
			subscriptionId: ctx.workflow.id,
			amount: ctx.payload.amount,
			invoiceId: ctx.payload.invoiceId,
		});
	});

	state.on("FailPayment", (ctx) => {
		ctx.transition("PastDue", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			activatedAt: ctx.data.activatedAt,
			pastDueSince: ctx.deps.clock.now(),
			amountOwed: ctx.payload.amount,
			retryCount: 0,
		});
		ctx.emit("PaymentFailed", {
			subscriptionId: ctx.workflow.id,
			reason: ctx.payload.reason,
		});
	});

	state.on("ChangeTier", (ctx) => {
		ctx.update({ tier: ctx.payload.newTier });
		ctx.emit("TierChanged", {
			subscriptionId: ctx.workflow.id,
			newTierName: ctx.payload.newTier.name,
		});
	});

	state.on("Cancel", (ctx) => {
		ctx.transition("Canceled", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			canceledAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
		});
		ctx.emit("Canceled", { subscriptionId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});

billingRouter.state("PastDue", (state) => {
	state.on("RetryPayment", (ctx) => {
		if (ctx.data.retryCount >= MAX_RETRIES) {
			ctx.error("MaxRetriesExceeded", { retries: ctx.data.retryCount });
		}
		ctx.update({ retryCount: ctx.data.retryCount + 1 });
		ctx.emit("PaymentRetried", { subscriptionId: ctx.workflow.id });
	});

	state.on("Charge", (ctx) => {
		ctx.transition("Active", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			activatedAt: ctx.data.activatedAt,
			nextBillingAt: new Date(ctx.deps.clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
			invoices: [
				{ id: ctx.payload.invoiceId, amount: ctx.payload.amount, paidAt: ctx.deps.clock.now() },
			],
		});
		ctx.emit("Charged", {
			subscriptionId: ctx.workflow.id,
			amount: ctx.payload.amount,
			invoiceId: ctx.payload.invoiceId,
		});
	});

	state.on("Cancel", (ctx) => {
		ctx.transition("Canceled", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			canceledAt: ctx.deps.clock.now(),
			reason: ctx.payload.reason,
		});
		ctx.emit("Canceled", { subscriptionId: ctx.workflow.id, reason: ctx.payload.reason });
	});
});

billingRouter.state("Canceled", (state) => {
	state.on("Reactivate", (ctx) => {
		ctx.transition("Reactivated", {
			customerId: ctx.data.customerId,
			tier: ctx.data.tier,
			startedAt: ctx.data.startedAt,
			reactivatedAt: ctx.deps.clock.now(),
			previousState: "Canceled",
		});
		ctx.emit("Reactivated", { subscriptionId: ctx.workflow.id });
	});
});

billingRouter.on("error", (error, ctx) => {
	if (error.category === "domain") {
		ctx.deps.clock.now();
	}
});
```

- [ ] **Step 4: Verify it compiles**

```bash
cd packages/type-bench && npx tsc --noEmit -p fixtures/realistic/billing
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/type-bench/fixtures/realistic/billing
git commit -m "$(cat <<'EOF'
feat(type-bench): realistic fixture — billing workflow

5 states (Trial → Active → PastDue → Canceled → Reactivated),
7 commands, 7 events, 4 errors. Exercises a 3-arm discriminated
union in payload (subscription tier) and an error hook handler.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 13: Implement main runner orchestrator

**Files:**
- Create: `packages/type-bench/src/run.ts`

- [ ] **Step 1: Implement**

`packages/type-bench/src/run.ts`:

```typescript
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compare } from "./compare.js";
import { renderTable } from "./format-table.js";
import { runFixture } from "./run-fixture.js";
import {
	type BenchRun,
	DEFAULT_THRESHOLDS,
	type DiagnosticsResult,
	type FixtureRunResult,
} from "./types.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES_ROOT = join(PACKAGE_ROOT, "fixtures");
const RESULTS_DIR = join(PACKAGE_ROOT, "results");
const BASELINE_PATH = join(PACKAGE_ROOT, "baseline.json");
const BASELINE_META_PATH = join(PACKAGE_ROOT, "baseline.meta.json");

export interface RunOptions {
	readonly runs: number;
	readonly mode: "bench" | "baseline";
	readonly ci: boolean;
}

function discoverFixtures(): { name: string; path: string }[] {
	const fixtures: { name: string; path: string }[] = [];
	for (const category of ["synthetic", "realistic"]) {
		const categoryDir = join(FIXTURES_ROOT, category);
		if (!existsSync(categoryDir)) continue;
		for (const entry of readdirSync(categoryDir)) {
			const fixturePath = join(categoryDir, entry);
			const tsconfigPath = join(fixturePath, "tsconfig.json");
			if (existsSync(tsconfigPath)) {
				fixtures.push({ name: `${category}/${entry}`, path: fixturePath });
			}
		}
	}
	return fixtures.sort((a, b) => a.name.localeCompare(b.name));
}

function detectTscBin(): string {
	return join(PACKAGE_ROOT, "node_modules", ".bin", "tsc");
}

function detectTsVersion(): string {
	const pkgPath = join(PACKAGE_ROOT, "node_modules", "typescript", "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
	return pkg.version;
}

function detectCpu(): string {
	const all = cpus();
	return all[0]?.model ?? "unknown";
}

function buildBenchRun(results: readonly FixtureRunResult[]): BenchRun {
	const fixtures: Record<string, DiagnosticsResult> = {};
	for (const r of results) {
		fixtures[r.fixture] = r.median;
	}
	return {
		timestamp: new Date().toISOString(),
		tsVersion: detectTsVersion(),
		nodeVersion: process.version,
		cpuModel: detectCpu(),
		fixtures,
	};
}

function loadBaseline(): BenchRun | null {
	if (!existsSync(BASELINE_PATH)) return null;
	return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BenchRun;
}

function writeResults(benchRun: BenchRun): string {
	mkdirSync(RESULTS_DIR, { recursive: true });
	const filename = `${benchRun.timestamp.replace(/[:.]/g, "-")}.json`;
	const path = join(RESULTS_DIR, filename);
	writeFileSync(path, `${JSON.stringify(benchRun, null, "\t")}\n`, "utf8");
	return path;
}

function writeBaseline(benchRun: BenchRun): void {
	writeFileSync(BASELINE_PATH, `${JSON.stringify(benchRun, null, "\t")}\n`, "utf8");
	writeFileSync(
		BASELINE_META_PATH,
		`${JSON.stringify(
			{
				generatedAt: benchRun.timestamp,
				cpuModel: benchRun.cpuModel,
				nodeVersion: benchRun.nodeVersion,
				tsVersion: benchRun.tsVersion,
			},
			null,
			"\t",
		)}\n`,
		"utf8",
	);
}

export async function run(options: RunOptions): Promise<number> {
	const tscBin = detectTscBin();
	const fixtures = discoverFixtures();

	if (fixtures.length === 0) {
		console.error("No fixtures found under packages/type-bench/fixtures/");
		return 2;
	}

	console.log(`Running ${fixtures.length} fixture(s) × ${options.runs} run(s)...\n`);

	const results: FixtureRunResult[] = [];
	for (const fixture of fixtures) {
		process.stdout.write(`  ${fixture.name} ... `);
		try {
			const result = runFixture(fixture.path, fixture.name, {
				runs: options.runs,
				tscBin,
			});
			results.push(result);
			console.log(
				`${result.median.checkTimeMs}ms check, ${result.median.instantiations.toLocaleString()} instantiations`,
			);
		} catch (err) {
			console.log("FAILED");
			console.error(`    ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	const benchRun = buildBenchRun(results);

	if (options.mode === "baseline") {
		writeBaseline(benchRun);
		console.log(`\nBaseline written to ${BASELINE_PATH}`);
		return 0;
	}

	const resultsPath = writeResults(benchRun);
	console.log(`\nResults written to ${resultsPath}\n`);

	const baseline = loadBaseline();
	if (baseline === null) {
		console.log("No baseline found — run `pnpm bench:baseline` to create one.");
		return 0;
	}

	const report = compare(benchRun, baseline, DEFAULT_THRESHOLDS);
	console.log(renderTable(report));

	if (options.ci && report.hasRegression) return 1;
	return 0;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @rytejs/type-bench typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/type-bench/src/run.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): main runner orchestrator

Discovers fixtures, runs tsc N times each via runFixture, writes
results.json. With --baseline, writes baseline.json + meta. Otherwise
compares to baseline and renders a colored table; exits 1 on
regression when --ci is set.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 14: Implement trace runner

**Files:**
- Create: `packages/type-bench/src/trace.ts`

- [ ] **Step 1: Implement**

`packages/type-bench/src/trace.ts`:

```typescript
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURES_ROOT = join(PACKAGE_ROOT, "fixtures");
const TRACE_OUT = join(PACKAGE_ROOT, "trace-out");

function findFixture(name: string): string | null {
	for (const category of ["synthetic", "realistic"]) {
		const candidate = join(FIXTURES_ROOT, category, name);
		if (existsSync(join(candidate, "tsconfig.json"))) return candidate;
	}
	return null;
}

export function trace(fixtureName: string): number {
	if (fixtureName === "") {
		console.error("Usage: pnpm bench:trace <fixture-name>");
		console.error("Example: pnpm bench:trace small");
		return 2;
	}

	const fixturePath = findFixture(fixtureName);
	if (fixturePath === null) {
		console.error(`Fixture not found: ${fixtureName}`);
		console.error("Run `pnpm bench` to see available fixtures.");
		return 2;
	}

	if (existsSync(TRACE_OUT)) rmSync(TRACE_OUT, { recursive: true });
	mkdirSync(TRACE_OUT, { recursive: true });

	const tscBin = join(PACKAGE_ROOT, "node_modules", ".bin", "tsc");
	const result = spawnSync(
		tscBin,
		["--noEmit", "--generateTrace", TRACE_OUT, "-p", fixturePath],
		{ stdio: "inherit" },
	);

	if (result.error !== undefined) {
		console.error(`Failed to spawn tsc: ${result.error.message}`);
		return 1;
	}

	console.log("");
	console.log(`Trace written to ${TRACE_OUT}/`);
	console.log("Next steps:");
	console.log(`  1. Open chrome://tracing in Chrome and load ${TRACE_OUT}/trace.json`);
	console.log(`  2. Or run: npx @typescript/analyze-trace ${TRACE_OUT}`);

	return 0;
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter @rytejs/type-bench typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/type-bench/src/trace.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): opt-in trace runner

Wraps tsc --generateTrace, prints next-step instructions for
chrome://tracing or @typescript/analyze-trace.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 15: Implement CLI entry point

**Files:**
- Create: `packages/type-bench/src/cli.ts`

- [ ] **Step 1: Implement**

`packages/type-bench/src/cli.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDefinition, generateRouter, generateTsconfig } from "./generate.js";
import { run } from "./run.js";
import { trace } from "./trace.js";
import { TIER_CONFIGS } from "./types.js";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<number> {
	const [, , command, ...args] = process.argv;

	if (command === "bench") {
		const baseline = args.includes("--baseline");
		const ci = args.includes("--ci");
		return run({
			runs: baseline ? 5 : 3,
			mode: baseline ? "baseline" : "bench",
			ci,
		});
	}

	if (command === "trace") {
		return trace(args[0] ?? "");
	}

	if (command === "generate") {
		const fixturesRoot = join(PACKAGE_ROOT, "fixtures", "synthetic");
		for (const tier of TIER_CONFIGS) {
			const dir = join(fixturesRoot, tier.tier);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "definition.ts"), generateDefinition(tier), "utf8");
			writeFileSync(join(dir, "router.ts"), generateRouter(tier), "utf8");
			writeFileSync(join(dir, "tsconfig.json"), generateTsconfig(), "utf8");
			console.log(`Generated ${tier.tier} (${tier.states} states × ${tier.commands} commands)`);
		}
		return 0;
	}

	console.error("Usage:");
	console.error("  pnpm bench [--ci]              # run benchmarks vs baseline");
	console.error("  pnpm bench:baseline            # write a fresh baseline");
	console.error("  pnpm bench:trace <fixture>     # generate flamegraph trace");
	console.error("  pnpm generate                  # regenerate synthetic fixtures");
	return 2;
}

main().then(
	(code) => process.exit(code),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
```

- [ ] **Step 2: Delete the standalone generate-fixtures.ts script (now superseded by `cli.ts generate`)**

```bash
git rm packages/type-bench/src/generate-fixtures.ts
```

- [ ] **Step 3: Verify each CLI command typechecks**

```bash
pnpm --filter @rytejs/type-bench typecheck
```

Expected: PASS.

- [ ] **Step 4: Smoke-test `generate` command (idempotent — should produce identical output)**

```bash
pnpm --filter @rytejs/type-bench generate
git diff --exit-code packages/type-bench/fixtures/synthetic
```

Expected: `git diff --exit-code` returns 0 (no changes to existing fixtures).

- [ ] **Step 5: Smoke-test `bench` command (no baseline yet — should print "no baseline" and exit 0)**

```bash
pnpm --filter @rytejs/type-bench bench
```

Expected: prints fixture results, then "No baseline found — run `pnpm bench:baseline` to create one." Exits 0. May take 1–2 minutes.

- [ ] **Step 6: Commit**

```bash
git add packages/type-bench/src/cli.ts
git commit -m "$(cat <<'EOF'
feat(type-bench): CLI entry point

Routes bench / bench --baseline / trace <fixture> / generate.
Replaces standalone generate-fixtures.ts script.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 16: Generate initial baseline

**Files:**
- Create: `packages/type-bench/baseline.json`
- Create: `packages/type-bench/baseline.meta.json`

- [ ] **Step 1: Run baseline**

```bash
pnpm --filter @rytejs/type-bench bench:baseline
```

Expected: runs each fixture 5 times, prints results, writes `baseline.json` + `baseline.meta.json`. May take 5–10 minutes for the xl tier.

- [ ] **Step 2: Verify the baseline files exist and are valid JSON**

```bash
cat packages/type-bench/baseline.json | python3 -m json.tool > /dev/null && echo OK
cat packages/type-bench/baseline.meta.json | python3 -m json.tool > /dev/null && echo OK
```

Expected: both print `OK`.

- [ ] **Step 3: Run `bench` and confirm comparison shows all `ok`**

```bash
pnpm --filter @rytejs/type-bench bench
```

Expected: table where every row is dim/ok status. No regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/type-bench/baseline.json packages/type-bench/baseline.meta.json
git commit -m "$(cat <<'EOF'
chore(type-bench): initial baseline

Median of 5 runs across 7 fixtures (4 synthetic tiers + order +
publishing + billing). See baseline.meta.json for hardware
fingerprint.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 17: Write README

**Files:**
- Create: `packages/type-bench/README.md`

- [ ] **Step 1: Create README**

`packages/type-bench/README.md`:

````markdown
# @rytejs/type-bench

TypeScript type-resolution performance benchmarks for `@rytejs/core`.

Private workspace package. Not published.

## Quick start

```bash
pnpm --filter @rytejs/type-bench bench
```

Runs each fixture 3 times, takes the median, compares to `baseline.json`,
prints a colored table.

## Commands

| Command | What it does |
|---------|--------------|
| `pnpm bench` | Run benchmarks; compare to baseline; print table. Exit 0. |
| `pnpm bench --ci` | Same, but exit 1 if any metric regresses past threshold. |
| `pnpm bench:baseline` | Run 5 times per fixture; overwrite `baseline.json` + meta. |
| `pnpm bench:trace <fixture>` | Generate flamegraph trace (e.g. `bench:trace small`). |
| `pnpm generate` | Regenerate synthetic fixtures (idempotent). |

All commands are `pnpm --filter @rytejs/type-bench <command>` — shorten with a
shell alias if you run them often.

## Fixtures

Two categories under `fixtures/`:

- **Synthetic** (`small`, `medium`, `large`, `xl`) — generated by `src/generate.ts`.
  Use these to track scaling behavior. `generate` is deterministic — same input
  produces the same bytes.
- **Realistic** (`order`, `publishing`, `billing`) — hand-written, modeled on
  plausible domains. Use these to track absolute cost on real-world shapes.

Each fixture has its own `tsconfig.json`. The harness's own `tsc --noEmit`
explicitly excludes `fixtures/`.

## Metrics

Per fixture, parsed from `tsc --extendedDiagnostics`:

- `checkTimeMs` — type-check phase only
- `totalTimeMs` — wall-clock for the whole tsc run
- `instantiations` — generic instantiations created
- `types` — types created
- `memoryKb` — peak memory used

For the `small` tier, `tsc` startup dominates `checkTimeMs`. Treat
`instantiations` and `types` as primary metrics there.

## Baseline policy

`baseline.json` is checked in. Update it when:

- You land a perf-improving PR — bump in the same PR (`pnpm bench:baseline`,
  commit the diff).
- You land a deliberate regression (e.g. a feature that costs types) — bump
  with explanation in the commit body.
- You upgrade TypeScript — bump with TS version called out.

`baseline.meta.json` records the machine that produced the baseline. The
runner prints `MISMATCH` if your CPU model or TS version differs — comparisons
across machines are not meaningful.

## Thresholds

| Metric | Threshold |
|--------|-----------|
| `checkTimeMs` | +10% |
| `instantiations` | +15% |
| `types` | +10% |
| `memoryKb` | +20% |

Improvements >5% are highlighted in green. Tweak in `src/types.ts` if needed.

## Variance

- `bench`: 3 runs/fixture, median.
- `bench:baseline`: 5 runs/fixture, median.

If you see flapping at the threshold, it's usually one of: laptop on battery,
background processes, thermal throttling. Re-run.

## Adding fixtures

**Synthetic:** edit `src/generate.ts` and run `pnpm generate`. Tests in
`__tests__/generate.test.ts` enforce determinism.

**Realistic:** create `fixtures/realistic/<name>/{tsconfig.json, definition.ts, router.ts}`.
Must compile with `tsc --noEmit -p fixtures/realistic/<name>` before commit.
The runner picks it up automatically on the next `bench`.
````

- [ ] **Step 2: Commit**

```bash
git add packages/type-bench/README.md
git commit -m "$(cat <<'EOF'
docs(type-bench): README

How to run, baseline policy, threshold reference, variance notes,
how to add fixtures.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 18: Final verification — full workspace check

- [ ] **Step 1: Run repo-wide check**

```bash
pnpm run check
```

Expected: PASS. The `@rytejs/type-bench` package's `typecheck` and `test` scripts are picked up automatically by turbo.

- [ ] **Step 2: Run biome on the new package**

```bash
pnpm biome check packages/type-bench
```

Expected: no errors. If formatter changes are suggested, run `pnpm biome check --fix packages/type-bench` and amend the relevant commit (or commit as a follow-up).

- [ ] **Step 3: Verify the `--ci` flag exits non-zero on a synthetic regression**

This is a manual sanity check — temporarily edit `baseline.json` to halve `small`'s `checkTimeMs`, run `bench --ci`, expect exit 1, then revert.

```bash
# Save the original
cp packages/type-bench/baseline.json /tmp/baseline.original.json

# Edit baseline.json: find "synthetic/small" → "checkTimeMs" and divide by 2.
# Use jq:
jq '.fixtures["synthetic/small"].checkTimeMs |= (. / 2 | floor)' \
  packages/type-bench/baseline.json > /tmp/baseline.modified.json
mv /tmp/baseline.modified.json packages/type-bench/baseline.json

# Run --ci, expect exit 1
pnpm --filter @rytejs/type-bench bench --ci
echo "Exit code: $?"   # Expected: 1

# Restore
mv /tmp/baseline.original.json packages/type-bench/baseline.json
```

- [ ] **Step 4: Sanity-check that bench:trace produces a trace.json**

```bash
pnpm --filter @rytejs/type-bench bench:trace small
ls packages/type-bench/trace-out/trace.json
```

Expected: file exists.

- [ ] **Step 5: No commit needed for verification — close out the plan**

If everything above passed, the implementation is complete. The user can now:

- Run `pnpm --filter @rytejs/type-bench bench` to see current numbers.
- Pick a target (likely `Prettify<T>` removal first, then mapped-indexed unions in `Workflow`/`Command`).
- Implement, re-bench, see the delta.

---

## Self-Review

**Spec coverage check:**
- Package layout (spec § Package Layout) — Tasks 1, 9, 10–12.
- Three commands `bench` / `bench:trace` / `bench:baseline` (spec § Solution) — Tasks 13, 14, 15.
- Synthetic + realistic fixtures (spec § Components) — Tasks 7, 9, 10–12.
- Median of 3/5 (spec § Variance Handling) — Tasks 4, 13, 15.
- Per-metric thresholds (spec § Measurement Workflow) — Tasks 2, 5.
- Hardware fingerprint (spec § Failure Modes) — Tasks 5, 13.
- `extendedDiagnostics` parser with strict format check (spec § Components) — Task 3.
- Trace runner (spec § Components) — Task 14.
- README (spec § Solution implies it) — Task 17.
- All harness code typechecks with `noUncheckedIndexedAccess` strict (spec § Constraints) — verified via Task 1's tsconfig + Task 18's check.
- No `any` / `unknown` in consumer-facing positions (spec § Constraints) — runner code uses concrete types throughout; verified by `tsc --noEmit` strict.

**Placeholder scan:** None.

**Type consistency:** `DiagnosticsResult`, `BenchRun`, `FixtureRunResult`, `Thresholds`, `ComparisonReport`, `RegressionStatus`, `TierConfig`, `Tier` — defined once in Task 2, referenced consistently in Tasks 3–15. CLI command names match between `package.json` (Task 1) and `cli.ts` argv parsing (Task 15): `bench`, `trace`, `generate`. The `--baseline` flag is parsed in cli.ts and routes to `mode: "baseline"` in `run.ts`.

**Out-of-scope items deliberately not covered:** react/testing fixtures, CI integration, flamegraph diffing, memory-leak detection — all called out in spec § Out of Scope and the README also reflects this implicitly.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-type-perf-bench.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
