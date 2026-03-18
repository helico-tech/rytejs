export interface OrderEntry {
	id: string;
	customer: string;
	state: string;
	createdAt: string;
}

export interface LogEntry {
	id: number;
	command: string;
	payload: unknown;
	fromState: string;
	toState: string;
	timestamp: number;
	durationMs: number;
	events: string[];
	error: {
		category: string;
		message: string;
		code?: string;
	} | null;
}
