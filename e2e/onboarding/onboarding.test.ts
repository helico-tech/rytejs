import { describe, expect, test } from "vitest";
import { onboardingWorkflow } from "./definition.ts";
import { createOnboardingRouter } from "./router.ts";

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
