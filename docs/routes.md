# Routes

Routes define endpoint path + HTTP method + middleware chain + controller handler.

## Current route modules

- `src/module/auth/auth.route.ts`
- `src/module/logs/logs.route.ts`
- mounted from `src/routes/index.ts`

## Route responsibilities

- Map URL to controller functions.
- Attach validation middleware (`validateRequest`).
- Attach auth/security middleware when needed (example: `requireAdminApiKey`).
- Keep route files thin; no business logic.

## Route comment format

Use this above each endpoint:

```ts
/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user account
 * @access  Public
 */
```

## Good route patterns used in this project

- Explicit path naming (`/verify-account`, `/resend-otp`).
- DTO validation before controller execution.
- Grouped by feature module.

## Keep in mind

- Route should not call repository directly.
- Route should not build custom response body; let controller use `sendResponse`.
- If middleware order matters, keep security middleware before handlers.
