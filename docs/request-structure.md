# Request Structure

Request validation is middleware-first and DTO-driven using Zod.

## Core files

- `src/middlewares/validateRequest.ts`
- module DTO files such as `src/module/auth/auth.dto.ts`

## Validation flow

1. Route attaches `validateRequest(SomeDto)`.
2. Middleware validates `{ body, params, query, cookies, data }`.
3. If valid, request continues to controller.
4. If invalid, Zod error is passed to global error handler.

## DTO shape convention

DTO is usually a Zod object with one or more keys:

- `body`
- `params`
- `query`
- `cookies`

Example high-level:

```ts
z.object({
  body: z.object({ ... }).strict(),
});
```

## Notes

- Use `.strict()` to reject unknown fields where required.
- Use `superRefine` for cross-field validation.
- Keep DTO close to route/controller in module folder.

## Member create request (new)

Route: `POST /api/v1/members/:branchId`

```json
{
  "data": {
    "fullName": "John Doe",
    "contact": "017xxxxxxxx",
    "currentPackageId": "64f...",
    "membershipStartDate": "2026-03-30T00:00:00.000Z",
    "payment": {
      "paymentMethod": "cash",
      "paidTotal": 2000,
      "discount": 0,
      "admissionFee": 500
    }
  }
}
```

Monthly path example:

```json
{
  "data": {
    "fullName": "Jane Doe",
    "customMonthlyFee": true,
    "monthlyFeeAmount": 1500,
    "paidMonths": 1,
    "payment": {
      "paymentMethod": "bkash",
      "paidTotal": 1500
    }
  }
}
```

Monthly path with branch fallback:

```json
{
  "data": {
    "fullName": "Jane Doe",
    "customMonthlyFee": true,
    "monthlyFeeAmount": false,
    "paidMonths": 1,
    "payment": {
      "paymentMethod": "bkash",
      "paidTotal": 1500
    }
  }
}
```

Notes:

- `monthlyFeeAmount: false` means: use branch-level default monthly fee.
- Fallback is supported for member create/update flows.
- If `customMonthlyFee` is `true` and no member fee + no branch fee exists, API returns `400`.

## Member import start request (new)

Route: `POST /api/v1/members/import/:branchId/google-sheet`

```json
{
  "data": {
    "spreadsheetId": "1AbCdEf...",
    "range": "Members!A1:AZ"
  }
}
```

## Member list query (new)

Route: `GET /api/v1/members/:branchId`

Supported query params:

- `searchTerm`: search across member name, email, contact, member ID, and barcode.
- `page` and `limit`: pagination controls.
- `includeInactive=true`: include inactive members in list results.
- `isActive=true|false`: explicitly filter active or inactive members.
- `paymentStatus=due|complete`: filter by current due amount.

## Import retry/cancel params (new)

- `branchId` from route params.
- `batchId` from route params.

## Import batch list query (new)

Route: `GET /api/v1/members/import/:branchId/batches`

Optional query params:

- `page` (string number)
- `limit` (string number, max 100)
- `status` one of:
  - `pending`
  - `processing`
  - `completed`
  - `partial_failed`
  - `failed`
  - `cancelled`

## Import metrics query (new)

Route: `GET /api/v1/members/import/:branchId/metrics`

Optional query params:

- `days` (string number, default `7`, max `90`)

## Dashboard summary query (new)

Route: `GET /api/v1/members/import/:branchId/dashboard-summary`

Optional query params:

- `days` (string number, default `7`, max `90`)
