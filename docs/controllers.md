# Controllers

Controllers handle Express `req/res` and delegate business logic to services.

## Current examples

- `src/module/auth/auth.controller.ts`
- `src/module/logs/logs.controller.ts`

## Controller responsibilities

- Read request data (`req.body`, `req.params`, `req.query`).
- Call service methods with normalized input.
- Return standard success response via `sendResponse`.
- Use `catchAsync` to forward exceptions to global error handler.

## Pattern used in this codebase

```ts
const action = catchAsync(async (req, res) => {
  const result = await SomeService.action(req.body);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Action successful",
    data: result,
  });
});
```

## Keep controllers small

- No DB queries directly in controller.
- No heavy decision trees in controller.
- No reusable business logic in controller.

If logic grows, move it to service and keep controller orchestration-only.
