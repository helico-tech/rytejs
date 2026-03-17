import type { CommandResult, CommandTransport, TransportError } from "../types.js";

export interface HttpCommandOptions {
	/** Base URL of the engine HTTP handler */
	url: string;
	/** Router name for URL construction (e.g. "orders" -> POST {url}/orders/{id}) */
	router: string;
	/** Headers sent with every request (auth tokens, etc.) */
	headers?: Record<string, string> | (() => Record<string, string>);
}

export function httpCommandTransport(options: HttpCommandOptions): CommandTransport {
	const { url, router, headers } = options;

	return {
		async dispatch(workflowId, command) {
			const resolvedHeaders = typeof headers === "function" ? headers() : (headers ?? {});

			let response: Response;
			try {
				response = await fetch(`${url}/${router}/${workflowId}`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...resolvedHeaders,
					},
					body: JSON.stringify(command),
				});
			} catch (err) {
				const transportError: TransportError = {
					category: "transport",
					code: "NETWORK",
					message: err instanceof Error ? err.message : "Network request failed",
					cause: err,
				};
				return { ok: false, error: transportError };
			}

			let body: unknown;
			try {
				body = await response.json();
			} catch {
				const transportError: TransportError = {
					category: "transport",
					code: "PARSE",
					message: `Failed to parse response (status ${response.status})`,
				};
				return { ok: false, error: transportError };
			}

			return body as CommandResult;
		},
	};
}
