# Crit 10 reflection

> **Draft for the owner to review.** Claude drafted this at the owner's
> request on 20 October 2026, from the repo history and that day's session.
> It stays a draft until the owner has reviewed it and rewritten it in their
> own words. It does not describe the crit, which has not happened yet.

## What was the breakthrough that moved the work forward?

The breakthrough was finding out that the server could not tell me who did
what. Accounts and server-side permissions had been in place since
[`734aa4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/734aa4a),
and the tests showed that one person could not delete another's post. But
when I had the app checked against the crit 10 brief, `flyctl logs` on the
deployed app showed only the machine starting and `listening on
0.0.0.0:8080`. Once two classmates used it, I would have had nothing to
narrate from.

Each change someone asks for now writes one line: who, what, to whose post,
and the answer
([`cc22dab`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/cc22dab)).
Refusals are logged too, so "bob tried to delete alice's post and got a 403"
shows up. The new test caught a gap on its first run: a stock report did not
say whose post it was. The log also needed a privacy rule: a failed login
names an account only if one matches, because a mistyped username can be a
password typed into the wrong box.

## What did this work change about who I want to be as a software developer?

I want to judge the app by what someone watching it from outside can see,
not only by what passes inside. The permission tests were green, yet nothing
showed which person had acted. I also want to decide what a log may hold,
not only what it records.
