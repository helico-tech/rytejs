import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";

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

// ─── Dependencies & router factory ──────────────────────────────────

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

// ─── Tests ──────────────────────────────────────────────────────────

describe("onboarding workflow", () => {
	test("happy path: full onboarding to active", async () => {
		const { router, deps, auditLog } = createOnboardingRouter();

		const wf = onboardingWorkflow.createWorkflow("onb-1", {
			initialState: "Started",
			data: { email: "alice@example.com", fullName: "Alice Smith" },
		});

		// 1. Submit identity documents
		let result = await router.dispatch(wf, {
			type: "SubmitIdentity",
			payload: { documentUrl: "https://docs.example.com/passport.pdf" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("IdentityPending");
		if (result.workflow.state === "IdentityPending") {
			expect(result.workflow.data.identityRequestId).toBe("id-req-001");
		}
		expect(result.events[0]?.type).toBe("IdentityCheckRequested");

		// 2. Identity provider calls back with success
		result = await router.dispatch(result.workflow, {
			type: "ReceiveIdentityResult",
			payload: { success: true },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("IdentityVerified");
		expect(result.events[0]?.type).toBe("IdentityVerified");

		// 3. Initiate bank verification
		result = await router.dispatch(result.workflow, {
			type: "InitiateBankVerification",
			payload: { bankAccountId: "ACC-123" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("BankVerificationPending");
		if (result.workflow.state === "BankVerificationPending") {
			expect(result.workflow.data.bankAccountId).toBe("ACC-123");
			expect(result.workflow.data.microDepositId).toBe("dep-001");
		}
		expect(result.events[0]?.type).toBe("MicroDepositInitiated");

		// 4. Bank calls back with success
		result = await router.dispatch(result.workflow, {
			type: "ReceiveBankResult",
			payload: { success: true },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("BankVerified");
		expect(result.events[0]?.type).toBe("BankVerified");

		// 5. Submit for backoffice review
		result = await router.dispatch(result.workflow, {
			type: "SubmitForReview",
			payload: {},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("BackofficeReview");
		expect(result.events[0]?.type).toBe("BackofficeReviewRequested");

		// 6. Backoffice approves
		result = await router.dispatch(result.workflow, {
			type: "ApproveOnboarding",
			payload: { approvedBy: "admin@company.com" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Approved");
		expect(result.events.map((e) => e.type)).toEqual(["OnboardingApproved", "WelcomeEmailSent"]);

		// 7. Activate account
		result = await router.dispatch(result.workflow, {
			type: "ActivateAccount",
			payload: {},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Active");
		expect(result.events[0]?.type).toBe("AccountActivated");

		// Verify final data has all accumulated fields
		if (result.workflow.state === "Active") {
			expect(result.workflow.data.email).toBe("alice@example.com");
			expect(result.workflow.data.fullName).toBe("Alice Smith");
			expect(result.workflow.data.identityRequestId).toBe("id-req-001");
			expect(result.workflow.data.bankAccountId).toBe("ACC-123");
			expect(result.workflow.data.microDepositId).toBe("dep-001");
			expect(result.workflow.data.approvedBy).toBe("admin@company.com");
			expect(result.workflow.data.verifiedAt).toBeInstanceOf(Date);
			expect(result.workflow.data.bankVerifiedAt).toBeInstanceOf(Date);
			expect(result.workflow.data.reviewRequestedAt).toBeInstanceOf(Date);
			expect(result.workflow.data.approvedAt).toBeInstanceOf(Date);
			expect(result.workflow.data.activatedAt).toBeInstanceOf(Date);
		}

		// Verify mocks were called with correct callback URLs
		expect(deps.identityProvider.requestVerification).toHaveBeenCalledWith(
			"alice@example.com",
			"https://docs.example.com/passport.pdf",
			"https://api.example.com/callbacks/identity-001",
		);
		expect(deps.bankingService.initiateMicroDeposit).toHaveBeenCalledWith(
			"ACC-123",
			"https://api.example.com/callbacks/bank-001",
		);
		expect(deps.callbackRegistry.registerCallback).toHaveBeenCalledTimes(2);

		// Verify audit log captured full command sequence
		expect(auditLog).toEqual([
			{ command: "SubmitIdentity", state: "Started" },
			{ command: "ReceiveIdentityResult", state: "IdentityPending" },
			{ command: "InitiateBankVerification", state: "IdentityVerified" },
			{ command: "ReceiveBankResult", state: "BankVerificationPending" },
			{ command: "SubmitForReview", state: "BankVerified" },
			{ command: "ApproveOnboarding", state: "BackofficeReview" },
			{ command: "ActivateAccount", state: "Approved" },
		]);
	});

	test("identity verification fails", async () => {
		const { router, deps } = createOnboardingRouter();

		const wf = onboardingWorkflow.createWorkflow("onb-2", {
			initialState: "Started",
			data: { email: "bob@example.com", fullName: "Bob Jones" },
		});

		let result = await router.dispatch(wf, {
			type: "SubmitIdentity",
			payload: { documentUrl: "https://docs.example.com/id.pdf" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "ReceiveIdentityResult",
			payload: { success: false, reason: "document_expired" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("IdentityFailed");
		expect(result.events[0]?.type).toBe("IdentityFailed");
		expect(result.events[0]?.data).toEqual(expect.objectContaining({ reason: "document_expired" }));
		if (result.workflow.state === "IdentityFailed") {
			expect(result.workflow.data.failureReason).toBe("document_expired");
		}

		expect(deps.identityProvider.requestVerification).toHaveBeenCalledOnce();
		expect(deps.bankingService.initiateMicroDeposit).not.toHaveBeenCalled();
	});

	test("bank verification fails", async () => {
		const { router, deps } = createOnboardingRouter();

		const wf = onboardingWorkflow.createWorkflow("onb-3", {
			initialState: "Started",
			data: { email: "carol@example.com", fullName: "Carol White" },
		});

		let result = await router.dispatch(wf, {
			type: "SubmitIdentity",
			payload: { documentUrl: "https://docs.example.com/id.pdf" },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "ReceiveIdentityResult",
			payload: { success: true },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "InitiateBankVerification",
			payload: { bankAccountId: "ACC-BAD" },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "ReceiveBankResult",
			payload: { success: false, reason: "account_closed" },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("BankFailed");
		expect(result.events[0]?.type).toBe("BankFailed");
		expect(result.events[0]?.data).toEqual(expect.objectContaining({ reason: "account_closed" }));
		if (result.workflow.state === "BankFailed") {
			expect(result.workflow.data.failureReason).toBe("account_closed");
		}

		expect(deps.bankingService.initiateMicroDeposit).toHaveBeenCalledWith(
			"ACC-BAD",
			"https://api.example.com/callbacks/bank-001",
		);
	});

	test("backoffice rejects onboarding", async () => {
		const { router } = createOnboardingRouter();

		const wf = onboardingWorkflow.createWorkflow("onb-4", {
			initialState: "Started",
			data: { email: "dave@example.com", fullName: "Dave Brown" },
		});

		let result = await router.dispatch(wf, {
			type: "SubmitIdentity",
			payload: { documentUrl: "https://docs.example.com/id.pdf" },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "ReceiveIdentityResult",
			payload: { success: true },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "InitiateBankVerification",
			payload: { bankAccountId: "ACC-456" },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "ReceiveBankResult",
			payload: { success: true },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "SubmitForReview",
			payload: {},
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "RejectOnboarding",
			payload: {
				rejectedBy: "compliance@company.com",
				reason: "suspicious activity",
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("Rejected");
		expect(result.events[0]?.type).toBe("OnboardingRejected");
		expect(result.events[0]?.data).toEqual(
			expect.objectContaining({
				rejectedBy: "compliance@company.com",
				reason: "suspicious activity",
			}),
		);
		if (result.workflow.state === "Rejected") {
			expect(result.workflow.data.rejectedBy).toBe("compliance@company.com");
			expect(result.workflow.data.rejectionReason).toBe("suspicious activity");
		}
	});

	test("domain error: duplicate identity verification attempt", async () => {
		const { router } = createOnboardingRouter();

		const wf = onboardingWorkflow.createWorkflow("onb-5", {
			initialState: "Started",
			data: { email: "eve@example.com", fullName: "Eve Green" },
		});

		let result = await router.dispatch(wf, {
			type: "SubmitIdentity",
			payload: { documentUrl: "https://docs.example.com/id.pdf" },
		});
		if (!result.ok) throw new Error();

		result = await router.dispatch(result.workflow, {
			type: "ReceiveIdentityResult",
			payload: { success: true },
		});
		if (!result.ok) throw new Error();
		expect(result.workflow.state).toBe("IdentityVerified");

		// Keep reference for rollback check
		const verifiedWf = result.workflow;

		// Duplicate webhook arrives
		result = await router.dispatch(verifiedWf, {
			type: "ReceiveIdentityResult",
			payload: { success: true },
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("domain");
		if (result.error.category === "domain") {
			expect(result.error.code).toBe("AlreadyVerified");
		}

		// Workflow unchanged (rollback)
		expect(verifiedWf.state).toBe("IdentityVerified");
	});

	test("validation error: bad document URL in SubmitIdentity", async () => {
		const { router } = createOnboardingRouter();

		const wf = onboardingWorkflow.createWorkflow("onb-6", {
			initialState: "Started",
			data: { email: "frank@example.com", fullName: "Frank Black" },
		});

		const result = await router.dispatch(wf, {
			type: "SubmitIdentity",
			payload: { documentUrl: "not-a-url" },
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.error.category).toBe("validation");
		if (result.error.category === "validation") {
			expect(result.error.source).toBe("command");
		}

		expect(wf.state).toBe("Started");
	});
});
