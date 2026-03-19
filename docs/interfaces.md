# Interfaces

Interfaces and enums define type contracts between layers.

## Current examples

- `src/module/user/user.interface.ts`
- other module `*.interface.ts` files in `src/module/*`

## Responsibilities

- Define shape of entities (e.g. `TUser`).
- Define enums/constants for constrained values (e.g. `LoginProvider`).
- Define shared type aliases (`Partial<T>`, payload types, etc).

## Good practices

- Keep interface names explicit (`TUser`, `LinkedProvider`).
- Use enums for finite domain values.
- Keep optional fields truly optional.
- Use narrow unions for status/state (`"active" | "inactive" | "suspended"`).

## Layer usage

- DTO handles input validation.
- Interface handles TypeScript contract.

Both are needed: DTO for runtime safety, interface for compile-time safety.
