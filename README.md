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

## Import Environment Variables

Member Google Sheets import needs service-account credentials and runtime tuning values:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_DEFAULT_RANGE` (optional, default used if omitted)

Optional import tuning for low-resource deployments:

- `IMPORT_CHUNK_SIZE` (default `50`)
- `IMPORT_MAX_PREVIEW_ROWS` (default `200`)
- `IMPORT_MAX_FAILED_ROWS_DATA` (default `500`)
- `IMPORT_MAX_ROWS_PER_BATCH` (default `5000`)

## Auth + DB Tuning Variables

- `JWT_STAFF_PERMISSION_SYNC_SECONDS` (default `300`)
	- Staff permissions are reloaded from role after this interval.

Database runtime tuning:

- `DB_MAX_POOL_SIZE` (default `5`)
- `DB_SERVER_SELECTION_TIMEOUT_MS` (default `10000`)
- `DB_SOCKET_TIMEOUT_MS` (default `30000`)
- `DB_WAIT_QUEUE_TIMEOUT_MS` (default `5000`)
- `DB_MAX_IDLE_TIME_MS` (default `10000`)
