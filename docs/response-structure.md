# Response Structure

Successful API responses are standardized with `sendResponse`.

## Core file

- `src/shared/sendResponse.ts`

## Response envelope

```json
{
  "success": true,
  "message": "...",
  "meta": {
    "page": 1,
    "limit": 10,
    "totalPage": 2,
    "total": 20
  },
  "data": {}
}
```

## Field meaning

- `success`: boolean status for successful operation.
- `message`: optional user-facing operation summary.
- `meta`: optional pagination metadata.
- `data`: optional main payload.

## Controller usage

Controllers call:

```ts
sendResponse(res, {
  statusCode: 200,
  success: true,
  message: "Fetched successfully",
  data: result,
});
```

`statusCode` is used for HTTP status and not included directly in response body.

## Import batch response (new)

`GET /api/v1/members/import/:branchId/batches/:batchId` returns batch payload in `data`.

Important fields:

- `status`: `pending | processing | completed | partial_failed | failed | cancelled`
- `totalRows`
- `processedRows`
- `successRows`
- `failedRows`
- `warningRows`
- `failuresPreview[]`
- `warningsPreview[]`

Example:

```json
{
  "success": true,
  "message": "Import batch status retrieved successfully",
  "data": {
    "_id": "67f...",
    "status": "partial_failed",
    "totalRows": 120,
    "processedRows": 120,
    "successRows": 105,
    "failedRows": 10,
    "warningRows": 5,
    "failuresPreview": [
      { "rowIndex": 14, "reason": "fullName is required" }
    ],
    "warningsPreview": [
      { "rowIndex": 31, "reason": "Payment information missing; member saved as inactive draft" }
    ]
  }
}
```

## Import batch list response (new)

`GET /api/v1/members/import/:branchId/batches` returns paginated list in `data`.

```json
{
  "success": true,
  "message": "Import batches retrieved successfully",
  "data": {
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 4,
      "totalPage": 1
    },
    "data": [
      {
        "_id": "67f...",
        "status": "processing",
        "processedRows": 120,
        "totalRows": 500
      }
    ]
  }
}
```

## Import metrics response (new)

`GET /api/v1/members/import/:branchId/metrics` returns compact monitoring data.

```json
{
  "success": true,
  "message": "Import metrics retrieved successfully",
  "data": {
    "windowDays": 7,
    "since": "2026-03-23T10:00:00.000Z",
    "statusCounts": {
      "pending": 1,
      "processing": 0,
      "completed": 4,
      "partial_failed": 2,
      "failed": 1,
      "cancelled": 0
    },
    "summary": {
      "totalBatches": 8,
      "processedRows": 920,
      "successRows": 870,
      "failedRows": 30,
      "warningRows": 20,
      "successRate": 94.57,
      "averageDurationMs": 4180
    },
    "runtime": {
      "queueRunning": true,
      "totalQueued": 1,
      "branchActive": true,
      "branchPendingCount": 1
    }
  }
}
```

## Dashboard summary response (new)

`GET /api/v1/members/import/:branchId/dashboard-summary` returns member counters + import metrics in one payload.

```json
{
  "success": true,
  "message": "Dashboard summary retrieved successfully",
  "data": {
    "members": {
      "windowDays": 7,
      "members": {
        "totalMembers": 320,
        "activeMembers": 290,
        "inactiveMembers": 30,
        "importDraftMembers": 12,
        "newMembersInWindow": 24
      },
      "billing": {
        "paymentDueNow": 18,
        "paymentDueSoon": 33
      }
    },
    "imports": {
      "windowDays": 7,
      "statusCounts": {
        "pending": 1,
        "processing": 0,
        "completed": 4,
        "partial_failed": 2,
        "failed": 1,
        "cancelled": 0
      }
    }
  }
}
```
