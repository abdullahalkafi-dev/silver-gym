# Routes

Routes define endpoint path + HTTP method + middleware chain + controller handler.

## Current route modules

- `src/module/auth/auth.route.ts`
- `src/module/logs/logs.route.ts`
- `src/module/branch/branch.route.ts`
- `src/module/member/member.route.ts`
- `src/module/staff/staff.route.ts`
- mounted from `src/routes/index.ts`

## Branch fee routes (new)

- `GET /api/v1/branches/:businessId/branches/:branchId/monthly-fee`
	- Get branch monthly fee.
	- Access: owner or staff with `canViewBilling`.
- `PATCH /api/v1/branches/:businessId/branches/:branchId/monthly-fee`
	- Update branch monthly fee.
	- Access: owner or staff with `canEditBilling`.

Notes:

- Existing branch update route still works for owner updates.
- Member create/update can use branch fee fallback when `monthlyFeeAmount=false`.

## Member routes (new)

- `POST /api/v1/members/:branchId`
	- Create member with mandatory payment payload.
	- Access: owner or staff with `canAddMember`.
- `GET /api/v1/members/:branchId`
	- List members with search/filter pagination.
	- Query supports `searchTerm`, `page`, `limit`, `includeInactive=true`, `isActive=true|false`, and `paymentStatus=due|complete`.
	- Access: owner or staff with `canViewMembers`.
- `GET /api/v1/members/:branchId/:memberId`
	- Get one member details.
	- Access: owner or staff with `canViewMembers`.
- `PATCH /api/v1/members/:branchId/:memberId`
	- Update member data.
	- Access: owner or staff with `canEditMember`.
- `DELETE /api/v1/members/:branchId/:memberId`
	- Soft delete member (`isActive=false`).
	- Access: owner or staff with `canDeleteMember`.
- `PATCH /api/v1/members/:branchId/:memberId/restore`
	- Restore soft-deleted member.
	- Access: owner or staff with `canEditMember`.

## Member import routes (new)

- `POST /api/v1/members/import/:branchId/google-sheet`
	- Start async Google Sheets import batch.
	- Access: owner or staff with `canAddMember`.
- `GET /api/v1/members/import/:branchId/batches`
	- List import batches with pagination and optional status filter.
	- Access: owner or staff with `canViewMembers`.
- `GET /api/v1/members/import/:branchId/metrics`
	- Branch-level import metrics for monitoring dashboard.
	- Access: owner or staff with `canViewMembers`.
- `GET /api/v1/members/import/:branchId/dashboard-summary`
	- Combined member counts + import metrics for admin dashboard.
	- Access: owner or staff with `canViewMembers`.
- `GET /api/v1/members/import/:branchId/batches/:batchId`
	- Get batch status and progress.
	- Access: owner or staff with `canViewMembers`.
- `POST /api/v1/members/import/:branchId/batches/:batchId/retry`
	- Retry failed rows from a completed/failed batch.
	- Access: owner or staff with `canAddMember`.
- `POST /api/v1/members/import/:branchId/batches/:batchId/cancel`
	- Cancel pending/processing import batch.
	- Access: owner or staff with `canAddMember`.

## Auth routes (new)

- `POST /api/v1/auth/staff/login`
	- Staff login with username and password.

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
