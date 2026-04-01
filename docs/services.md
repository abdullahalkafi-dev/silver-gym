# Services

Services implement business logic and coordinate repositories/utilities.

## Current examples

- `src/module/auth/auth.service.ts`
- `src/module/logs/logs.service.ts`
- `src/module/member/member.service.ts`
- `src/module/member/memberImport.service.ts`

## Service responsibilities

- Validate business rules (not DTO shape validation).
- Fetch and update data through repository layer.
- Call external helpers (OTP, JWT, mail, fs, etc).
- Throw meaningful `AppError` for expected domain failures.

## Service style used here

- Functions are grouped in an exported object, e.g. `AuthService`.
- Services return plain objects/documents for controllers.
- Authorization and lifecycle checks happen in service methods.

## Error style in service

```ts
throw new AppError(StatusCodes.BAD_REQUEST, "Reason message");
```

## Keep in mind

- Service may call multiple repositories.
- Service should remain framework-light (Express details stay in controller).
- Service should be deterministic and testable.

## Member service behavior

- Member creation enforces package-or-monthly onboarding mode.
- App-created members require payment payload.
- Member + payment save path attempts Mongo transaction first.
- If transaction is not supported, fallback path applies compensating behavior:
	- member is moved to inactive draft if payment save fails.
- Member delete is soft delete (`isActive=false`).

## Member import service behavior

- Source is Google Sheets (service-account based).
- Import is async and batch-driven (`pending -> processing -> completed/partial_failed/failed/cancelled`).
- Processing is chunked with event-loop yielding to keep single-core instances responsive.
- Missing payment or missing membership plan does not crash the batch:
	- member is saved as inactive draft with warning metadata.
- Failed rows are stored for retry endpoint.
- Startup recovery re-queues pending/processing batches.
