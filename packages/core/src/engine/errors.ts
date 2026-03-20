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
