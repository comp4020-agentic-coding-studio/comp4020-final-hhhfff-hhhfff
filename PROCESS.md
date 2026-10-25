# Process overview

## Starting from the shop

The idea for discountShow came from working at Daily Market. Some discounts
are decided when stock is close to expiry, without an advertised promotion.
People already in the shop see the markdown; students nearby may never hear
about it. I wanted them to be able to share that information while it was
still useful.

I looked at supermarket specials pages, Xiaohongshu and PetrolSpy
([`db68982`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/db68982)).
Chain catalogues cover their own stores, while social posts scatter local
information. PetrolSpy suggested that people could help keep prices current.
My experience supplied the problem, but I did not survey anyone beyond my
friends. Getting people to contribute regularly remains uncertain.

As the app developed, I settled on a practical meaning of good: could a
student trust a post enough to walk to the shop? Duplicate prices and an
empty shelf would undermine that. Duplicate refusal, confirmations and
corrections followed from this concern
([`3b99c52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3b99c52)).
That work also exposed a public user ID being used as a credential. It was
a lucky catch during feature work, and the commit separated the two.

## Keeping the first version manageable

The agent built the initial posting, stock-report and comment flow with
Node, TypeScript, SQLite and plain HTML and JavaScript
([`ed91c9d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/ed91c9d)).
I kept this stack because one process and one database file suited the
256 MB Fly machine and persistent volume. Ben Hoyt's
[The small web is beautiful](https://benhoyt.com/writings/the-small-web-is-beautiful/)
argues for fewer dependencies and simple architectures, including a small
SQLite-backed site. This fits the technical choice. The cost is manual
coordination of page state and layout. Multiple instances would also need
a different data and event strategy. I have kept the single-machine limit
while actual use remains small.

The first version passed its API checks while the Post button did nothing.
A form field named `item` conflicted with a browser property. The fix added
a reserved-name test
([`715272d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/715272d)).
The naming rule now lives in
[docs/development.md](docs/development.md#interface-and-browser-checks),
with the check in [spec/forms.test.ts](spec/forms.test.ts).
I now check requests and page interactions separately.

Accounts later replaced the browser-held identity because correction rules
count people. The same login now counts consistently across browsers,
although registration adds friction and multiple accounts remain possible
([`734aa4a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/734aa4a)).

## Crit 9: deciding how updates should behave

Stock can change while someone decides whether to leave. SSE signals a
change, then the page fetches the affected post through its normal read
route
([`d206304`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/d206304)).
This fits the mainly server-to-reader traffic without another two-way
protocol. It costs an extra read and requires catching up after a disconnect.
[ADR 0001](docs/decisions/0001-multi-user-decision.md) records the alternatives.

I also needed to decide what should move on screen. Updating a visible
price or stock report is urgent, but inserting new posts at the top can
shift a card under someone reading. New posts therefore wait behind a
notification button
([`b089362`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/b089362)).
Someone can miss that button; protecting reading position has a cost.

A later bug showed my own post as a new special waiting to load. Its live
event could arrive before the publishing response. The regression test
deliberately delivers the messages in that order
([`f1d0a20`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/f1d0a20)).

## Changing the way I work with the agent

Some useful rules came from mistakes. Tests once filled the data I browsed
with test posts, so they now use a temporary app and database
([`3570400`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3570400)).
[CLAUDE.md](CLAUDE.md#what-the-app-must-never-do) now forbids tests from
modifying my everyday data.
Another failure belonged to the test: it mistook another spec's legitimate
deletion for a map error.
[spec/README.md](spec/README.md#running-and-isolating-tests) now requires assertions about
data the test controls
([`efd6d41`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/efd6d41)).
I want failures diagnosed before deciding what to change.

I tried a designer subagent to review options before implementation
([`940ec65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/940ec65)).
But each handover added another project read and a long plan to wait through.
I removed it before any plan was built
([`940ec65...3ae14b5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/compare/940ec65...3ae14b5)).
One agent now designs and implements under the product rules, tests and
browser checks. I choose what to build and review changes through PRs.
Removing the designer did not remove the need to explain a change. The PR
still needs a reason and relevant checks, without a full design document
before every feature.

## Crit 10: checking what other people do

Preparing for crit10 exposed a different gap. Accounts and permission tests
worked, but the deployed logs showed startup messages. I could not follow
someone's actions from those logs.

The action log now records the account, action, affected object and owner,
and response status, including refusals
([`cc22dab`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/cc22dab)).
`spec/log.test.ts` checks two accounts independently: one posts, another
reports stock, and an unauthorised deletion appears with its refusal.
These are automated cases, separate from the classmates' crit exercise.
Logging refusals helps distinguish permission decisions from unexplained
failures, without needing to watch the screen.

Logging also needed limits. Comment text, passwords and session tokens stay
out. A failed login names only a recognised account, because text mistyped
into the username field could be a password. These rules and checks remain
part of development after the crit.

During the crit, two classmates tried posting and commenting. When they
added a post or comment, I could see the update on my side. Changes to the
remaining stock were visible too.

## After crit10: making the feed easier to use

One classmate pointed out that the desktop cards were aligned too rigidly:
expanding the left card created an equally tall blank area on the right.
I agreed that the alignment was wasting space and asked for a waterfall
layout like Xiaohongshu's
([`288445e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/288445e)).
Cards now keep their columns while the same posts remain visible; expanding
one moves only those below it. The DOM keeps newest-first reading order,
and phones retain one column. I gave up row alignment to keep unrelated
cards steady.

The layout test supplies card heights to check placement; browser checks
recorded in that commit cover actual appearance and resizing. Neither
should stand in for the other.

Robin Sloan's [An app can be a home-cooked meal](https://www.robinsloan.com/notes/home-cooked-app/)
describes a family messaging app whose value comes from fitting a specific
group. I take that as a case for treating a small audience as a worthwhile
goal. My choice of ANU comes from working nearby. However, Sloan knows his
users; this feed is open to strangers. Participation and trust need to be
earned, and few contributors make three-person corrections slower. Whether
students will keep the feed reliable remains an open question.
