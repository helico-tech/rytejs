import { vi } from "vitest";

export type OnboardingDeps = {
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

export function createMockDeps(): OnboardingDeps {
	return {
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
}
