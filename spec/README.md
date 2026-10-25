# The spec

The [final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/)
and its spec are on the course website, along with the specs for crits 8, 9 and
10, which run in this repo. The brief poses the problem; the spec is the fixed
contract.

## What ships

`invariants.test.ts` checks the two things the course relies on:

- `/` answers with a 200, which is what the deploy and the crit capture read
- `/readme/` publishes `README.md`. Markdown renderers all differ slightly, so
  it checks the README's headings rather than every word: each one has to
  appear, in order, in the HTML the server sends, since no script runs. Render
  it however you like, as long as it's there in full; the marker reads it there.

Both run against the **running** app over HTTP, so they hold whatever it's built
with. In CI that app is the image your `Dockerfile` builds, started with a
throwaway `/data`, and a red run blocks the deploy. Locally, `pnpm check`
starts the app itself on a throwaway data directory and removes it after, so
test posts never reach the data you browse; set `APP_URL` to test an app you
started instead. Keep them; don't delete them.

## Your checks

### Running and isolating tests

- With no `APP_URL`, `pnpm check` starts a temporary app and data directory,
  sets `ADMIN_USERS=spec-admin`, and removes them afterwards. No existing
  app needs to be running. Never run writing tests against `.localdata` or
  the app on port 8080 that the owner browses.
- With `APP_URL`, tests target that app. Use a throwaway instance; admin
  tests additionally need `SPEC_ADMIN_USER` naming one of its admins. Do
  not point it at the live site: a run there once left 18 test specials in
  the real feed, because setup in a skipped `describe` body still runs.
- Put writes inside a test or a `beforeAll`, gated by `writes`, never in a
  `describe` body or at the top of a file. Against anything but a local
  address, `spec/no-writes.ts` turns any write into a failure.
- Obtain test accounts through `person()` in `spec/api.ts`; identity in
  request bodies is ignored.
- Spec files run concurrently against one app. Assert about the data your
  test controls, use unique items and isolated stores where needed, and do
  not assume unrelated posts stay unchanged. A map test once misdiagnosed
  another spec's legitimate deletion as an app failure.
- Behaviour changes need relevant checks in the same commit. Diagnose a
  failing test before fixing it; correcting a faulty assertion is allowed,
  but removing a valid product requirement just to get green is not.

### Scope

Everything else in `spec/` is yours to write. Any `spec/*.test.ts` runs with
`pnpm check`, against the same running app. Some lines of a spec only a person
can judge; those are left to the crit and the marker.

At a crit, a green `check` job is half the shipped mark, but it's never the
judgement of the work: your tutor checks what you deployed against the published
spec.
