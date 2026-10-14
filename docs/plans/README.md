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
- `spec/` holds the tests. Every acceptance line in a plan becomes one.

## When a plan is needed

A new feature, a change to what readers see or can do, or a change to the
API or stored data. Not for a bug fix, a wording fix, or a refactor that
changes no behaviour.

## Status

Each plan has one of:

- **Draft**: the designer's proposal; nothing is built from it.
- **Approved**: I have read it, changed what I disagreed with, and signed it
  off with the date. Building may start.
- **Built**: shipped, with the PR and commits linked.
- **Dropped**: decided against, with why. Kept, because what was discarded
  is evidence of judgement too.

If building shows the plan was wrong, building stops, the plan is changed
(and approved again), and the change is noted under "Revisions".

## File names

`NNN-short-name.md`, numbered in the order written: `001-map-pulses.md`.

## Template

Copy this into a new file. Leave no section empty: write "none" and say why.

```markdown
# NNN. <Feature name>

- **Status:** Draft | Approved (<date>, by <me>) | Built (<PR link>) | Dropped (<why>)
- **README rule served:** <number and name, quoted>
- **Asked for by:** <me, a crit comment, a user, a measurement>

## Problem

What a reader can't do, or gets wrong, today. Concrete: who, where, when.

## What the reader sees

For each, what is on screen and what they can do:

- Guest, phone (360 px and 400 px)
- Signed in, phone
- Desktop
- Admin, if it differs

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
chosen one first.

## Acceptance

Each line checkable, and each becomes a test in `spec/` (or, for something
only a person can judge, a named manual check at given widths):

- [ ] ...

## Open questions

What I must decide before approval.

## Revisions

Changes after approval, with the date and why.
```
