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
