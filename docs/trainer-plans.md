# Trainer plans (portal "Ask a trainer")

Members ask a trainer of their own branch for a diet or workout plan from the member portal
(`portal.silvergym-bd.com`). The trainer answers with a formatted plan, usually starting from one of
their own templates. Owner and staff can follow it read-only on the dashboard Trainers page.

It is **not a chat**: one request gets one answer. To ask again the member sends a new request.

Code: `src/module/trainerPlan/`. Phase 1 (this) is text only. Voice notes (member and trainer, max
5 minutes, private storage) are Phase 2.

## Rules

| Rule | Where it is enforced |
|---|---|
| Member sees only **active trainers of their own branch**. No trainer, no feature. | `planRequest.service.listTrainersForMember`, `submit` |
| **One open request per member** (status `pending`). | unique partial index `one_open_plan_request_per_member` + 409 |
| The member **cannot edit** a request after sending. They can **cancel** it while it is `pending`. | `cancelForMember` |
| The trainer only sees requests **sent to them**. | every trainer query filters by `trainerId` from the portal token |
| The trainer can **send, then edit** their reply any time (the member always sees the latest). | `saveReply` (`pending` or `answered`) |
| The trainer can **decline** a pending request with a short reason. | `decline` |
| Templates are **private** to each trainer (max 100). | `planTemplate.service`, filter by `trainerId` |
| Trainer sees the member's name, member ID, photo and body details only (no phone, no billing). | `memberSnapshot` |
| Owner/staff (`canManageMembers`, same guard as the Trainers page) see counts, requests and replies **read-only**. | `trainerPlan.route.ts` |
| Rich text is **cleaned on the server** (allow-list of tags, no attributes, no links). | `trainerPlan.richText.ts` |

When a trainer is **deleted**, their pending requests become `declined` with "This trainer is no longer
available" (so members are not stuck) and their templates are removed. A **deactivated** trainer keeps
their requests; the member can cancel and ask someone else.

## Data

`PlanRequest` (collection `planrequests`)

| Field | Notes |
|---|---|
| `branchId`, `memberId`, `trainerId` | ObjectIds. `trainerName` is copied so history still reads well. |
| `topic` | A preset (`Weight loss`, `Weight gain`, `Muscle building`, `Diet plan`, `Workout plan`, `Stay fit`) or the member's own title (`isCustomTopic: true`, max 60 chars). |
| `note` | What the member wrote about health, injuries, food habits (max 2000 chars). |
| `memberSnapshot` | Copied at send time: `fullName`, `memberId`, `photo`, `gender`, `age`, `bloodGroup`, `height`, `heightUnit`, `weight`, `weightUnit`, `trainingGoals`. If the profile has no height/weight the form asks for them; they go only into this snapshot, never into the profile. |
| `status` | `pending` → `answered` / `declined` / `cancelled`. |
| `reply` | `{ title, content (clean HTML), sentAt, editedAt }`. |
| `declineReason`, `closedAt` | Set when declined/cancelled/answered. |

Indexes: `one_open_plan_request_per_member` (unique, partial on `status: "pending"`),
`{ trainerId, status, createdAt }`, `{ branchId, trainerId, createdAt }`, `{ memberId, createdAt }`.

`PlanTemplate`: `trainerId`, `branchId`, `title` (max 120), `content` (clean HTML), timestamps.
Index `{ trainerId, updatedAt }`.

## API

All responses use the usual `{ success, message, meta?, data }` envelope.

### Portal, member token (`/api/v1/portal`)

| Method | Path | What |
|---|---|---|
| GET | `/plan-trainers` | Active trainers of the member's branch `[{ id, displayName }]` |
| GET | `/plan-requests` | The member's requests, newest first (last 50) |
| GET | `/plan-requests/:id` | One of the member's requests with the reply |
| POST | `/plan-requests` | `{ trainerId, topic, isCustomTopic?, note?, height?, heightUnit?, weight?, weightUnit? }` |
| DELETE | `/plan-requests/:id` | Cancel (only while `pending`) |

### Portal, trainer token (`/api/v1/portal/trainer`)

| Method | Path | What |
|---|---|---|
| GET | `/requests?status=&topic=&search=&page=&limit=` | Requests sent to this trainer, with `counts` per status |
| GET | `/requests/:id` | One request |
| PUT | `/requests/:id/reply` | `{ title, content }`: send (pending → answered) or edit an answered reply |
| POST | `/requests/:id/decline` | `{ reason }` (only while `pending`) |
| GET / POST | `/templates` | List / create `{ title, content }` |
| PATCH / DELETE | `/templates/:id` | Edit / delete own template |

### Dashboard, owner/staff (`/api/v1/trainer-plans`, `canManageMembers`)

| Method | Path | What |
|---|---|---|
| GET | `/:branchId/summary` | Counts per trainer `{ [trainerId]: { total, pending, answered, declined, cancelled } }` |
| GET | `/:branchId/trainer/:trainerId/requests?status=&topic=&from=&to=&search=&page=&limit=` | That trainer's requests with notes and replies; `from`/`to` are `YYYY-MM-DD` in Bangladesh time |

## Screens

- **Portal, member:** new **Plans** tab (bottom nav). List of requests with status; "Ask a trainer" form
  at `/member/ask`; plan reader at `/member/plan/[id]`.
- **Portal, trainer:** `/trainer` (Requests, with filter chips and search), `/trainer/request/[id]`
  (member details + reply editor with "Use a template" and "Save as a new template"; picking a template
  fills the plan text only, the title stays the member's topic because template names are private),
  `/trainer/templates`, `/trainer/templates/[id]`
  (`new` for a new one). Editor: Tiptap with heading, bold, italic, underline, bullet and numbered lists,
  undo/redo.
- **Dashboard:** Trainers list shows request counts; "View activity" opens
  `/dashboard/trainers/[trainerId]` with stat cards, filters (status, topic, date range, search) and a
  read-only viewer of each request and reply.
