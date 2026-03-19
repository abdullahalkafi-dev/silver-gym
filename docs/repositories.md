# Repositories

Repositories are the data-access layer and should be the only place that talks to models directly.

## Current examples

- `src/module/user/user.repository.ts`
- similar pattern exists in module-specific repositories

## Repository responsibilities

- Wrap Mongoose model queries.
- Expose reusable query methods (`findOne`, `findMany`, `updateById`, etc).
- Keep DB-specific options (`select`, `populate`, `sort`, pagination).

## Typical methods in this project

- `create(payload)`
- `findById(id)`
- `findOne(filter, options)`
- `findMany(filter, options)`
- `updateById(id, payload)`
- `deleteById(id)`
- `deleteMany(filter)`
- `exists(filter)`
- `count(filter)`

## Rules

- No Express request/response handling.
- No route-level validation logic.
- No HTTP status handling.

Repository returns data; service decides business meaning.
