# Crit 9 reflection

## What was the breakthrough that moved the work forward?

The breakthrough was deciding what a live update should do for the person
reading, rather than just making the server push data.

For discountShow, a sold-out report matters before a student starts walking.
But inserting every new special at the top moves the cards under someone
already reading. I separated these cases: changes to visible posts refresh
those cards, while new posts wait behind a button. The decision record in
`docs/decisions/0001-multi-user-decision.md` explains why the stream carries
small change signals and the page fetches the post through its normal read
route. That keeps the live channel simple and avoids duplicating access rules.

The useful failure was my own new post briefly appearing as "1 new special"
waiting to be loaded
([`f1d0a20`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/f1d0a20)).
The live event could arrive before the response to posting. Fixing it meant
reasoning about two valid messages arriving in an unexpected order, then
writing a test that deliberately delivers them in that order. Testing each
endpoint separately would not have caught it.

## What did this work change about who I want to be as a software developer?

I want to be able to explain the cost of a decision, including one that works.
The new-post button protects reading position, but someone can miss it. Small
events avoid sending whole posts to every listener, but a visible change needs
another request. These are choices I need to judge, not details to leave to
the agent.

The next check should be with people outside my friends. Tests can establish
that an update arrives; they cannot establish that a student notices it or
trusts it enough to make the trip.
