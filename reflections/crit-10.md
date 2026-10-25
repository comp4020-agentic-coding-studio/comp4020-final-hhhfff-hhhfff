# Crit 10 reflection

## What was the breakthrough that moved the work forward?

During the crit, two classmates tried posting and commenting. I could see
updates on my side when they added posts or comments, and when they changed
the remaining stock.

One classmate pointed out something awkward about the layout. The cards
were aligned in rows, so expanding the left post created a matching blank
area in the right one. I accepted the suggestion and changed the feed to a
waterfall layout
([`288445e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/288445e)).
Opening a card now pushes down the cards below it in the same column.
Giving up the aligned rows made that interaction more useful.

Preparing for the crit also exposed a gap in the logs. Accounts existed,
but startup messages could not explain who had acted. The action log now
records the account, action, affected object and response, including
refusals
([`cc22dab`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/cc22dab)).
The tests check those records without exposing passwords, tokens or comment text.

## What did this work change about who I want to be as a software developer?

I want to pay closer attention to what people actually do with the page.
The shared updates worked in this exercise, but a classmate still found
an interaction worth changing. That gave me a specific problem to fix.
When checking a layout, I want to open the comments and use the controls,
rather than judge it from the unopened cards alone.
