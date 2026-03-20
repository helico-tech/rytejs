import type { SubscriberRegistry } from "../../executor/types.js";

export function handleSSE(req: Request, subscribers: SubscriberRegistry): Response {
	const url = new URL(req.url);
	const id = url.pathname.split("/").filter(Boolean).pop() ?? "";

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const unsubscribe = subscribers.subscribe(id, (message) => {
				const data = JSON.stringify(message);
				controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));
			});

			req.signal?.addEventListener("abort", () => {
				unsubscribe();
				controller.close();
			});
		},
	});

	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
