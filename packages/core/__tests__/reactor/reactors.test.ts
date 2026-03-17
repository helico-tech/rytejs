import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow } from "../../src/definition.js";
import { createReactors } from "../../src/reactor/reactors.js";
import { WorkflowRouter } from "../../src/router.js";

const orderWorkflow = defineWorkflow("order", {
	states: {
		Draft: z.object({ items: z.string().array() }),
		Placed: z.object({ items: z.string().array(), placedAt: z.coerce.date() }),
	},
	commands: { Place: z.object({}) },
	events: {
		OrderPlaced: z.object({ orderId: z.string(), shipmentId: z.string() }),
		InventoryReserved: z.object({ orderId: z.string() }),
	},
	errors: {},
});
const orderRouter = new WorkflowRouter(orderWorkflow);

const invoiceWorkflow = defineWorkflow("invoice", {
	states: {
		Pending: z.object({ amount: z.number() }),
	},
	commands: { Pay: z.object({}) },
	events: {
		InvoicePaid: z.object({ invoiceId: z.string() }),
	},
	errors: {},
});
const invoiceRouter = new WorkflowRouter(invoiceWorkflow);

describe("Reactors", () => {
	test("resolve returns empty array when no reactors match", () => {
		const reactors = createReactors();
		const result = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);
		expect(result).toEqual([]);
	});

	test("resolve returns command for matching event", () => {
		const reactors = createReactors().on(orderRouter, "OrderPlaced", (ctx) => ({
			workflowId: ctx.event.data.shipmentId,
			routerName: "shipment",
			command: { type: "Prepare", payload: { orderId: ctx.event.data.orderId } },
		}));

		const result = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(result).toEqual([
			{
				workflowId: "ship-1",
				routerName: "shipment",
				command: { type: "Prepare", payload: { orderId: "order-1" } },
			},
		]);
	});

	test("resolve handles multiple events", () => {
		const reactors = createReactors()
			.on(orderRouter, "OrderPlaced", (ctx) => ({
				workflowId: ctx.event.data.shipmentId,
				routerName: "shipment",
				command: { type: "Prepare", payload: {} },
			}))
			.on(orderRouter, "InventoryReserved", (ctx) => ({
				workflowId: ctx.event.data.orderId,
				routerName: "order",
				command: { type: "Confirm", payload: {} },
			}));

		const result = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
			{ type: "InventoryReserved", data: { orderId: "order-1" } },
		]);

		expect(result).toHaveLength(2);
		expect(result[0].routerName).toBe("shipment");
		expect(result[1].routerName).toBe("order");
	});

	test("resolve handles handler returning array", () => {
		const reactors = createReactors().on(orderRouter, "OrderPlaced", (ctx) => [
			{
				workflowId: ctx.event.data.shipmentId,
				routerName: "shipment",
				command: { type: "Prepare", payload: {} },
			},
			{
				workflowId: ctx.event.data.orderId,
				routerName: "notification",
				command: { type: "Send", payload: {} },
			},
		]);

		const result = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(result).toHaveLength(2);
		expect(result[0].routerName).toBe("shipment");
		expect(result[1].routerName).toBe("notification");
	});

	test("resolve handles handler returning null", () => {
		const reactors = createReactors().on(orderRouter, "OrderPlaced", () => null);

		const result = reactors.resolve(orderRouter, "order-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(result).toEqual([]);
	});

	test("resolve ignores events from different routers", () => {
		const reactors = createReactors().on(orderRouter, "OrderPlaced", (ctx) => ({
			workflowId: ctx.event.data.shipmentId,
			routerName: "shipment",
			command: { type: "Prepare", payload: {} },
		}));

		const result = reactors.resolve(invoiceRouter, "invoice-1", [
			{ type: "OrderPlaced", data: { orderId: "order-1", shipmentId: "ship-1" } },
		]);

		expect(result).toEqual([]);
	});

	test("on() is chainable", () => {
		const reactors = createReactors();
		const result = reactors
			.on(orderRouter, "OrderPlaced", () => null)
			.on(orderRouter, "InventoryReserved", () => null);

		expect(result).toBe(reactors);
	});
});
