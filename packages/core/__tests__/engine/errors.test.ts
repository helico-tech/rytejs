import { describe, expect, test } from "vitest";
import {
	ConcurrencyConflictError,
	RestoreError,
	RouterNotFoundError,
	WorkflowAlreadyExistsError,
	WorkflowNotFoundError,
} from "../../src/engine/errors.js";
import { ValidationError } from "../../src/types.js";

describe("engine errors", () => {
	test("ConcurrencyConflictError has correct fields", () => {
		const err = new ConcurrencyConflictError("wf-1", 2, 3);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("ConcurrencyConflictError");
		expect(err.workflowId).toBe("wf-1");
		expect(err.expectedVersion).toBe(2);
		expect(err.actualVersion).toBe(3);
		expect(err.message).toContain("wf-1");
	});

	test("WorkflowAlreadyExistsError has correct fields", () => {
		const err = new WorkflowAlreadyExistsError("wf-1");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("WorkflowAlreadyExistsError");
		expect(err.workflowId).toBe("wf-1");
	});

	test("WorkflowNotFoundError has correct fields", () => {
		const err = new WorkflowNotFoundError("wf-1");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("WorkflowNotFoundError");
		expect(err.workflowId).toBe("wf-1");
	});

	test("RouterNotFoundError has correct fields", () => {
		const err = new RouterNotFoundError("orders");
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("RouterNotFoundError");
		expect(err.routerName).toBe("orders");
	});

	test("RestoreError has correct fields", () => {
		const validationError = new ValidationError("restore", []);
		const err = new RestoreError("wf-1", validationError);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("RestoreError");
		expect(err.workflowId).toBe("wf-1");
		expect(err.validationError).toBe(validationError);
	});
});
