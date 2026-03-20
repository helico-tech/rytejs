import type { StoreAdapter } from "../../engine/types.js";

export async function handlePolling(req: Request, store: StoreAdapter): Promise<Response> {
	const url = new URL(req.url);
	const id = url.pathname.split("/").filter(Boolean).pop() ?? "";

	const stored = await store.load(id);
	if (!stored) {
		return Response.json(
			{
				error: {
					category: "transport",
					code: "NOT_FOUND",
					message: `Workflow "${id}" not found`,
				},
			},
			{ status: 404 },
		);
	}

	return Response.json({
		snapshot: stored.snapshot,
		version: stored.version,
	});
}
