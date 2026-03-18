export async function routeToDO(
	request: Request,
	env: Record<string, DurableObjectNamespace>,
	binding: string,
): Promise<Response> {
	const url = new URL(request.url);
	const segments = url.pathname.split("/").filter(Boolean);

	if (segments.length < 2) {
		return new Response(
			JSON.stringify({
				ok: false,
				error: {
					category: "router",
					message: "Invalid URL: expected /:routerName/:workflowId/...",
				},
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}

	const [routerName, workflowId, ...rest] = segments;
	const remainingPath = `/${rest.join("/")}`;
	const doId = env[binding].idFromName(`${routerName}:${workflowId}`);
	const stub = env[binding].get(doId);

	const forwardUrl = new URL(remainingPath, url.origin);
	forwardUrl.search = url.search;

	const headers = new Headers(request.headers);
	headers.set("X-Router-Name", routerName);
	headers.set("X-Workflow-Id", workflowId);

	const init: RequestInit = {
		method: request.method,
		headers,
		body: request.body,
	};
	// Node.js fetch requires `duplex: "half"` when forwarding a streaming body
	if (request.body) {
		(init as RequestInit & { duplex: string }).duplex = "half";
	}

	const forwardRequest = new Request(forwardUrl.toString(), init);

	return stub.fetch(forwardRequest);
}
