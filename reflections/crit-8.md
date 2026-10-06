# Crit 8 reflection

## What was the breakthrough that moved the work forward?

Two things, one technical and one about the idea.

The technical one was the silent Post button
([`715272d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/715272d)).
The first working version passed everything the agent had checked, yet in the
browser pressing Post did nothing. The cause was a form field named `item`,
which collided with a built-in form property. The fix was small, but what
mattered was what came after it: a test that fails if any field takes the name
of a built-in, and a rule in `CLAUDE.md`. A bug stopped being something to
retry past and became something the harness now refuses to let back in.

The second was deciding what "good" means. I had been treating the app as a
feed of specials. Then I put my own job at Daily Market into the argument:
small shops mark stock down on the spot as it nears expiry, have no website,
and sell out fast. That turned the question from "is it a nice site" into "can
a student trust one post enough to make the trip", and it explained why
duplicates, crowd corrections and stock reports were the features that
mattered.

## What did this work change about who I want to be as a software developer?

I want to start from a problem I have seen up close and check it against the
real app, not accept "it passes" as the end. Writing the rule down so the
agent can't repeat the mistake is now part of fixing it.
