import { createKey, defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

// ─── Define a workflow ───────────────────────────────────────────────

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), assignee: z.string().optional() }),
		InProgress: z.object({
			title: z.string(),
			assignee: z.string(),
			startedAt: z.coerce.date(),
		}),
		Done: z.object({
			title: z.string(),
			assignee: z.string(),
			completedAt: z.coerce.date(),
		}),
	},
	commands: {
		Assign: z.object({ assignee: z.string() }),
		Start: z.object({}),
		Complete: z.object({}),
	},
	events: {
		TaskAssigned: z.object({ taskId: z.string(), assignee: z.string() }),
		TaskStarted: z.object({ taskId: z.string() }),
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotAssigned: z.object({}),
	},
});

// ─── Fluent router setup with composable routers ─────────────────────

const todoRouter = new WorkflowRouter(taskWorkflow).state("Todo", (state) => {
	state
		.on("Assign", (ctx) => {
			ctx.update({ assignee: ctx.command.payload.assignee });
			ctx.emit({
				type: "TaskAssigned",
				data: {
					taskId: ctx.workflow.id,
					assignee: ctx.command.payload.assignee,
				},
			});
		})
		.on("Start", (ctx) => {
			const { assignee } = ctx.data;
			if (!assignee) {
				ctx.error({ code: "NotAssigned", data: {} });
				return;
			}
			ctx.transition("InProgress", {
				title: ctx.data.title,
				assignee,
				startedAt: new Date(),
			});
			ctx.emit({ type: "TaskStarted", data: { taskId: ctx.workflow.id } });
		});
});

const inProgressRouter = new WorkflowRouter(taskWorkflow).state("InProgress", (state) => {
	state.on("Complete", (ctx) => {
		ctx.transition("Done", {
			title: ctx.data.title,
			assignee: ctx.data.assignee,
			completedAt: new Date(),
		});
		ctx.emit({
			type: "TaskCompleted",
			data: { taskId: ctx.workflow.id },
		});
	});
});

// Compose routers
const router = new WorkflowRouter(taskWorkflow).use(todoRouter).use(inProgressRouter);

// ─── Tests ──────────────────────────────────────────────────────────

describe("@rytejs/core E2E", () => {
	test("state transition: Todo → Todo (update)", async () => {
		const task = taskWorkflow.createWorkflow("task-1", {
			initialState: "Todo",
			data: { title: "Write docs" },
		});

		const result = await router.dispatch(task, {
			type: "Assign",
			payload: { assignee: "alice" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Todo");
		if (result.workflow.state === "Todo") {
			expect(result.workflow.data.assignee).toBe("alice");
		}
	});

	test("event emission", async () => {
		const task = taskWorkflow.createWorkflow("task-2", {
			initialState: "Todo",
			data: { title: "Ship it" },
		});

		const result = await router.dispatch(task, {
			type: "Assign",
			payload: { assignee: "bob" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.type).toBe("TaskAssigned");
	});

	test("domain error with rollback", async () => {
		const task = taskWorkflow.createWorkflow("task-3", {
			initialState: "Todo",
			data: { title: "No assignee" },
		});

		const result = await router.dispatch(task, {
			type: "Start",
			payload: {},
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("NotAssigned");
		}
		// Original workflow unchanged (rollback)
		expect(task.state).toBe("Todo");
	});

	test("full lifecycle: Todo → InProgress → Done", async () => {
		const task = taskWorkflow.createWorkflow("task-4", {
			initialState: "Todo",
			data: { title: "Full lifecycle", assignee: "alice" },
		});

		let result = await router.dispatch(task, {
			type: "Start",
			payload: {},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("InProgress");

		result = await router.dispatch(result.workflow, {
			type: "Complete",
			payload: {},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Done");
	});

	test("composable routers: handlers from child routers work", async () => {
		const task = taskWorkflow.createWorkflow("task-5", {
			initialState: "Todo",
			data: { title: "Composed" },
		});

		// Handler from todoRouter
		const r1 = await router.dispatch(task, {
			type: "Assign",
			payload: { assignee: "charlie" },
		});
		expect(r1.ok).toBe(true);

		// Handler from inProgressRouter
		const started = taskWorkflow.createWorkflow("task-6", {
			initialState: "InProgress",
			data: { title: "Started", assignee: "charlie", startedAt: new Date() },
		});
		const r2 = await router.dispatch(started, {
			type: "Complete",
			payload: {},
		});
		expect(r2.ok).toBe(true);
		if (r2.ok) expect(r2.workflow.state).toBe("Done");
	});

	test("context keys with middleware", async () => {
		const UserKey = createKey<string>("user");

		const authedRouter = new WorkflowRouter(taskWorkflow)
			.use(async (ctx, next) => {
				ctx.set(UserKey, "admin");
				await next();
			})
			.use(todoRouter);

		const task = taskWorkflow.createWorkflow("task-7", {
			initialState: "Todo",
			data: { title: "With middleware" },
		});

		const result = await authedRouter.dispatch(task, {
			type: "Assign",
			payload: { assignee: "dave" },
		});
		expect(result.ok).toBe(true);
	});
});

// ─── Onboarding workflow ────────────────────────────────────────────

const onboardingBase = z.object({
	email: z.string().email(),
	fullName: z.string(),
});

const withIdentityRequest = onboardingBase.extend({
	identityRequestId: z.string(),
});

const withIdentityVerified = withIdentityRequest.extend({
	verifiedAt: z.coerce.date(),
});

const withBankPending = withIdentityVerified.extend({
	bankAccountId: z.string(),
	microDepositId: z.string(),
});

const withBankVerified = withBankPending.extend({
	bankVerifiedAt: z.coerce.date(),
});

const withBackofficeReview = withBankVerified.extend({
	reviewRequestedAt: z.coerce.date(),
});

const withApproved = withBackofficeReview.extend({
	approvedBy: z.string(),
	approvedAt: z.coerce.date(),
});

const onboardingWorkflow = defineWorkflow("onboarding", {
	states: {
		Started: onboardingBase,
		IdentityPending: withIdentityRequest,
		IdentityVerified: withIdentityVerified,
		IdentityFailed: withIdentityRequest.extend({ failureReason: z.string() }),
		BankVerificationPending: withBankPending,
		BankVerified: withBankVerified,
		BankFailed: withIdentityVerified.extend({
			bankAccountId: z.string(),
			failureReason: z.string(),
		}),
		BackofficeReview: withBackofficeReview,
		Approved: withApproved,
		Rejected: withBankVerified.extend({
			rejectedBy: z.string(),
			rejectionReason: z.string(),
		}),
		Active: withApproved.extend({ activatedAt: z.coerce.date() }),
	},
	commands: {
		SubmitIdentity: z.object({ documentUrl: z.string().url() }),
		ReceiveIdentityResult: z.object({
			success: z.boolean(),
			reason: z.string().optional(),
		}),
		InitiateBankVerification: z.object({ bankAccountId: z.string() }),
		ReceiveBankResult: z.object({
			success: z.boolean(),
			reason: z.string().optional(),
		}),
		SubmitForReview: z.object({}),
		ApproveOnboarding: z.object({ approvedBy: z.string() }),
		RejectOnboarding: z.object({ rejectedBy: z.string(), reason: z.string() }),
		ActivateAccount: z.object({}),
	},
	events: {
		IdentityCheckRequested: z.object({
			email: z.string(),
			identityRequestId: z.string(),
		}),
		IdentityVerified: z.object({
			email: z.string(),
			verifiedAt: z.coerce.date(),
		}),
		IdentityFailed: z.object({ email: z.string(), reason: z.string() }),
		MicroDepositInitiated: z.object({
			email: z.string(),
			bankAccountId: z.string(),
			microDepositId: z.string(),
		}),
		BankVerified: z.object({ email: z.string(), bankAccountId: z.string() }),
		BankFailed: z.object({ email: z.string(), reason: z.string() }),
		BackofficeReviewRequested: z.object({
			email: z.string(),
			reviewRequestedAt: z.coerce.date(),
		}),
		OnboardingApproved: z.object({
			email: z.string(),
			approvedBy: z.string(),
		}),
		OnboardingRejected: z.object({
			email: z.string(),
			rejectedBy: z.string(),
			reason: z.string(),
		}),
		WelcomeEmailSent: z.object({ email: z.string() }),
		AccountActivated: z.object({
			email: z.string(),
			activatedAt: z.coerce.date(),
		}),
	},
	errors: {
		DocumentsInvalid: z.object({}),
		BankAccountInvalid: z.object({}),
		AlreadyVerified: z.object({}),
	},
});

type OnboardingDeps = {
	identityProvider: {
		requestVerification(
			email: string,
			documentUrl: string,
			callbackUrl: string,
		): Promise<{ requestId: string }>;
	};
	bankingService: {
		initiateMicroDeposit(
			bankAccountId: string,
			callbackUrl: string,
		): Promise<{ depositId: string }>;
	};
	callbackRegistry: {
		registerCallback(workflowId: string, type: string): string;
	};
};

function createOnboardingRouter() {
	const auditLog: { command: string; state: string }[] = [];

	const deps: OnboardingDeps = {
		identityProvider: {
			requestVerification: vi.fn().mockResolvedValue({ requestId: "id-req-001" }),
		},
		bankingService: {
			initiateMicroDeposit: vi.fn().mockResolvedValue({ depositId: "dep-001" }),
		},
		callbackRegistry: {
			registerCallback: vi
				.fn()
				.mockReturnValueOnce("https://api.example.com/callbacks/identity-001")
				.mockReturnValueOnce("https://api.example.com/callbacks/bank-001"),
		},
	};

	const router = new WorkflowRouter(onboardingWorkflow, deps);

	// Global audit middleware
	router.use(async (ctx, next) => {
		auditLog.push({ command: ctx.command.type, state: ctx.workflow.state });
		await next();
	});

	// Started: user submits identity documents
	router.state("Started", (state) => {
		state.on("SubmitIdentity", async (ctx) => {
			const callbackUrl = ctx.deps.callbackRegistry.registerCallback(ctx.workflow.id, "identity");
			const { requestId } = await ctx.deps.identityProvider.requestVerification(
				ctx.data.email,
				ctx.command.payload.documentUrl,
				callbackUrl,
			);
			ctx.transition("IdentityPending", {
				email: ctx.data.email,
				fullName: ctx.data.fullName,
				identityRequestId: requestId,
			});
			ctx.emit({
				type: "IdentityCheckRequested",
				data: { email: ctx.data.email, identityRequestId: requestId },
			});
		});
	});

	// IdentityPending: webhook callback from identity provider
	router.state("IdentityPending", (state) => {
		state.on("ReceiveIdentityResult", (ctx) => {
			if (ctx.command.payload.success) {
				const verifiedAt = new Date();
				ctx.transition("IdentityVerified", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					verifiedAt,
				});
				ctx.emit({
					type: "IdentityVerified",
					data: { email: ctx.data.email, verifiedAt },
				});
			} else {
				const reason = ctx.command.payload.reason ?? "unknown";
				ctx.transition("IdentityFailed", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					failureReason: reason,
				});
				ctx.emit({
					type: "IdentityFailed",
					data: { email: ctx.data.email, reason },
				});
			}
		});
	});

	// IdentityVerified: initiate bank verification or reject duplicate identity callback
	router.state("IdentityVerified", (state) => {
		state
			.on("InitiateBankVerification", async (ctx) => {
				const callbackUrl = ctx.deps.callbackRegistry.registerCallback(ctx.workflow.id, "bank");
				const { depositId } = await ctx.deps.bankingService.initiateMicroDeposit(
					ctx.command.payload.bankAccountId,
					callbackUrl,
				);
				ctx.transition("BankVerificationPending", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					verifiedAt: ctx.data.verifiedAt,
					bankAccountId: ctx.command.payload.bankAccountId,
					microDepositId: depositId,
				});
				ctx.emit({
					type: "MicroDepositInitiated",
					data: {
						email: ctx.data.email,
						bankAccountId: ctx.command.payload.bankAccountId,
						microDepositId: depositId,
					},
				});
			})
			.on("ReceiveIdentityResult", (ctx) => {
				ctx.error({ code: "AlreadyVerified", data: {} });
			});
	});

	// BankVerificationPending: webhook callback from bank
	router.state("BankVerificationPending", (state) => {
		state.on("ReceiveBankResult", (ctx) => {
			if (ctx.command.payload.success) {
				const bankVerifiedAt = new Date();
				ctx.transition("BankVerified", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					verifiedAt: ctx.data.verifiedAt,
					bankAccountId: ctx.data.bankAccountId,
					microDepositId: ctx.data.microDepositId,
					bankVerifiedAt,
				});
				ctx.emit({
					type: "BankVerified",
					data: {
						email: ctx.data.email,
						bankAccountId: ctx.data.bankAccountId,
					},
				});
			} else {
				const reason = ctx.command.payload.reason ?? "unknown";
				ctx.transition("BankFailed", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					verifiedAt: ctx.data.verifiedAt,
					bankAccountId: ctx.data.bankAccountId,
					failureReason: reason,
				});
				ctx.emit({
					type: "BankFailed",
					data: { email: ctx.data.email, reason },
				});
			}
		});
	});

	// BankVerified: submit for backoffice review
	router.state("BankVerified", (state) => {
		state.on("SubmitForReview", (ctx) => {
			const reviewRequestedAt = new Date();
			ctx.transition("BackofficeReview", {
				email: ctx.data.email,
				fullName: ctx.data.fullName,
				identityRequestId: ctx.data.identityRequestId,
				verifiedAt: ctx.data.verifiedAt,
				bankAccountId: ctx.data.bankAccountId,
				microDepositId: ctx.data.microDepositId,
				bankVerifiedAt: ctx.data.bankVerifiedAt,
				reviewRequestedAt,
			});
			ctx.emit({
				type: "BackofficeReviewRequested",
				data: { email: ctx.data.email, reviewRequestedAt },
			});
		});
	});

	// BackofficeReview: approve or reject
	router.state("BackofficeReview", (state) => {
		state
			.on("ApproveOnboarding", (ctx) => {
				const approvedAt = new Date();
				ctx.transition("Approved", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					verifiedAt: ctx.data.verifiedAt,
					bankAccountId: ctx.data.bankAccountId,
					microDepositId: ctx.data.microDepositId,
					bankVerifiedAt: ctx.data.bankVerifiedAt,
					reviewRequestedAt: ctx.data.reviewRequestedAt,
					approvedBy: ctx.command.payload.approvedBy,
					approvedAt,
				});
				ctx.emit({
					type: "OnboardingApproved",
					data: {
						email: ctx.data.email,
						approvedBy: ctx.command.payload.approvedBy,
					},
				});
				ctx.emit({
					type: "WelcomeEmailSent",
					data: { email: ctx.data.email },
				});
			})
			.on("RejectOnboarding", (ctx) => {
				ctx.transition("Rejected", {
					email: ctx.data.email,
					fullName: ctx.data.fullName,
					identityRequestId: ctx.data.identityRequestId,
					verifiedAt: ctx.data.verifiedAt,
					bankAccountId: ctx.data.bankAccountId,
					microDepositId: ctx.data.microDepositId,
					bankVerifiedAt: ctx.data.bankVerifiedAt,
					rejectedBy: ctx.command.payload.rejectedBy,
					rejectionReason: ctx.command.payload.reason,
				});
				ctx.emit({
					type: "OnboardingRejected",
					data: {
						email: ctx.data.email,
						rejectedBy: ctx.command.payload.rejectedBy,
						reason: ctx.command.payload.reason,
					},
				});
			});
	});

	// Approved: activate account
	router.state("Approved", (state) => {
		state.on("ActivateAccount", (ctx) => {
			const activatedAt = new Date();
			ctx.transition("Active", {
				email: ctx.data.email,
				fullName: ctx.data.fullName,
				identityRequestId: ctx.data.identityRequestId,
				verifiedAt: ctx.data.verifiedAt,
				bankAccountId: ctx.data.bankAccountId,
				microDepositId: ctx.data.microDepositId,
				bankVerifiedAt: ctx.data.bankVerifiedAt,
				reviewRequestedAt: ctx.data.reviewRequestedAt,
				approvedBy: ctx.data.approvedBy,
				approvedAt: ctx.data.approvedAt,
				activatedAt,
			});
			ctx.emit({
				type: "AccountActivated",
				data: { email: ctx.data.email, activatedAt },
			});
		});
	});

	return { router, deps, auditLog };
}
