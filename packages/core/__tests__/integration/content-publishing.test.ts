import { describe, expect, test } from "vitest";
import { z } from "zod";
import { defineWorkflow, WorkflowRouter } from "../../src/index.js";

const publishWorkflow = defineWorkflow("content", {
	states: {
		draft: z.object({ title: z.string(), body: z.string().optional() }),
		review: z.object({ title: z.string(), body: z.string(), reviewerId: z.string() }),
		published: z.object({ title: z.string(), body: z.string(), publishedAt: z.coerce.date() }),
		rejected: z.object({ title: z.string(), body: z.string(), reason: z.string() }),
	},
	commands: {
		updateDraft: z.object({ title: z.string().optional(), body: z.string().optional() }),
		submitForReview: z.object({ reviewerId: z.string() }),
		approve: z.object({}),
		reject: z.object({ reason: z.string() }),
		revise: z.object({}),
	},
	events: {
		DraftUpdated: z.object({ contentId: z.string() }),
		SubmittedForReview: z.object({ contentId: z.string(), reviewerId: z.string() }),
		Approved: z.object({ contentId: z.string() }),
		Rejected: z.object({ contentId: z.string(), reason: z.string() }),
		Revised: z.object({ contentId: z.string() }),
	},
	errors: {
		bodyRequired: z.object({}),
		notReviewer: z.object({ expected: z.string() }),
	},
});

type ReviewService = { canApprove(reviewerId: string): boolean };

describe("Content Publishing Integration", () => {
	function createRouter(reviewService: ReviewService) {
		const router = new WorkflowRouter(publishWorkflow, { reviewService });

		router.state("draft", (state) => {
			state.on("updateDraft", (ctx) => {
				const updates: Record<string, unknown> = {};
				if (ctx.command.payload.title) updates.title = ctx.command.payload.title;
				if (ctx.command.payload.body) updates.body = ctx.command.payload.body;
				ctx.update(updates);
				ctx.emit({ type: "DraftUpdated", data: { contentId: ctx.workflow.id } });
			});

			state.on("submitForReview", (ctx) => {
				if (!ctx.data.body) {
					ctx.error({ code: "bodyRequired", data: {} });
				}
				ctx.transition("review", {
					title: ctx.data.title,
					body: ctx.data.body!,
					reviewerId: ctx.command.payload.reviewerId,
				});
				ctx.emit({
					type: "SubmittedForReview",
					data: { contentId: ctx.workflow.id, reviewerId: ctx.command.payload.reviewerId },
				});
			});
		});

		router.state("review", (state) => {
			state.on("approve", (ctx) => {
				if (!ctx.deps.reviewService.canApprove(ctx.data.reviewerId)) {
					ctx.error({ code: "notReviewer", data: { expected: ctx.data.reviewerId } });
				}
				ctx.transition("published", {
					title: ctx.data.title,
					body: ctx.data.body,
					publishedAt: new Date(),
				});
				ctx.emit({ type: "Approved", data: { contentId: ctx.workflow.id } });
			});

			state.on("reject", (ctx) => {
				ctx.transition("rejected", {
					title: ctx.data.title,
					body: ctx.data.body,
					reason: ctx.command.payload.reason,
				});
				ctx.emit({
					type: "Rejected",
					data: { contentId: ctx.workflow.id, reason: ctx.command.payload.reason },
				});
			});
		});

		router.state("rejected", (state) => {
			state.on("revise", (ctx) => {
				ctx.transition("draft", {
					title: ctx.data.title,
					body: ctx.data.body,
				});
				ctx.emit({ type: "Revised", data: { contentId: ctx.workflow.id } });
			});
		});

		return router;
	}

	test("happy path: draft → review → published", async () => {
		const router = createRouter({ canApprove: () => true });
		let wf = publishWorkflow.createWorkflow("post-1", {
			initialState: "draft",
			data: { title: "Hello World" },
		});

		let result = await router.dispatch(wf, {
			type: "updateDraft",
			payload: { body: "Content here" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		wf = result.workflow as any;

		result = await router.dispatch(wf, {
			type: "submitForReview",
			payload: { reviewerId: "reviewer-1" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("review");
		wf = result.workflow as any;

		result = await router.dispatch(wf, { type: "approve", payload: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("published");
	});

	test("rejection and revision cycle", async () => {
		const router = createRouter({ canApprove: () => true });
		let wf = publishWorkflow.createWorkflow("post-2", {
			initialState: "draft",
			data: { title: "Draft", body: "Initial" },
		});

		let result = await router.dispatch(wf, {
			type: "submitForReview",
			payload: { reviewerId: "r1" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		wf = result.workflow as any;

		result = await router.dispatch(wf, {
			type: "reject",
			payload: { reason: "needs work" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("rejected");
		wf = result.workflow as any;

		result = await router.dispatch(wf, { type: "revise", payload: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("draft");
	});

	test("dependency injection: review service blocks unauthorized approval", async () => {
		const router = createRouter({ canApprove: () => false });
		let wf = publishWorkflow.createWorkflow("post-3", {
			initialState: "draft",
			data: { title: "T", body: "B" },
		});

		let result = await router.dispatch(wf, {
			type: "submitForReview",
			payload: { reviewerId: "r1" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		wf = result.workflow as any;

		result = await router.dispatch(wf, { type: "approve", payload: {} });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("notReviewer");
		}
	});

	test("event accumulation is per-dispatch", async () => {
		const router = createRouter({ canApprove: () => true });
		const wf = publishWorkflow.createWorkflow("post-4", {
			initialState: "draft",
			data: { title: "T", body: "B" },
		});

		const r1 = await router.dispatch(wf, {
			type: "submitForReview",
			payload: { reviewerId: "r1" },
		});
		expect(r1.ok).toBe(true);
		if (!r1.ok) throw new Error();
		expect(r1.events).toHaveLength(1);
		expect(r1.events[0]?.type).toBe("SubmittedForReview");

		const r2 = await router.dispatch(r1.workflow as any, {
			type: "approve",
			payload: {},
		});
		expect(r2.ok).toBe(true);
		if (!r2.ok) throw new Error();
		expect(r2.events).toHaveLength(1);
		expect(r2.events[0]?.type).toBe("Approved");
	});
});
