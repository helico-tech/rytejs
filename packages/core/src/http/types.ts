import type { ExecutionEngine } from "../engine/engine.js";

export interface HttpHandlerOptions {
	engine: ExecutionEngine;
	basePath?: string;
}
