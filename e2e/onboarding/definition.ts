import { defineWorkflow } from "@rytejs/core";
import { z } from "zod";

export const onboardingBase = z.object({
	email: z.string().email(),
	fullName: z.string(),
});

export const withIdentityRequest = onboardingBase.extend({
	identityRequestId: z.string(),
});

export const withIdentityVerified = withIdentityRequest.extend({
	verifiedAt: z.coerce.date(),
});

export const withBankPending = withIdentityVerified.extend({
	bankAccountId: z.string(),
	microDepositId: z.string(),
});

export const withBankVerified = withBankPending.extend({
	bankVerifiedAt: z.coerce.date(),
});

export const withBackofficeReview = withBankVerified.extend({
	reviewRequestedAt: z.coerce.date(),
});

export const withApproved = withBackofficeReview.extend({
	approvedBy: z.string(),
	approvedAt: z.coerce.date(),
});

export const onboardingWorkflow = defineWorkflow("onboarding", {
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
