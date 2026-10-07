# Process overview

This describes the project as it stands on 6 October 2026: a deployed first
version, a README that argues what "good" means, and a harness that is newer
than the code it governs. I say where that order cost me. Three corrections
from 7 October are added to the correction loop below.

## From the brief to an idea

The brief asks for a multi-user, real-time, persistent site that is good, and
leaves "good" to me. I did not start from a stack. I started from where I
work. Daily Market is a small Asian grocer near ANU with no website. When
stock nears its expiry the shop marks it down on the spot, with no notice,
and sells out fast. Students who would take the bargain have nowhere to look,
and the big chains' catalogues do not cover shops like this. That became the
app, discountShow, and it fixed what "good" had to mean: a student can trust
one post enough to walk to the shop. The README argues this, and each rule in
`CLAUDE.md` is derived from it.

The grounding is thin and I say so. I looked at the big chains' specials
pages, Xiaohongshu, where bargains turn up by chance and scattered, and
PetrolSpy, where drivers report fuel prices on a map, which showed me
strangers will keep prices current. I added these to the README after the
first draft
([`db68982`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/db68982)).
I did not survey anyone beyond my friends.

## The stack and why

The server is Node 24 running TypeScript directly, with `node:sqlite` on the
Fly volume. The client is plain HTML and JavaScript with no build step. The
only runtime dependency is `marked`, for `/readme/`.

I chose this because the host is one 256 MB machine and the course watches
that shape. With no bundler, no framework and no separate database, there is
little for the agent to get wrong and little to keep running. The cost is
that I hand-write what a framework would give: `public/app.js` is 750 lines
of DOM code, and live updates, which a framework or a socket library might
ease, will be written from scratch. I judged that acceptable for a small
app. Whether it stays acceptable is something the real-time work will test.

## How the agent worked

The agent first built the whole app in one pass
([`ed91c9d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/ed91c9d)):
a server, a client, twenty shops taken from OpenStreetMap, and one test that
a stranger's post is still there for the next visitor. It was checked through
the API with curl. It was not clicked in a browser.

That is how the Post button shipped doing nothing
([`715272d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/715272d)).
A form field called `item` collided with a built-in form property, and the
handler threw silently. The fix was one word. The correction that counts is
what came with it: a test, `spec/forms.test.ts`, that fails if any form
control takes a built-in's name, shown red on the old markup before going
green. After that, commits say they were driven in headless Chrome before
committing.

## What the correction loop looked like

The next commit changed the product, not only the code
([`3b99c52`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/3b99c52)).
Posting the same special twice made two identical posts, which breaks the
trust argument. The commit adds duplicate refusal, a side-by-side check
against close matches, confirmations, and a correction that applies once
three different people propose the same value. Doing this exposed a security
fault: the id shown in every API response was also the credential, so anyone
could act as anyone. Browsers now send a secret key and the server stores
and shows only a hash prefix, and a test asserts the key never comes back.
That was found while building a feature, not by a check I had written ahead
of time, and I count it as a lucky catch rather than a process that works.

Two smaller changes followed: poster-only delete, which hides rather than
removes, with its own tests
([`541a627`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/541a627)),
and a layout pass because the post form pushed the specials below the first
screen
([`f0dd697`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/f0dd697)).
The layout pass followed the README's logic, not a fashion: the thing a
hungry reader came for goes first.

Three later corrections, on 7 October, came from using the app myself.

Searching for "cola" listed every Coles post
([`44ccbd9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/44ccbd9)).
The search I had accepted let a four-letter word match with a letter off,
so "cola" matched "cole", and it matched inside words, so it also found
"chocolate". Short words now never allow a slip, Latin words match only from
the start of a word, and a near-miss spelling is shown only when nothing
matches as typed. A test now checks that "cola" finds the cola and nothing
else. My tests had checked that a typo was forgiven, not that forgiving one
could go wrong.

Search also felt slow while typing
([`eb77673`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/eb77673)).
Profiling in Chrome at a 4× CPU slowdown showed the server answering in
milliseconds; the cost was the page rebuilding and laying out about 200
cards for every result, which blocked typing for about 200 ms. The page then
put a few cards on screen at a time and reused cards it had already built,
which brought the longest block to about 50 ms. That scroll-to-load-more was
later replaced by numbered pages of ten, because one page held too many
posts
([`ad4dea9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/ad4dea9)).

When I asked whether the app needed to handle high concurrency, the answer
came from a measurement rather than a guess
([`6ccc571`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/6ccc571)).
On a throwaway copy with 1,000 live posts, page one served 270 requests a
second and a search 121, with no errors: far more than students near one
campus would send, and the app cannot add machines anyway, since its data is
one SQLite file on one 256 MB volume. Two costs did grow with the feed, so I
fixed those instead of the architecture. The server now keeps its sorted
lists until a write changes them (page one rose to 523 requests a second, a
repeated search to 542), and a live event makes only the pages showing that
post fetch it, with page-one reloads spread over two seconds. A search that
differs every time is still about 123 a second.

## What I did late, and the cost

`CLAUDE.md` was empty through all of that. I only wrote the rules, and the
README argument they come from, on 6 October
([`790f86a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/790f86a)).
So the agent built five commits against rules that lived in my head and in
the session, and the Post bug is the visible price of that. Writing the
rules afterwards also turned up a mismatch: I had written "never use
`innerHTML`", and `public/app.js` used it in two places, on fixed strings.
They were safe, but the rule and the code disagreed, so I changed the code
([`a67df84`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-hhhfff-hhhfff/commit/a67df84))
rather than weaken the rule. The harness is now ahead of the next change, and
the next change is where I will see whether it holds.

I used the agent to draft the README, the rules and a first reflection. I
treat these as drafts. Each makes claims about me, such as my job and what I
learned, that only I can confirm, so I check and rewrite them before they
count as mine.

## Where this stands against the brief

Not met yet: real-time updates and server-side logging. Both are later crits.
Today a page shows what was true when it loaded. The deployed app persists
posts across restarts on the volume, and identity is a nickname plus a
secret key, so different people are told apart without accounts.

## "Good at small scale"

The reading I take is that a small app can be good by being right for a few
people, not by being general. discountShow serves one neighbourhood of about
twenty shops. That helps me: a student at the shop is the best possible
source for that shop's markdown. It also exposes my main weakness. The
three-person correction rule assumes there are at least three people willing
to correct a post. With few users, a wrong price could sit for a long time,
and the poster is the only person who can fix it at once. I chose three
because one person alone should not rewrite someone else's post, and I have
not tested it with real traffic. I would rather say that than claim the
quorum works.
