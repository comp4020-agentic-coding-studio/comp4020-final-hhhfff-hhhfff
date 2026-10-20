# Development notes

These are binding development rules referenced by `CLAUDE.md`. Read and
follow the relevant section before changing server data, authentication,
live updates or UI behaviour.

## Runtime and local environment

- Node 24 runs TypeScript directly, with no build step. The runtime
  dependency is `marked`; adding dependencies needs owner approval.
- Start the app with `PORT=8080 DATA_DIR=.localdata node server/server.ts`
  in a shell supporting that syntax. In PowerShell, set the environment
  variables separately before running Node.
- Persistent data lives in SQLite under `DATA_DIR` (`/data` on Fly).
  Keep the Docker deployment working within one shared-cpu-1x machine
  with 256 MB.
- On this Windows setup, generic Python has been a Windows Store stub.
  Use file editing tools or Node for edits rather than relying on it.

## Data and security

- Check and write duplicate-sensitive operations in one transaction;
  see `createDeal` and `proposeCorrection` in `server/db.ts`.
  Validate prices when creating a post and applying a correction.
- Identity comes from the session cookie, never the request body or a
  public user ID. Roles are guest, user and admin, checked on the server
  using `server/auth.ts`. Guests cannot write; only the poster or an
  admin can delete a post. Admins come from `ADMIN_USERS`, never the API.
- Never expose passwords, password hashes or session tokens in responses.
  Validate client input in `server/server.ts`, use parameterised SQL,
  and render user text with `textContent`, never `innerHTML`.
- Logging in is its own page, `/login`. Its `?next=` returns only to this
  site's own pages (`safeNext` in `public/login.js`), anything else to `/`,
  so a link can't send someone elsewhere after they type a password;
  `?why=` only picks a fixed sentence (`spec/login.test.ts`).
- A poster's own vote and repeated votes do not count towards the
  three-person correction quorum. One person means one account.
  Stock reports are limited to one per account per post per minute.
- Store prices as integer cents and display dollars. Date boundaries
  use Canberra's date.
- Every change someone asks for (a POST to `/api/`, except the page's own
  `/api/watch` and `/api/notifications`) writes one JSON action line to
  stdout through `server/log.ts`: the account behind the session cookie,
  what they did, to which post or comment and whose, and the answer,
  refusals included. Read it with `mise exec -- flyctl logs -a
  comp4020-final-hhhfff-hhhfff`. A new action route calls `act()`. The log
  holds identifiers and fixed words, never a password, hash, session token,
  or a comment's or note's text, and names a login only once it matches an
  account (`spec/log.test.ts`).
- Keep the live protocol aligned with the ADRs in `docs/decisions/`:
  send change signals and identifiers, not full posts or credentials,
  and fetch current data through normal read routes. Cap listeners
  within the small machine's resources; keep notices private.

## Interface and browser checks

- The feed precedes the folded posting form. The map opens by default,
  remembers closing on the device, and stays short enough for the first
  special to remain visible on the first phone screen.
- Guests' cards are read-only; the page explains how to log in, and its
  links to `/login` bring the reader back to where they were.
  Sold-out posts sort after the rest. Show a loading state before data
  arrives.
- Use the marking viewports 390×844 and 1920×1080 in Chrome, setting both
  width and height. Check guests and signed-in users, then 360px and
  400px widths as extra checks. There must be no horizontal scroll.
  Check live behaviour with two independent sessions side by side.
- Previous browser checks found plain headless Chrome below roughly
  500px could lay out wider than requested. Verify the actual viewport
  and use DevTools protocol control. DOM dumps and virtual-time waits
  previously failed to finish with the live stream open. Close each
  test tab afterwards so it releases its live connection.
- Form controls must not shadow built-in form or collection properties.
  The old `item` field broke Post; `spec/forms.test.ts` protects this.
- `/readme/` serves the complete README; its headings are checked by
  `spec/invariants.test.ts`.

## Further instructions

- Test execution, identities and isolation: [spec/README.md](../spec/README.md).
