import { WorkflowRouter } from "@rytejs/core";
import { onboardingWorkflow } from "./definition.ts";
import { createMockDeps, type OnboardingDeps } from "./deps.ts";

export function createOnboardingRouter() {
	const auditLog: { command: string; state: string }[] = [];
	const deps: OnboardingDeps = createMockDeps();

	const router = new WorkflowRouter(onboardingWorkflow, deps);

	// Global audit middleware
	router.use(async ({ command, workflow }, next) => {
		auditLog.push({ command: command.type, state: workflow.state });
		await next();
	});

	// Started: user submits identity documents
	router.state("Started", ({ on }) => {
		on("SubmitIdentity", async ({ data, command, deps, transition, emit, workflow }) => {
			const callbackUrl = deps.callbackRegistry.registerCallback(workflow.id, "identity");
			const { requestId } = await deps.identityProvider.requestVerification(
				data.email,
				command.payload.documentUrl,
				callbackUrl,
			);
			transition("IdentityPending", {
				email: data.email,
				fullName: data.fullName,
				identityRequestId: requestId,
			});
			emit("IdentityCheckRequested", { email: data.email, identityRequestId: requestId });
		});
	});

	// IdentityPending: webhook callback from identity provider
	router.state("IdentityPending", ({ on }) => {
		on("ReceiveIdentityResult", ({ data, command, transition, emit }) => {
			if (command.payload.success) {
				const verifiedAt = new Date();
				transition("IdentityVerified", {
					email: data.email,
					fullName: data.fullName,
					identityRequestId: data.identityRequestId,
					verifiedAt,
				});
				emit("IdentityVerified", { email: data.email, verifiedAt });
			} else {
				const reason = command.payload.reason ?? "unknown";
				transition("IdentityFailed", {
					email: data.email,
					fullName: data.fullName,
					identityRequestId: data.identityRequestId,
					failureReason: reason,
				});
				emit("IdentityFailed", { email: data.email, reason });
			}
		});
	});

	// IdentityVerified: initiate bank verification or reject duplicate identity callback
	router.state("IdentityVerified", ({ on }) => {
		on("InitiateBankVerification", async ({ data, command, deps, transition, emit, workflow }) => {
			const callbackUrl = deps.callbackRegistry.registerCallback(workflow.id, "bank");
			const { depositId } = await deps.bankingService.initiateMicroDeposit(
				command.payload.bankAccountId,
				callbackUrl,
			);
			transition("BankVerificationPending", {
				email: data.email,
				fullName: data.fullName,
				identityRequestId: data.identityRequestId,
				verifiedAt: data.verifiedAt,
				bankAccountId: command.payload.bankAccountId,
				microDepositId: depositId,
			});
			emit("MicroDepositInitiated", {
				email: data.email,
				bankAccountId: command.payload.bankAccountId,
				microDepositId: depositId,
			});
		});

		on("ReceiveIdentityResult", ({ error }) => {
			error("AlreadyVerified", {});
		});
	});

	// BankVerificationPending: webhook callback from bank
	router.state("BankVerificationPending", ({ on }) => {
		on("ReceiveBankResult", ({ data, command, transition, emit }) => {
			if (command.payload.success) {
				const bankVerifiedAt = new Date();
				transition("BankVerified", {
					email: data.email,
					fullName: data.fullName,
					identityRequestId: data.identityRequestId,
					verifiedAt: data.verifiedAt,
					bankAccountId: data.bankAccountId,
					microDepositId: data.microDepositId,
					bankVerifiedAt,
				});
				emit("BankVerified", {
					email: data.email,
					bankAccountId: data.bankAccountId,
				});
			} else {
				const reason = command.payload.reason ?? "unknown";
				transition("BankFailed", {
					email: data.email,
					fullName: data.fullName,
					identityRequestId: data.identityRequestId,
					verifiedAt: data.verifiedAt,
					bankAccountId: data.bankAccountId,
					failureReason: reason,
				});
				emit("BankFailed", { email: data.email, reason });
			}
		});
	});

	// BankVerified: submit for backoffice review
	router.state("BankVerified", ({ on }) => {
		on("SubmitForReview", ({ data, transition, emit }) => {
			const reviewRequestedAt = new Date();
			transition("BackofficeReview", {
				email: data.email,
				fullName: data.fullName,
				identityRequestId: data.identityRequestId,
				verifiedAt: data.verifiedAt,
				bankAccountId: data.bankAccountId,
				microDepositId: data.microDepositId,
				bankVerifiedAt: data.bankVerifiedAt,
				reviewRequestedAt,
			});
			emit("BackofficeReviewRequested", { email: data.email, reviewRequestedAt });
		});
	});

	// BackofficeReview: approve or reject
	router.state("BackofficeReview", ({ on }) => {
		on("ApproveOnboarding", ({ data, command, transition, emit }) => {
			const approvedAt = new Date();
			transition("Approved", {
				email: data.email,
				fullName: data.fullName,
				identityRequestId: data.identityRequestId,
				verifiedAt: data.verifiedAt,
				bankAccountId: data.bankAccountId,
				microDepositId: data.microDepositId,
				bankVerifiedAt: data.bankVerifiedAt,
				reviewRequestedAt: data.reviewRequestedAt,
				approvedBy: command.payload.approvedBy,
				approvedAt,
			});
			emit("OnboardingApproved", {
				email: data.email,
				approvedBy: command.payload.approvedBy,
			});
			emit("WelcomeEmailSent", { email: data.email });
		});

		on("RejectOnboarding", ({ data, command, transition, emit }) => {
			transition("Rejected", {
				email: data.email,
				fullName: data.fullName,
				identityRequestId: data.identityRequestId,
				verifiedAt: data.verifiedAt,
				bankAccountId: data.bankAccountId,
				microDepositId: data.microDepositId,
				bankVerifiedAt: data.bankVerifiedAt,
				rejectedBy: command.payload.rejectedBy,
				rejectionReason: command.payload.reason,
			});
			emit("OnboardingRejected", {
				email: data.email,
				rejectedBy: command.payload.rejectedBy,
				reason: command.payload.reason,
			});
		});
	});

	// Approved: activate account
	router.state("Approved", ({ on }) => {
		on("ActivateAccount", ({ data, transition, emit }) => {
			const activatedAt = new Date();
			transition("Active", {
				email: data.email,
				fullName: data.fullName,
				identityRequestId: data.identityRequestId,
				verifiedAt: data.verifiedAt,
				bankAccountId: data.bankAccountId,
				microDepositId: data.microDepositId,
				bankVerifiedAt: data.bankVerifiedAt,
				reviewRequestedAt: data.reviewRequestedAt,
				approvedBy: data.approvedBy,
				approvedAt: data.approvedAt,
				activatedAt,
			});
			emit("AccountActivated", { email: data.email, activatedAt });
		});
	});

	return { router, deps, auditLog };
}
