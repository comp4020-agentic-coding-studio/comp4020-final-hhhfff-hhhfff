# Rules for the agent

discountShow helps students decide whether a local discount is worth the walk.
`README.md` defines what good means. Keep the app, rules and checks consistent
with that argument; ask the owner before changing it.

## What the app must never do

- Mislead readers: a special must be cheaper than its usual price, and the
  same item at the same store must not have conflicting live posts, including
  concurrent posts and corrections.
- Let people act as someone else: identity comes only from the session
  cookie, never a request body or public user ID. Guests read but cannot
  write; check permissions on the server (`spec/accounts.test.ts`).
- Give anyone admin rights through the API. Admins come only from
  `ADMIN_USERS` (`spec/admins.test.ts`, `spec/accounts.test.ts`). Only the
  poster or an admin can delete a post (`spec/delete.test.ts`).
- Expose passwords or password hashes in any response, or session tokens
  in response bodies or events. Session tokens belong only in the protected
  session cookie (`spec/specials.test.ts`, `spec/accounts.test.ts`).
- Broadcast full posts or credentials through `/api/events`: send event
  types and identifiers, or payload-free signals; keep connection identifiers
  and notices scoped to their connection or owner. Read data through normal
  routes (`spec/live.test.ts`, `spec/presence.test.ts`).
- Trust unvalidated input or treat user text as executable markup. Use
  parameterised SQL and `textContent`, never `innerHTML`, for user text.
  Check this when reviewing rendering changes; no dedicated injection test
  currently establishes this guarantee. Follow the binding
  [development rules](docs/development.md#data-and-security).
- Let one person's repeated actions count as several people's agreement.
  Preserve the correction and reporting rules in the README.
- Lose persistent data on restart or redeploy, or let tests modify the data
  the owner uses.

## What the pages must hold to

- Put finding useful discounts first: with the map open, the first special
  must be visible at 390×844. Preserve the feed and map behaviour in
  [the interface rules](docs/development.md#interface-and-browser-checks);
  make stock and freshness understandable. The first-screen layout requires
  an observed browser check; `spec/pages.test.ts` checks feed pagination
  and ordering, not this layout.
- Keep visible information current without disrupting reading or unfinished
  input. Preserve the live channel's privacy and resource limits.
- Make guest and signed-in behaviour clear, including loading, empty, error
  and disconnected states.
- Check UI changes at 390×844 and 1920×1080, with extra checks at 360px and
  400px, as a guest and signed in. Keep the full README available at `/readme/`.
  Follow [Development notes](docs/development.md) for browser checks.

## Design before building

- Size the change first ([plan sizes](docs/plans/README.md#size-first)).
  Bug fixes, wording, local styling and refactors that preserve behaviour
  need no plan. Other changes to what readers see or can do need a brief
  plan; identity, privacy, multi-user behaviour, the API or stored data
  need a full one.
- Only the `designer` subagent writes plans, from the owner's request in
  the owner's words. Don't write a plan yourself or have another agent
  stand in for the designer.
- Build only from the approved version. Do not approve it yourself or
  change its design while building; if it proves wrong, stop and return to
  the owner. Follow [the plan workflow](docs/plans/README.md) for approval,
  revisions and Built evidence; a merged PR alone does not establish that a
  feature is good.

## Check and learn

- `pnpm check` must pass before a commit; `pnpm check:evidence` must pass
  before a crit cutoff. Use isolated test data as described in
  [spec/README.md](spec/README.md).
- Behaviour changes need relevant checks in the same commit. Diagnose whether
  a failure is in the app or the test. Never weaken a valid requirement just
  to pass; explain the evidence for any test correction.
- Turn consequential mistakes and owner corrections into a lasting rule,
  test or referenced note. Check the real page when the claim concerns
  how someone uses it, rather than relying only on API results.

## Working boundaries

- Keep the deployment within one 256 MB machine and its persistent volume.
  Do not edit `fly.toml`; keep Docker working. Ask before adding dependencies.
- Use small commits explaining why. Changes reach `main` through PRs,
  merged with a merge commit after CI passes; check the deployed site.
  Preserve history.
- Update the README when its promises change. PROCESS and reflections are
  the owner's account. Do not independently author their personal judgements.
  If the owner explicitly requests a draft or rewrite, label it as assisted
  work requiring their review; never invent experience or acceptance.
