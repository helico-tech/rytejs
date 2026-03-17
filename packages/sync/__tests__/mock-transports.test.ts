import { describe, expect, test, vi } from "vitest";
import { mockCommandTransport } from "../src/testing/mock-command.js";
import { mockUpdateTransport } from "../src/testing/mock-update.js";
import type { CommandResult, UpdateMessage } from "../src/types.js";

describe("mockCommandTransport", () => {
	test("calls handler with workflowId and command", async () => {
		const result: CommandResult = { ok: true, snapshot: {} as never, version: 1 };
		const handler = vi.fn().mockReturnValue(result);
		const transport = mockCommandTransport(handler);

		const actual = await transport.dispatch("wf-1", { type: "Submit", payload: { x: 1 } });

		expect(handler).toHaveBeenCalledWith("wf-1", { type: "Submit", payload: { x: 1 } });
		expect(actual).toBe(result);
	});

	test("handler can return async results", async () => {
		const result: CommandResult = {
			ok: false,
			error: { category: "transport", code: "NETWORK", message: "fail" },
		};
		const handler = vi.fn().mockResolvedValue(result);
		const transport = mockCommandTransport(handler);

		const actual = await transport.dispatch("wf-1", { type: "Submit", payload: {} });
		expect(actual).toBe(result);
	});
});

describe("mockUpdateTransport", () => {
	test("subscribe returns a subscription", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		const sub = mock.subscribe("wf-1", listener);
		expect(sub).toHaveProperty("unsubscribe");
	});

	test("push delivers message to matching subscribers", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);

		const message: UpdateMessage = { snapshot: {} as never, version: 1 };
		mock.push("wf-1", message);

		expect(listener).toHaveBeenCalledWith(message);
	});

	test("push does not deliver to unsubscribed listeners", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		const sub = mock.subscribe("wf-1", listener);
		sub.unsubscribe();

		mock.push("wf-1", { snapshot: {} as never, version: 1 });
		expect(listener).not.toHaveBeenCalled();
	});

	test("push does not deliver to other workflow IDs", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);

		mock.push("wf-2", { snapshot: {} as never, version: 1 });
		expect(listener).not.toHaveBeenCalled();
	});

	test("disconnect stops all deliveries", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);
		mock.disconnect();

		mock.push("wf-1", { snapshot: {} as never, version: 1 });
		expect(listener).not.toHaveBeenCalled();
	});

	test("reconnect resumes deliveries", () => {
		const mock = mockUpdateTransport();
		const listener = vi.fn();
		mock.subscribe("wf-1", listener);
		mock.disconnect();
		mock.reconnect();

		const message: UpdateMessage = { snapshot: {} as never, version: 1 };
		mock.push("wf-1", message);
		expect(listener).toHaveBeenCalledWith(message);
	});
});
