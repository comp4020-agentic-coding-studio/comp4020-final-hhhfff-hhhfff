# Process overview

## Crit 8: starting from something I had seen

The idea came from working at Daily Market. Some discounts happen when
stock is close to expiry, rather than through an advertised promotion.
Someone already in the shop sees the markdown; someone nearby who would
buy it might never hear about it. I wanted a website where students could
share these local discounts before they disappeared.

I looked at supermarket specials pages, Xiaohongshu and PetrolSpy. The first
two helped identify the gap: chain catalogues
cover their own shops, while social posts scatter information. PetrolSpy
provided an example of people reporting prices for others
([`db68982`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/db68982)).
I did not survey anyone beyond my friends. Participation remains an open
question, especially when updating a post takes effort during a shopping trip.

The agent built the first version with posting, stock reports and comments
([`ed91c9d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/ed91c9d)).
It used Node and TypeScript, SQLite, and plain HTML and JavaScript. I kept
this stack because it suited one small machine and a persistent volume,
without a separate database service or frontend build. The cost is more
manual work managing the page as interactions grow.

The first important correction was basic: the API worked,
but the Post button did not. A field named `item` conflicted with a browser
property. The fix included a test against reserved form names
([`715272d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/715272d)).
The initial checks covered requests but missed the broken page interaction.
The naming test now protects that specific failure; browser checks still
need to cover the action itself.

## Deciding what makes a discount useful

Once posting worked, I needed a stronger purpose than collecting bargains.
A wrong price or an empty shelf could cost someone a trip. My definition
of good became whether a student could trust a post enough to walk to the
shop. That gave me a reason to prioritise duplicate refusal, confirmations
and corrections over adding more ways to post
([`3b99c52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3b99c52)).
It also explained why the feed should come before the posting form
([`f0dd697`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/f0dd697)).
That work also exposed a security fault: the public user ID was the
credential. The same commit separated them. It was a lucky catch during
feature work, rather than evidence of a thorough initial security review.

I initially favoured a nickname and browser-held key to make contributing
easy. But the correction rules counted people, and changing browsers created
another identity. Accounts made the same login count consistently across
browsers, at the cost of registration
([`734aa4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/734aa4a)).
They still cannot guarantee that one person has only one account. Likewise,
requiring three matching corrections protects a poster from one person's
changes, but may leave an error unresolved when few people participate.

I also changed my position on photos. I had left them out because uploading
added effort and the app could not verify them. An optional shelf-tag photo
nevertheless gives readers evidence about the item and price. The revised
feature keeps uploading optional, removes metadata and allows reporting
([`02fda88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/02fda88)).
Readers still have to judge whether the photo matches the current offer.

## Good at neighbourhood scale

I want to focus on shops that students near ANU actually visit. My experience
at Daily Market gives me a reason to start there, rather than trying to cover
every supermarket. Ben Hoyt's
[The small web is beautiful](https://benhoyt.com/writings/the-small-web-is-beautiful/)
was added later as a reference. His emphasis on fewer moving parts and useful
content fits this scope: the important information here is the price, the
shop and whether anything is left.

But being small also causes a problem. Three matching corrections may be
reasonable when many people participate; with only a few users, a wrong
price could stay there for a long time. I have not tested this rule with
real traffic. Before extending the site further, I need to see whether
people will keep even this local feed up to date.

## Crit 9: keeping information current without moving the reader

Real-time updates mattered because stock could change while someone was
deciding to leave. SSE lets the server signal a change and the page fetch
the affected post through the ordinary read route
([`d206304`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/d206304)).
I kept this approach because notifications mainly travel from server to
reader. It avoids a separate bidirectional protocol, but requires follow-up
reads and catch-up after disconnection. [ADR 0001](docs/decisions/0001-multi-user-decision.md)
records the alternatives and limitations.

The more interesting choice was what the reader should experience. Updating
a visible price or stock report helps prevent a wasted trip. Automatically
inserting new posts at the top can move what someone is reading. New posts
therefore wait behind a notification button
([`b089362`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/b089362)).
Readers can overlook that button.

My own post then briefly appeared as a new post waiting to be loaded:
its live event could arrive before its publishing response. The fix came
with a test that deliberately reproduces that order
([`f1d0a20`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/f1d0a20)).
The regression test checks those messages together.

## Changing how I direct the agent

Early rules were written after implementation
([`790f86a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/790f86a)).
The new ban on `innerHTML` conflicted with existing markup construction;
the code was changed to match the rule
([`a67df84`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/a67df84)).
Later corrections made them more useful. Tests had filled the data I browsed
with test posts; they now run on a temporary app, and `CLAUDE.md` forbids
writing into that everyday data
([`3570400`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3570400)).
Another failure was in the test: a map check mistook another test's deletion
for an unwanted update. The test guidance now requires assertions about
the test's own data
([`efd6d41`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/efd6d41)).

I added a designer to see the options before implementation and decide
whether a feature was worth building
([`940ec65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/940ec65)).
Plans needed my approval, and review added version-specific approval and
completion evidence
([`7719ccc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/7719ccc)).
A tested hook limited where the designer could write
([`0d7351b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/0d7351b)).
The [recorded session check](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/blob/62f8856/docs/plans/README.md#what-stops-the-designer-writing-elsewhere)
on 14 October confirmed that restriction.

After trying it, I noticed replies took much longer. Each change went from
the main agent to the designer, which read the project and wrote a plan;
the main agent then read and summarised it before starting. I was waiting
through that process even for changes in a small project. The two trial
plans were deleted without being built
([`ee101ce`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/ee101ce)).
I decided the extra waiting was not worthwhile and removed the designer
the same day
([`3ae14b5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3ae14b5)).
One agent now handles design and implementation. The product rules, tests
and browser checks remain, and the choice of what to build remains mine.

## Towards crit 10: checking the idea with other people

Accounts and server-side permissions exist, but the logs currently show
startup and errors rather than a complete account of who did what. I still
need that logging and the exercise where two classmates use only the URL
while I follow their actions from the logs.

The two-classmate exercise will check independent use and identifiable
actions. I also need to see whether students will trust the information
enough to walk to a shop and contribute updates. That broader observation
has not yet happened.
