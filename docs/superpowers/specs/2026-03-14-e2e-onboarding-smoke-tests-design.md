# E2E Onboarding Smoke Tests Design

## Summary

Add a comprehensive onboarding workflow to the E2E test suite (`examples/e2e/`) that exercises the full breadth of the framework: multi-step state transitions, dependency injection, webhook callbacks, event emission, middleware, domain errors, and validation errors. The workflow models a realistic user onboarding flow with external identity verification, bank micro-deposit verification, and backoffice approval.

## Workflow Domain: User Onboarding

### State Data (Zod Extension Chains)

Schemas build progressively using Zod `.extend()` to avoid field repetition. Uses `z.coerce.date()` to match existing codebase conventions and remain forward-compatible with serialization.

```typescript
const base = z.object({
  email: z.string().email(),
  fullName: z.string(),
});

const withIdentityRequest = base.extend({
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
```

Note: each schema strictly extends the previous one in the chain, so no fields are ever dropped during transitions. `microDepositId` carries through from `BankVerificationPending` onward, and `reviewRequestedAt` carries through from `BackofficeReview` onward.

### States

| State                    | Schema                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `Started`                | `base`                                                       |
| `IdentityPending`        | `withIdentityRequest`                                        |
| `IdentityVerified`       | `withIdentityVerified`                                       |
| `IdentityFailed`         | `withIdentityRequest.extend({ failureReason: z.string() })`  |
| `BankVerificationPending`| `withBankPending`                                            |
| `BankVerified`           | `withBankVerified`                                           |
| `BankFailed`             | `withIdentityVerified.extend({ bankAccountId: z.string(), failureReason: z.string() })` |
| `BackofficeReview`       | `withBackofficeReview`                                       |
| `Approved`               | `withApproved`                                               |
| `Rejected`               | `withBankVerified.extend({ rejectedBy: z.string(), rejectionReason: z.string() })` |
| `Active`                 | `withApproved.extend({ activatedAt: z.coerce.date() })`     |

Terminal states: `IdentityFailed`, `BankFailed`, `Rejected`, `Active`.

### Commands

| Command                    | Payload                                              | Triggered By     |
| -------------------------- | ---------------------------------------------------- | ---------------- |
| `SubmitIdentity`           | `{ documentUrl: z.string().url() }`                  | User action      |
| `ReceiveIdentityResult`    | `{ success: z.boolean(), reason?: z.string() }`      | Webhook callback |
| `InitiateBankVerification` | `{ bankAccountId: z.string() }`                      | User action      |
| `ReceiveBankResult`        | `{ success: z.boolean(), reason?: z.string() }`      | Webhook callback |
| `SubmitForReview`          | `{}`                                                 | Automatic        |
| `ApproveOnboarding`        | `{ approvedBy: z.string() }`                         | Backoffice       |
| `RejectOnboarding`         | `{ rejectedBy: z.string(), reason: z.string() }`     | Backoffice       |
| `ActivateAccount`          | `{}`                                                 | Automatic        |

### State-Command Routing Table

| State                    | Command                    | Next State (success)       |
| ------------------------ | -------------------------- | -------------------------- |
| `Started`                | `SubmitIdentity`           | `IdentityPending`          |
| `IdentityPending`        | `ReceiveIdentityResult`    | `IdentityVerified` or `IdentityFailed` (based on `success`) |
| `IdentityVerified`       | `InitiateBankVerification` | `BankVerificationPending`  |
| `IdentityVerified`       | `ReceiveIdentityResult`    | domain error `AlreadyVerified` |
| `BankVerificationPending`| `ReceiveBankResult`        | `BankVerified` or `BankFailed` (based on `success`) |
| `BankVerified`           | `SubmitForReview`          | `BackofficeReview`         |
| `BackofficeReview`       | `ApproveOnboarding`        | `Approved`                 |
| `BackofficeReview`       | `RejectOnboarding`         | `Rejected`                 |
| `Approved`               | `ActivateAccount`          | `Active`                   |

Any command dispatched to a state not listed here results in a `NO_HANDLER` router error.

### Events

Each event has a Zod schema for validation via `ctx.emit()`:

| Event                       | Schema                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| `IdentityCheckRequested`    | `z.object({ email: z.string(), identityRequestId: z.string() })`  |
| `IdentityVerified`          | `z.object({ email: z.string(), verifiedAt: z.coerce.date() })`    |
| `IdentityFailed`            | `z.object({ email: z.string(), reason: z.string() })`             |
| `MicroDepositInitiated`     | `z.object({ email: z.string(), bankAccountId: z.string(), microDepositId: z.string() })` |
| `BankVerified`              | `z.object({ email: z.string(), bankAccountId: z.string() })`      |
| `BankFailed`                | `z.object({ email: z.string(), reason: z.string() })`             |
| `BackofficeReviewRequested` | `z.object({ email: z.string(), reviewRequestedAt: z.coerce.date() })` |
| `OnboardingApproved`        | `z.object({ email: z.string(), approvedBy: z.string() })`         |
| `OnboardingRejected`        | `z.object({ email: z.string(), rejectedBy: z.string(), reason: z.string() })` |
| `WelcomeEmailSent`          | `z.object({ email: z.string() })`                                 |
| `AccountActivated`          | `z.object({ email: z.string(), activatedAt: z.coerce.date() })`   |

### Dependencies (Injected, Mocked in Tests)

Only dependencies needed **inside handlers** — side-effects like email sending are driven by events post-dispatch.

```typescript
type OnboardingDeps = {
  identityProvider: {
    requestVerification(
      email: string,
      documentUrl: string,
      callbackUrl: string
    ): Promise<{ requestId: string }>;
  };
  bankingService: {
    initiateMicroDeposit(
      bankAccountId: string,
      callbackUrl: string
    ): Promise<{ depositId: string }>;
  };
  callbackRegistry: {
    registerCallback(workflowId: string, type: string): string;
  };
};
```

**Callback flow:**
1. Handler calls `callbackRegistry.registerCallback()` to get a URL
2. Passes URL to external service (`identityProvider` or `bankingService`)
3. External service calls back via webhook (simulated in tests by dispatching `ReceiveIdentityResult` / `ReceiveBankResult`)

Note: `resolveCallback` is omitted — in these E2E tests, callbacks are simulated by dispatching commands directly, so resolving callback URLs is not needed.

### Middleware

| Middleware   | Scope  | Purpose                                                   |
| ------------ | ------ | --------------------------------------------------------- |
| Audit logger | Global | Pushes `{ command: string, state: string }` entries to a shared array; tests assert on the full sequence |

Email and backoffice notifications are **not** middleware — they are post-dispatch event consumers. Tests assert the correct events were emitted; the event-to-side-effect mapping is outside the workflow's concern.

### Errors

Each error has a Zod schema in the `errors` config:

| Error Code          | Schema             | When                                                        |
| ------------------- | ------------------ | ----------------------------------------------------------- |
| `DocumentsInvalid`  | `z.object({})`     | `SubmitIdentity` handler rejects a bad document (domain error) |
| `BankAccountInvalid` | `z.object({})`    | `InitiateBankVerification` handler rejects bad account (domain error) |
| `AlreadyVerified`   | `z.object({})`     | `ReceiveIdentityResult` dispatched to `IdentityVerified` state |

## Test Scenarios

6 tests in `examples/e2e/e2e.test.ts`, each walking a complete path:

### Test 1: Happy path — full onboarding to active

`Started → IdentityPending → IdentityVerified → BankVerificationPending → BankVerified → BackofficeReview → Approved → Active`

- Dispatches 7 commands in sequence (SubmitIdentity, ReceiveIdentityResult, InitiateBankVerification, ReceiveBankResult, SubmitForReview, ApproveOnboarding, ActivateAccount)
- Asserts data accumulates correctly at each step
- Asserts all expected events emitted (including `WelcomeEmailSent`, `AccountActivated`)
- Verifies mocks were called with correct args (identity provider got the callback URL, banking service got the callback URL)
- Checks audit log middleware captured the full command sequence

### Test 2: Identity verification fails

`Started → IdentityPending → IdentityFailed`

- Submits identity, receives failed callback with `{ success: false, reason: "document_expired" }`
- Asserts `IdentityFailed` event with reason
- Asserts workflow is in terminal state with `failureReason` populated
- Verifies identity provider was called but banking service was never called

### Test 3: Bank verification fails

`Started → IdentityPending → IdentityVerified → BankVerificationPending → BankFailed`

- Gets past identity, bank callback comes back with `{ success: false, reason: "account_closed" }`
- Asserts `BankFailed` event
- Verifies banking service was called with the registered callback URL

### Test 4: Backoffice rejects

`Started → ... → BackofficeReview → Rejected`

- Full flow up to backoffice, then rejected with reason
- Asserts `OnboardingRejected` event carries `rejectedBy` and `reason`

### Test 5: Domain error — duplicate verification attempt

`Started → IdentityPending → IdentityVerified → (ReceiveIdentityResult again) → AlreadyVerified error`

- Reaches `IdentityVerified`, then a duplicate webhook arrives
- Handler in `IdentityVerified` state for `ReceiveIdentityResult` returns `AlreadyVerified` domain error
- Asserts domain error with `AlreadyVerified` code
- Asserts workflow state unchanged (rollback)

### Test 6: Validation error — bad command payload

`Started → SubmitIdentity with invalid payload → validation error`

- Dispatches `SubmitIdentity` with `{ documentUrl: "not-a-url" }` (fails `z.string().url()` validation)
- Asserts Zod validation error (category: `"validation"`, source: `"command"`), not a domain error
- Workflow stays in `Started`

## File Structure

All new code goes in `examples/e2e/e2e.test.ts`, added as a new `describe("onboarding workflow", ...)` block alongside the existing task workflow tests. No new files needed.

## Non-Goals

- No real HTTP server or webhook endpoint — callbacks are simulated by dispatching commands directly
- No persistence layer — workflows are in-memory
- No cross-workflow orchestration
- No testing of the event-to-email mapping (that's outside the workflow's concern)
