# 0002. Show how many people are looking, as counts the page asks for

- **Status:** Proposed (implemented, not yet tried with strangers)
- **Date:** 2026-10-14
- **Decided by:** u8113538

## Context

ADR 0001 made an open page hear about changes to the posts on it. It says
nothing about the other people: a reader sees "few left" but not that three
others are eyeing the same markdown, and cannot tell whether the page is
live at all or quietly lost its connection. With several people in the app at
once, both matter to whether a walk is worth it.

Showing who else is here means the server must know what each page shows,
which ADR 0001 deliberately avoided: until now the stream was one-way and
every page heard the same thing. It also brings a privacy question that the
rest of the app does not have. A post shows who posted it, but nobody has
agreed to be seen *reading* one.

## What "good" asks for

README rule 5 ("Gone" arrives before the walk) now promises a badge saying
whether the page is live, and that a post or store says how many others have
it open, as a count, never who. A count is worth having because it changes a
decision: three others on a "few left" post mean hurry, or don't bother.
README rule 2 counts people, not browsers, so a count of people must too: one
person with three tabs is one person.

The same limits as ADR 0001 apply. One 256 MB machine, at most 300 open pages,
and the stream carries only what every listener may see.

## Decision

The stream sends each page, and only that page, a random `hello` stream id
when it connects. The page then says what it shows with
`POST /api/watch {stream, watch}`: up to 20 entries, `deal:<id>` for the cards
on screen and `store:<id>` for the store page. The server accepts a stream id
only from the person who opened that stream (the same session, or no session
for a guest's page), so knowing someone else's stream id changes nothing, and
identity still comes only from the session cookie.

The server works out counts only from the listener list it already keeps. A
signed-in person is one person however many tabs they have; a guest page is
one guest. When a page joins, leaves or changes what it shows, the server
broadcasts a bare `{"type":"here"}` at most every 1.5 seconds, and pages read
the counts from `GET /api/here` (`{here, deals, stores}`, counts only) after a
random 0.2–1.5 s, so pages don't all ask at once. A tab in the background
skips the read and catches up when it is shown again, as the feed does.

On the page, the header badge is amber while connecting, green once live
(with "· N" when others are here), and grey and struck through when the
browser has given up. A card says "👀 N others looking", never counting the
reader; a store's page says "N others looking at this store". Nothing is
stored, so nothing about who looked survives a restart.

## Options considered

| Option | What the user would see | For | Against |
|---|---|---|---|
| A. Page names its stream; bare "here" signal; counts read from `/api/here` (chosen) | Badge and "N others looking" on cards and stores, updating within a few seconds. | Keeps the stream ids-only, as CLAUDE.md requires; one cached count shared by every page; stream id never leaves its own page; counts are just another public read. | One extra POST per change of view and one GET per signal; the stream id is a second secret beside the session that must be checked against it. |
| B. Put the counts in the stream event | Same, a little sooner. | One fewer request per signal. | Breaks the ids-only rule for the stream; every page gets every count, even for posts it isn't showing. |
| C. Say what the page shows in the `/api/events` URL | Same. | No extra POST. | Changing page or store means reconnecting the stream, which drops events in between (ADR 0001's catch-up then reloads the feed each time). |
| D. Show names ("amy and ben are looking") | Who is looking. | More social. | Nobody agreed to be seen reading; it reveals where people shop and when. Against the README's "counts, never who". |
| E. A site-wide chat room | A conversation beside the feed. | Very visibly real-time. | Needs its own moderation, and comments under each post already answer "still there?". |
| F. No presence, only the live badge | Whether the page is live. | Nothing new for the server to know. | Doesn't show that others are in the app, which is the point of a multi-user crit. |

## Costs of this choice

The server now knows, while a page is open, which posts and store it shows,
and for a signed-in page, whose it is. This is kept in memory only and never
logged or stored, but it is more than ADR 0001 held. Counts are public: anyone
can see that two people have a post open, though not which two.

Counts lag by up to about three seconds (1.5 s of coalescing plus up to 1.5 s
of spreading), deliberately. With 300 pages each signal can cause up to 300
reads of one cached object; hidden tabs don't read. The watch list is capped at
20 entries per page, and the cache is rebuilt only after a change.

A person counted as signed-in on one tab and a guest on another is two people,
and the same person on two devices signed in is one. The "here" total in the
badge includes the reader. One process holds the counts, so this, like ADR
0001, would need a shared store if the app ran in more than one.

## How it is checked

Automated checks:

- `spec/presence.test.ts` runs against the app over HTTP: two tabs of one person
  and one of another count as two on a post, and leaving takes them off; guests
  count once per page; the `here` signal is exactly `{"type":"here"}`; the counts
  contain no name, public id, cookie or stream id, and another page's stream
  never carries this page's stream id; a stream id held by another person or a
  guest is refused (404); bad watch lists are refused (400).
- `spec/live-page.test.ts` runs the real `app.js` in jsdom: the badge goes
  connecting, on, retrying and off; a card shows "2 others looking", then "1
  other", then nothing as people leave, never counting the reader; a store page
  says "others looking at this store"; the page sends its stream id only to
  `POST /api/watch`. With the "not counting me" step removed, or the store
  wording reverted to "2 people else looking", these tests fail.

Manually judged, on 2026-10-14 against a throwaway app with four other pages
open: headless Chrome at 360px, 400px and 1280px, as a guest and signed in, on
the home page, a store page and a post's own page. No horizontal scroll; the
header stays at two rows on a phone; the first special still shows on the first
screen. Whether "2 others looking" makes someone hurry, or just feel watched,
has not been tested with strangers.

## Would change if

Revisit if readers find the counts unsettling rather than useful; if a count
is seen to be used to work out who someone is (for example, a store with only
one reader); if the extra reads show up as load; or if the app moves to more
than one process.

## References

- `README.md:32-39` (rule 5 with the badge and counts), `README.md:54-77`
- `docs/decisions/0001-multi-user-decision.md` (the stream this builds on)
- `server/events.ts:20-51` (stream ids, one listener record per page),
  `server/events.ts:63-118` (`setWatch`, `presence`, the coalesced signal)
- `server/server.ts:505-522` (`/api/here` and `/api/watch` validation)
- `public/app.js`, `showLive` and `connectLive` (the badge)
- `public/app.js`, `watchList`, `sendWatchSoon`, `loadPresenceSoon`,
  `paintPresence`, `paintCardPresence` and `onLive` (presence on the page)
- `spec/presence.test.ts`, `spec/live-page.test.ts`
