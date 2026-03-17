import type { ValidationError } from "../types.js";

export class ConcurrencyConflictError extends Error {
	readonly name = "ConcurrencyConflictError";

	constructor(
		readonly workflowId: string,
		readonly expectedVersion: number,
		readonly actualVersion: number,
	) {
		super(
			`Concurrency conflict for workflow "${workflowId}": expected version ${expectedVersion}, actual ${actualVersion}`,
		);
	}
}

export class WorkflowAlreadyExistsError extends Error {
	readonly name = "WorkflowAlreadyExistsError";

	constructor(readonly workflowId: string) {
		super(`Workflow "${workflowId}" already exists`);
	}
}

export class WorkflowNotFoundError extends Error {
	readonly name = "WorkflowNotFoundError";

	constructor(readonly workflowId: string) {
		super(`Workflow "${workflowId}" not found`);
	}
}

export class RouterNotFoundError extends Error {
	readonly name = "RouterNotFoundError";

	constructor(readonly routerName: string) {
		super(`Router "${routerName}" not found`);
	}
}

export class RestoreError extends Error {
	readonly name = "RestoreError";

	constructor(
		readonly workflowId: string,
		readonly validationError: ValidationError,
	) {
		super(`Failed to restore workflow "${workflowId}": ${validationError.message}`);
	}
}

export class LockConflictError extends Error {
	readonly name = "LockConflictError";

	constructor(readonly workflowId: string) {
		super(`Lock conflict for workflow "${workflowId}": lock is held by another process`);
	}
}
