import { describe, expect, test, vi } from "vitest";
import { composeSyncTransport } from "../src/compose.js";
import type { CommandResult, CommandTransport, UpdateTransport } from "../src/types.js";

describe("composeSyncTransport", () => {
	test("delegates dispatch to command transport", async () => {
		const result: CommandResult = {
			ok: true,
			snapshot: {} as never,
			version: 1,
		};
		const commands: CommandTransport = {
			dispatch: vi.fn().mockResolvedValue(result),
		};
		const updates: UpdateTransport = {
			subscribe: vi.fn(),
		};

		const transport = composeSyncTransport({ commands, updates });
		const actual = await transport.dispatch("wf-1", { type: "Submit", payload: {} });

		expect(commands.dispatch).toHaveBeenCalledWith("wf-1", { type: "Submit", payload: {} });
		expect(actual).toBe(result);
	});

	test("delegates subscribe to update transport", () => {
		const unsub = { unsubscribe: vi.fn() };
		const commands: CommandTransport = {
			dispatch: vi.fn(),
		};
		const updates: UpdateTransport = {
			subscribe: vi.fn().mockReturnValue(unsub),
		};

		const transport = composeSyncTransport({ commands, updates });
		const listener = vi.fn();
		const sub = transport.subscribe("wf-1", listener);

		expect(updates.subscribe).toHaveBeenCalledWith("wf-1", listener);
		expect(sub).toBe(unsub);
	});
});
