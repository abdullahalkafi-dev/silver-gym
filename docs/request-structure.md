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
