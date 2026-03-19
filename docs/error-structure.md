# Error Structure

All thrown errors flow to global error middleware and return a common structure.

## Core files

- `src/middlewares/globalErrorHandler.ts`
- `src/errors/AppError.ts`
- `src/errors/handleZodError.ts`
- `src/errors/handleValidationError.ts`
- `src/errors/handleCastError.ts`
- `src/errors/handleDuplicateError.ts`

## Error response envelope

```json
{
  "success": false,
  "message": "Something went wrong!",
  "errorSources": [
    {
      "path": "field",
      "message": "Reason"
    }
  ],
  "err": {},
  "stack": null
}
```

## Handling order (simplified)

1. Zod errors
2. Mongoose validation errors
3. Mongoose cast errors
4. Duplicate key errors
5. JWT expiry/invalid token errors
6. Custom `AppError`
7. Generic `Error`

## Best practice

- Throw `AppError(statusCode, message)` for known business failures.
- Let unexpected exceptions fall through to generic handler.
- Keep detailed stack traces available only in development mode.
