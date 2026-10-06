# Rules for the agent

This is discountShow: a multi-user app where students post supermarket
specials near ANU and keep them honest. `README.md` argues what "good"
means; the rules below follow from it. If a change conflicts with the
README, stop and say so rather than picking one.

## Run and check

- Start: `PORT=8080 DATA_DIR=.localdata node server/server.ts`
- `pnpm check` (typecheck + `spec/` tests against the running app, at
  `APP_URL`, default `http://localhost:8080`) must pass before any commit.
- To run the admin test too, start the app with `ADMIN_USERS=spec-admin` and
  run `SPEC_ADMIN_USER=spec-admin pnpm check`; without those it is skipped.
- `pnpm check:evidence` must pass before a crit cutoff.
- Node 24 runs the TypeScript directly; there is no build step. The only
  runtime dependency is `marked`. Don't add dependencies without asking.
- The app must fit one shared-cpu-1x machine with 256 MB. Persistent data
  lives only in SQLite under `DATA_DIR` (`/data` on Fly). Don't edit
  `fly.toml`, and keep `Dockerfile` working.

## What the app must never do

- Show a "special" that isn't cheaper than the usual price. Enforce on the
  server, including when applied through a correction.
- Allow two live posts for the same item at the same store.
- Reveal anyone's password, password hash or session token in any response,
  or let a public id (the user id shown on posts) stand in for a session.
- Let a guest (no valid session) change anything. Identity comes only from
  the session cookie, never from the request body; permissions come from the
  role table in `server/auth.ts` and are checked on the server, not just by
  hiding buttons.
- Let anyone but the poster, or an admin, delete a post. Roles are guest,
  user and admin; admins come only from the `ADMIN_USERS` environment
  variable, never from the API.
- Trust client input. Everything goes through the validators in
  `server/server.ts`; SQL uses parameters only; user text is rendered with
  `textContent`, never `innerHTML`.
- Count a poster's own vote, or one person's repeat votes, towards the
  three-person correction quorum. One person is one account.
- Let one account report a post's stock more than once a minute.
- Put anything but ids on the live stream (`/api/events`): the page fetches
  the deal itself, so what it sees is decided by the normal read routes.
  Cap its listeners; the machine has 256 MB.
- Lose data on restart or redeploy.

## What the pages must hold to

- Specials come first on the page; the post form stays folded. A guest sees
  the feed and a prompt to log in, and the write buttons ask them to.
- Works at phone width (~400px) and desktop, with no horizontal scroll.
- Prices are integer cents in storage, dollars in display. "Today" is
  Canberra's today.
- No form field may be named after a built-in form property (`item` was
  once such a name and silently broke Post; see `spec/forms.test.ts`).
- `/readme/` must serve all of `README.md`; its headings are checked.

## Changes must not break

- Every test in `spec/` stays green. A change to behaviour comes with a new
  or updated test in `spec/*.test.ts`, written against the running app over
  HTTP, in the same commit.
- Fix the code, not the test. Only loosen a test when the README's argument
  has changed, and say why in the commit message.
- When a correction comes from the user, record it here (or in `spec/`) so
  it isn't repeated; don't just retry until green.
- Tests get an identity from `person()` in `spec/api.ts`, which registers a
  real account. Don't put an identity in a request body; it is ignored.
- Don't write Python for edits here: on this machine `python` is only the
  Windows Store stub and silently does nothing. Use the Edit tool or node.

## Working style

- Small commits, one idea each, with a message saying why. The history is
  process evidence: don't squash or rewrite it.
- Keep `README.md` truthful: when you add or remove a promise (real-time
  push, logging), update the enforced/judged section in the same change.
- Don't write `PROCESS.md` or the `reflections/` files for the user; they
  must be the user's own account.
