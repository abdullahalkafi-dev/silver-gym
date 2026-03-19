# SilverGym Backend Docs

This repository uses short docs for each backend layer and API structure.

## Quick links

- [Routes](./docs/routes.md)
- [Controllers](./docs/controllers.md)
- [Services](./docs/services.md)
- [Repositories](./docs/repositories.md)
- [Interfaces](./docs/interfaces.md)
- [Request Structure](./docs/request-structure.md)
- [Response Structure](./docs/response-structure.md)
- [Error Structure](./docs/error-structure.md)

## Project flow (high level)

1. route receives request.
2. validateRequest checks payload using Zod DTO.
3. controller calls service and sends final response.
4. service contains business rules and orchestrates operations.
5. repository performs DB operations (Mongoose model access).
6. errors are thrown as AppError (or native errors) and handled by global error middleware.

## Important shared helpers

- src/shared/catchAsync.ts: wraps async controllers.
- src/shared/sendResponse.ts: standard success response envelope.
- src/middlewares/globalErrorHandler.ts: standard error response envelope.

## Notes

- Keep each layer focused on a single responsibility.
- Keep business rules inside services (not in routes/controllers).
- Keep DB-specific queries inside repositories.
- Keep DTO validation close to route definitions.
