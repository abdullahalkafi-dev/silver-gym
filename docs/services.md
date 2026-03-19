# Services

Services implement business logic and coordinate repositories/utilities.

## Current examples

- `src/module/auth/auth.service.ts`
- `src/module/logs/logs.service.ts`

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
