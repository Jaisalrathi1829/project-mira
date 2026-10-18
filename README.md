# MIRA

A calm, time-aware task manager. The React + Tailwind interface (designed in Figma Make) is backed by a local
Node.js API and a SQLite database, so tasks, subtasks, progress and preferences persist across refreshes and restarts.

MIRA v1 is a **single-user, local-first** app: the API listens on this computer only and has no login.
It is not a multi-user or internet-facing service.

## Run it

Requirements: **Node.js 22.13 or newer** (24 recommended; MIRA uses Node's built-in `node:sqlite`) and **pnpm 10**.
If `pnpm` is not installed, use `npx pnpm@10.34.3` in place of `pnpm` below, or install it with `npm i -g pnpm@10`.

```bash
pnpm install
```

```bash
pnpm dev:all
```

Open <http://localhost:8443>. `dev:all` runs the API (port 8787, restarts on server changes) and the Vite dev server
(port 8443, which forwards `/api` to the API). On first start MIRA creates `data/mira.sqlite` and adds the
prototype's example tasks so the app looks as designed; later starts never add them again.

| Command | What it does |
| --- | --- |
| `pnpm dev:all` | API + frontend for development |
| `pnpm dev` | Frontend only (as Figma Make runs it). Without the API it shows an "Offline" screen |
| `pnpm dev:server` | API only, with restart on change |
| `pnpm start` | Production build served by the API on one port: <http://127.0.0.1:8787> |
| `pnpm test` | All automated tests (engine, API, database, frontend integration) |
| `pnpm typecheck` | TypeScript across frontend, server, shared code and tests |
| `pnpm build` | Production frontend build (`dist/`), unchanged from Figma Make |

Configuration is optional; see [.env.example](.env.example). Put overrides in `.env.local` (git-ignored).
To start with an empty database, set `MIRA_SEED=false` before the first run, or delete `data/` while MIRA is stopped.
To back up your data, copy `data/mira.sqlite` while MIRA is stopped.

## How it is built

```
src/            React UI (Figma Make design, unchanged visually)
  mira/api.ts     typed HTTP client: every failure becomes a visible error
  mira/store.ts   the single source of truth in the UI; updates only from server-confirmed records
  mira/data.ts    the task engine bound to the browser's live clock
shared/         code used by both UI and server
  engine.ts       progress, pace, status, focus selection, filtering/sorting
  dates.ts        date-only arithmetic (YYYY-MM-DD) and time-zone-aware "today"
  reminders.ts    reminder rules · planner.ts work blocks · quickAdd.ts parsing · insights.ts
  types.ts        API contracts
server/         Express API: routes → handlers → services → repositories → SQLite
  http/           routes, zod validation schemas, security + idempotency + error middleware
  services/       business rules and transactions
  repositories/   SQL
  db/             connection, versioned migrations, first-run initialisation
  integrations/   Google Calendar / Gmail boundary and demo providers
tests/          vitest: engine/, api/, frontend/
```

### Task engine (one definition, used everywhere)

- **Dates** are calendar days stored as `YYYY-MM-DD`. All arithmetic is done on whole days, so time zones and DST
  never move a deadline. "Today" comes from the live clock in the user's time zone. Nothing is hard-coded.
- **Duration** is the calendar-day difference between start and deadline: 7 → 10 October is 3 days.
- **Progress** is 100% for completed tasks, done/total for count-based tasks, otherwise the share of subtasks done.
- **Expected progress** (the pace marker) is the elapsed share of the window, from 00:00 on the start date to
  00:00 on the deadline, including the time of day: `clamp((days since start + fraction of today) / max(1, duration))`.
- **Status precedence:** Completed → Overdue (deadline before today) → Due Today → Upcoming (starts after today) →
  At Risk (expected progress more than 25 points ahead of actual) → Active ("In progress").
- **Current focus:** among started, unfinished tasks, the highest priority, then the most urgent status, then the
  earliest deadline. If nothing is in progress, no focus is shown.
- Completing sets `completedAt` once; completing again changes nothing; reopening clears it.

### API

All responses are JSON. Errors are always `{ "error": { "code", "message", "details?" } }` with a matching HTTP status
(400 malformed, 403 forbidden origin/host, 404 missing, 409 conflict, 413 too large, 422 invalid, 501 not
implemented). Stack traces and SQL never reach the client. Task-changing endpoints return the full updated task,
including a server-side `computed` block (`status`, `progress`, `expectedProgress`, `asOf`).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Server and database check |
| GET | `/api/tasks` | `?status=Overdue,At Risk&completed=false&q=report&sort=deadline\|startDate\|priority\|createdAt\|updatedAt\|completedAt\|title&order=asc\|desc&today=YYYY-MM-DD` |
| POST | `/api/tasks` | `{ title, description?, startDate?, deadline? \| durationDays?, priority?, reminder?, subtasks?: string[], count? }` |
| GET / PATCH / DELETE | `/api/tasks/:id` | PATCH accepts any editable field; `count: null` removes counting |
| POST | `/api/tasks/:id/complete`, `/api/tasks/:id/reopen` | Idempotent |
| POST | `/api/tasks/:id/count` | `{ by: ±n }`, clamped to 0…total in one SQL statement |
| POST | `/api/tasks/:id/subtasks` | `{ title }` |
| PATCH / DELETE | `/api/tasks/:id/subtasks/:subtaskId` | PATCH `{ title?, done?, position? }` |
| GET / PATCH | `/api/preferences` | `displayName, greeting, defaultDuration, workingHours, reminder`, or `{ resetInsights: true }` |
| GET | `/api/insights` | Patterns computed from real history (needs a minimum number of samples) |
| GET | `/api/reminders` | Reminders due now that have not been delivered |
| POST | `/api/reminders/ack` | `{ keys }`, records delivery so a reminder is shown once |
| GET | `/api/integrations` | Connection state of every service |
| POST | `/api/integrations/:provider/connect` \| `disconnect` | See "Integrations" below |
| PATCH | `/api/integrations/:provider/settings` | Google Calendar options |
| POST | `/api/integrations/gcal/sync` | Always refuses honestly until a real account is connected |
| GET | `/api/integrations/gcal/events?from&to` | Demo events in demo mode, max 62 days |
| GET | `/api/integrations/gmail/suggestions` | Task-like messages with detected deadlines |
| POST | `/api/integrations/gmail/suggestions/:id/import` | Creates the task once; repeats return the existing task |

`POST /api/tasks` and `POST /api/tasks/:id/subtasks` honour an `Idempotency-Key` header: a retried request with the
same key and body gets the original response instead of creating a duplicate. The UI sends one key per submission.

### Security and reliability

- The API binds to `127.0.0.1`. It refuses requests that do not come from this machine, including requests that
  reach the `0.0.0.0`-bound Vite dev server from another device (checked through the proxy's `X-Forwarded-For`).
  It also refuses a non-loopback `Host` header (DNS rebinding) and browser origins that are not trusted.
- Every body, query and id is validated with zod. SQLite `CHECK`, `FOREIGN KEY` and `UNIQUE` constraints act as a
  second line of defence. Multi-row changes run in transactions. WAL mode is on, and the server closes the database
  cleanly on Ctrl+C.
- Logs record method, path, status and timing only, never request bodies, task text or mail content.
- No secrets live in the frontend bundle. Google credentials (future) are read only by the server.
- There is no authentication: anyone who can run code as you on this computer can use the API.

## Reminders and notifications

Reminder rules live in [shared/reminders.ts](shared/reminders.ts) and are unit-tested. The global preference
"Minimal" limits every task to due-today and overdue reminders. Otherwise each task's own setting applies:
Smart (due tomorrow, due today, overdue, behind pace), Frequent (Smart plus start-day and daily repeats), Evening
(Smart, from 6 PM) or Weekend. Completed tasks never produce reminders. Each reminder has a stable key, and the
server's delivery log guarantees it is shown once.

**What works today:** while MIRA is open in a browser tab, it checks for due reminders every minute and shows them in
the MIRA companion card. **What does not:** nothing is shown while the tab or app is closed, and there are no Windows
system notifications. Those need a native desktop runtime (below).

## Integrations: what is real and what is demo

No real Google account can be connected in this version, and the UI never says "Connected" or "Synced" for demo data.

- Google Calendar and Gmail can run in **demo mode**, labelled "Demo data" everywhere it appears. Demo calendar events
  are marked "Demo event". The Sync button contacts the server, which reports that demo data cannot be synced.
  Demo Gmail suggestions come from sample messages. Importing one creates a real task that records its source, and
  each message can be imported only once.
- Calendar work blocks are real: MIRA's planner places them inside your working hours from your open tasks. They
  stay inside MIRA and are not written to any calendar.
- Notion, Slack, GitHub, Google Drive and Outlook report "not available yet" when you try to connect them.

**To add real Google Calendar and Gmail:** create a Google Cloud OAuth client (desktop/loopback redirect) with the
Calendar and `gmail.readonly` scopes and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on the server. Then implement
the OAuth authorisation-code + PKCE flow against the `OAuthClient` interface in
[server/integrations/types.ts](server/integrations/types.ts), with encrypted token storage, refresh and revocation
handling. After that, add Google-backed `CalendarProvider` and `MailProvider` classes. The interfaces already define
idempotent calendar writes (`CalendarWrite.key`), the error categories (revoked, rate-limited, unavailable) and
`withRetry` backoff. The routes, services, duplicate protection (`tasks.source` + `source_ref` is unique) and UI
states do not need to change.

## What remains for a native desktop app

The web frontend's **Ctrl + Space** works only while the MIRA tab has keyboard focus. A desktop shell
(e.g. Tauri or Electron) wrapping this frontend and API would add:

- a system-wide Ctrl + Space shortcut
- an always-on-top companion window over other apps
- Windows notifications and reminders while MIRA is in the background
- a tray icon, start-on-login, and an app-managed database location

## Known limitations

- Single local user, no authentication.
- No real Google Calendar/Gmail connection yet (see above). Calendar "Sync" therefore never succeeds.
- Reminders appear only while MIRA is open.
- Insights ("What MIRA has learned") appear only after enough real history exists. Seeded demo subtasks carry no
  completion time, so they never count as timing history.
- Count-based tasks can be created through the API only (the New task dialog has no count field). Their count can
  be stepped from the task page.
- The Figma Make static deployment (`.figma/make/deploy`) publishes only the frontend. Without the API, it shows the
  Offline screen.
- Month and weekday names follow the browser's locale. Quick Add and mail date detection understand English
  phrases.
