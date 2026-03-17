import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { WorkerReactors } from "../src/reactors.js";

const orderWorkflow = defineWorkflow("order", {
	states: {
		Placed: z.object({ item: z.string() }),
		Paid: z.object({ item: z.string() }),
	},
	commands: { Pay: z.object({}) },
	events: { OrderPaid: z.object({ shipmentId: z.string() }) },
	errors: {},
});

const shipmentWorkflow = defineWorkflow("shipment", {
	states: {
		Pending: z.object({}),
		Preparing: z.object({ orderId: z.string() }),
	},
	commands: { StartFulfillment: z.object({ orderId: z.string() }) },
	events: {},
	errors: {},
});

const orderRouter = new WorkflowRouter(orderWorkflow);
const shipmentRouter = new WorkflowRouter(shipmentWorkflow);

describe("WorkerReactors", () => {
	test("resolves events into commands", () => {
		const reactors = new WorkerReactors();
		reactors.on(orderRouter, "OrderPaid", ({ event, workflowId }) => ({
			workflowId: event.data.shipmentId,
			router: shipmentRouter,
			command: {
				type: "StartFulfillment",
				payload: { orderId: workflowId },
			},
		}));

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);

		expect(commands).toHaveLength(1);
		expect(commands[0]).toEqual({
			workflowId: "ship-1",
			routerName: "shipment",
			type: "StartFulfillment",
			payload: { orderId: "order-1" },
		});
	});

	test("returns empty array when no reactors match", () => {
		const reactors = new WorkerReactors();
		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);
		expect(commands).toEqual([]);
	});

	test("handler returning null skips", () => {
		const reactors = new WorkerReactors();
		reactors.on(orderRouter, "OrderPaid", () => null);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);
		expect(commands).toEqual([]);
	});

	test("handler returning array produces multiple commands", () => {
		const reactors = new WorkerReactors();
		reactors.on(orderRouter, "OrderPaid", ({ event, workflowId }) => [
			{
				workflowId: event.data.shipmentId,
				router: shipmentRouter,
				command: {
					type: "StartFulfillment",
					payload: { orderId: workflowId },
				},
			},
		]);

		const commands = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPaid", data: { shipmentId: "ship-1" } },
		]);
		expect(commands).toHaveLength(1);
	});
});
