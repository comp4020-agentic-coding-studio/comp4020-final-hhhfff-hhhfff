# Plans

A plan says what a feature should be before any code exists: who it is for,
what each kind of reader sees, what it must not do, and how we will know it
works. It is written by the `designer` subagent (`.claude/agents/designer.md`)
or by hand, and **approved by me** before building starts. The building agent
works from the approved plan and does not redesign as it goes.

Plans sit beside the other records:

- `README.md` argues what "good" means. A plan must serve one of its rules.
- A plan (here) is written **before** building: what it will be.
- An ADR (`docs/decisions/`) is written **when** a lasting choice is made:
  what was chosen, what was given up, and why.
- `spec/` holds the tests. A plan's **automated** acceptance lines each
  become one; its **observed** lines are checked by a person and recorded.

## What stops the designer writing elsewhere

Not only its instructions. Its definition gives it no shell (Bash or
PowerShell) and no Edit tool, and a PreToolUse hook in its frontmatter runs
`.claude/hooks/designer-write-guard.mjs` before every write: anything outside
`docs/plans/` is refused, and so is any call the hook can't read, or the hook
failing to start (`onFailure: block`). `spec/designer-guard.test.ts` checks
the hook and that wiring.

What that does not cover, stated plainly:

- Claude Code runs a project subagent's frontmatter hooks only in a folder
  whose workspace trust I have accepted, and never in a `claude -p` session.
  There, only the instructions and the missing tools hold.
- The test runs the hook directly. That Claude Code calls it for a real
  designer session has to be seen once by hand: ask the designer to write
  outside `docs/plans/` and check it is refused.
- It guards the designer only. The building agent can write anywhere, as it
  must; "build only from an approved plan" stays a rule it is told.

## When a plan is needed

A new feature, a change to what readers see or can do, or a change to the
API or stored data. Not for a bug fix, a wording fix, or a refactor that
changes no behaviour.

## Status

Each plan has one of:

- **Draft**: the designer's proposal; nothing is built from it.
- **Approved**: I have read it, changed what I disagreed with, answered its
  open questions, and approved one exact version of it (below).
- **Built**: shipped, with the evidence below. A merged PR alone is not
  evidence that the feature does what the plan said.
- **Dropped**: decided against, with why. Kept, because what was discarded
  is evidence of judgement too.

## Approving one exact version

Approval is for the plan as it stood, not for whatever the file says later.

1. I edit the draft myself: answer the open questions, change what I
   disagree with, and fill in "Approval" in the plan (date, and what I
   changed from the designer's draft). Status becomes `Approved`.
2. I commit that, alone, with a message starting `Approve plan NNN:`. That
   commit's hash *is* the approved version. (The hash can't be written in
   the plan itself, since writing it would change the plan.)
3. The PR that builds it names that hash: "Builds plan NNN as approved in
   `<hash>`".
4. Before building, and again before merging, check nothing changed since:

   ```sh
   git diff <hash> -- docs/plans/NNN-name.md
   ```

   While building, this must print nothing. When the plan is marked Built,
   it may show only the status line and lines under "Built evidence".
   Anything else means the plan changed after approval: building stops
   until I approve the new version (a new `Approve plan NNN:` commit), and
   the change is described under "Revisions".

## Built: what counts as evidence

Marking a plan Built fills in "Built evidence" in the plan:

- the PR, and the approval commit it built from;
- automated: the `pnpm check` result (files and tests), and each automated
  acceptance line's test, named;
- deployment: the CI run that deployed it, and a check of the live site
  showing the feature there;
- observed: for each observed acceptance line, what was looked at, where
  (viewport, guest or signed in, deployed or local), when, and what was seen;
- my judgement: did it do what the plan was for? What surprised me, and what
  I'd change next. Written by me, not the agent.

## File names

`NNN-short-name.md`, numbered in the order written: `001-map-pulses.md`.

## Template

Copy this into a new file. Leave no section empty: write "none" and say why.

```markdown
# NNN. <Feature name>

- **Status:** Draft | Approved | Built | Dropped (<why>)
- **README rule served:** <number and name, quoted>
- **Asked for by:** <me, a crit comment, a user, a measurement>

## Problem

What a reader can't do, or gets wrong, today. Concrete: who, where, when.

## What the reader sees

For each, what is on screen and what they can do. The course marks at
390×844 (phone) and 1920×1080 (desktop) in the latest Chrome; 360 px and
400 px are extra phone checks.

- Guest at 390×844 (and 360 px, 400 px)
- Signed in at 390×844
- Guest and signed in at 1920×1080
- Admin, if it differs
- Real-time: what a second session, open beside the first, sees and when

And each state: loading, empty, error, live connection lost, sold out.

## Rules it must keep

Which lines of CLAUDE.md "must never do" and "pages must hold to" this
touches, and how it keeps them (ids only on the live stream, server-side
checks, 256 MB, no new dependency, form field names, specials first on the
page, ...).

## Out of scope

What this deliberately does not do, and why.

## Options considered

At least two, with what the reader would see and the cost of each. The
recommended one first.

## Acceptance

**Automated**: each becomes a test in `spec/`, over HTTP or in the page
(`spec/page.ts`). Name the file.

- [ ] ...

**Observed**: what only a person can judge, each with where to look
(viewport, guest or signed in) and what counts as passing.

- [ ] At 390×844 and 1920×1080, guest and signed in: ...

## Open questions

What I must decide before approval.

## Approval

Empty in a draft. Filled in by me: date, and what I changed from the
designer's draft and why. The commit that fills this in starts
`Approve plan NNN:`.

## Revisions

Changes after approval: date, what, why, and the new approval commit.

## Built evidence

Empty until Built. See "Built: what counts as evidence" in
`docs/plans/README.md`.
```
