# 0001. Push small change signals, then let each page refresh safely

- **Status:** Accepted
- **Date:** 2026-10-07
- **Updated:** 2026-10-10 (own-post race fixed in `f1d0a20`)
- **Decided by:** u8113538

## Context

A student may leave discountShow open while deciding whether a markdown is
worth walking to. At the same time, another student in the shop may report that
the item is nearly gone, correct its price, add a comment, or mark it sold out.
A newly posted special can also arrive while the reader is part-way down page
one. If an open page stays as it was when it loaded, the reader may make a wasted
trip. If every change instead rebuilds the whole feed immediately, cards move
under the reader, an in-progress comment or correction can be interrupted, and
many open pages can request the same data at once from the single 256 MB server.

The update channel must work for guests as well as signed-in users because
reading is free. It must not expose a username, password, session token, or
other private data merely because someone can listen. The application is one
Node process with one SQLite file, so the design should fit that small deployment
rather than introduce another service.

## What "good" asks for

README rule 5 says that **"Gone" arrives before the walk**: an open page should
show changes to visible posts and new posts on page one within moments
(`README.md:32-33`). This supports the larger standard that a student can
"trust a single post enough to walk to the shop for it" (`README.md:15-18`).

Those goals pull toward fast automatic updates. The same README also describes
a small, neighbourhood-scale service and caps live watching at 300 pages
(`README.md:71`). That pulls against a heavier two-way protocol or sending full
post data to every listener. The interface should make changes noticeable
without taking control of the feed away from someone who is reading or typing.

## Decision

Use one Server-Sent Events (SSE) connection per open page. The server sends only
an event type and, where relevant, a post ID: `new`, `deal`, `deleted`, or a
private `notice`. A page that is displaying the changed post fetches it through
the normal read route and replaces only that card; it does not fetch changes to
posts on other pages. A new post on page one produces an "N new specials" button
so the reader chooses when to reload and does not get pushed down the feed.
A deleted post's card disappears at once; only the refill, the next post moving
up to keep the page full, waits a random delay of up to two seconds, coalescing
multiple events. Corrections intended for a poster use the same connection but
are sent only to that signed-in user's listeners.

The stream is available to guests, carries no post or credential payload, sends
a heartbeat every 25 seconds, and asks browsers to reconnect after three
seconds. On reconnection, and whenever a hidden tab becomes visible, the client
reloads the feed and notices to catch up on events that may have been missed.
If `EventSource` is unavailable, the visibility refresh remains as a fallback.
The server refuses listeners beyond 300 rather than exhausting the small
machine.

## Options considered

| Option | What the user would see | For | Against |
|---|---|---|---|
| A. SSE signals plus ordinary reads (chosen) | Visible cards update and glow; a new-post button waits above page one until the reader chooses it. | One native one-way connection matches the server-to-page problem; works for guests; small ID-only events reuse normal access rules; automatic reconnection; no extra runtime dependency. | Holds one connection per page; every process keeps its own listener list; clients need catch-up logic; some events cause a second HTTP request. |
| B. Poll the feed every few seconds | The whole feed changes on the next poll. | Simple request/response code; missed updates recover automatically; no long-lived connections. | Repeated requests when nothing changed; either wastes the 256 MB server or makes "gone" slow; rebuilding the feed can interrupt reading and typing; many pages poll together unless extra jitter is added. |
| C. WebSockets with full post payloads | Cards update immediately and the connection could later support two-way features. | Efficient bidirectional channel; server could push complete data in one message. | The app needs only server-to-page signals; adds protocol, authentication, reconnection, and dependency complexity; full payloads duplicate read/access rules and increase the consequence of a privacy mistake. |
| D. SSE with the full changed post in each event | Cards update without a follow-up read. | Keeps the simple one-way protocol and saves one request for a visible change. | Every listener receives data for posts it may not be showing; public and user-specific payloads must be filtered inside the stream; it duplicates the normal read representation and sends more data than an ID signal. |
| E. Insert new posts at the top as they arrive (same SSE signals) | A new special appears on page one with no tap. | The most immediate; nothing to notice or press. | The cards under the reader move down mid-read, so a tap meant for one card can land on another; on a busy evening page one keeps shifting. A new post is not urgent the way a change to a visible post is: seeing it a few seconds later costs no wasted trip. |
| F. Replace a changed card even while someone is using it | The card always shows the latest data. | Nobody acts on a card that is out of date. | A half-typed comment or correction, an open delete confirmation, or keyboard focus would be lost under the person using it. The data is kept, so the card catches up on its next render. |

## Costs of this choice

The implementation is intentionally tied to one Node process. If the app were
run in several processes or machines, an event emitted in one process would not
reach listeners held by another without a shared broker. The 300-listener cap
also means the 301st open page receives a 503 and relies on later visibility
refreshes rather than live updates.

ID-only events trade bandwidth and privacy for a follow-up request when a
visible card changes. A short disconnect can lose events because the stream has
no durable event IDs or replay log; reconnect and tab-focus reloads repair the
current state, but not instantly. Delaying the refill after a delete by up to
two seconds is also a deliberate freshness cost that prevents every open reader
from requesting the same list at once. Changes to a visible post, including
marking it sold out, are not delayed: the page fetches that post as soon as the
event arrives. A new post is seen only when the reader taps the button, so a
reader who never notices it can miss a new special.

The UI has race conditions that do not exist in a static page. Commit `f1d0a20`
fixed one: the server can announce a user's own new post before the POST response
returns, which briefly made the page count that post as someone else's. The page
now removes the returned ID from the waiting set, and `spec/new-posts.test.ts`
reproduces that ordering. The client also avoids replacing a card while its
controls are focused or contain an unfinished correction/comment; its stored
data is current, but the visible card waits for the next render. These behaviours
make the interface stable, at the cost of more client-side state and tests.

## How it is checked

Automated checks:

- `spec/live.test.ts` opens the real `/api/events` stream and verifies that a
  guest receives `new`, `deal`, and `deleted` events for posting, stock,
  comments, confirmations, and deletion.
- The same test verifies that broadcast frames contain only `type` and `id`,
  never the poster's name or session token, and that a correction notice reaches
  the poster but not a bystander.
- `spec/new-posts.test.ts` runs the real client in jsdom and delivers the live
  event before the POST response. It verifies that a user's own post is not
  counted in the new-post button and another user's post is counted.
- The complete `pnpm check` run on 2026-10-10 passed TypeScript checking, all 16
  test files, and all 70 tests.

Measured and manually judged:

- Commit `6ccc571` records a throwaway database test with 1,000 live posts.
  Caching raised page-one throughput from 270 to 523 requests/second and a
  repeated search from 121 to 542 requests/second. In Chrome, a change on page
  two caused no page-one request and a visible change fetched one post. The same
  check found a new post on top after about 1.8 seconds with one list request,
  but that was before `b089362` added the new-post button: now the button shows
  as soon as the event arrives, with no request, and the list is fetched only
  when the reader taps it.
- A person must still judge whether a glow or new-post button is noticeable
  without being distracting, whether deferring an update while someone types is
  the right trade-off, and whether "within moments" holds on the deployed app
  over real mobile networks. This has not been tested with strangers.

## Would change if

Revisit this decision if more than 300 pages need to watch at once; the app runs
in more than one process or region; measurements show the long-lived connections
or follow-up reads are the bottleneck; users miss urgent sold-out updates; or a
future feature genuinely needs low-latency browser-to-server messages. Multiple
processes would require a shared event broker or durable change log. Evidence
that the two-second spread after a delete leaves readers looking at a stale
page would justify refilling at once for pages with few readers. Evidence that readers find the new-post button
confusing would justify an automatic, position-preserving insertion instead.

## References

- `README.md:15-18`, `README.md:32-33`, `README.md:41-53`, `README.md:71`
- `PROCESS.md:105-116` (load measurements and request spreading)
- `server/events.ts:3-46` (event protocol, listener cap, retry and heartbeat)
- `server/server.ts:396-400` (SSE endpoint)
- `public/app.js`, `connectLive` (connection and reconnect catch-up)
- `public/app.js`, `onLive`, `newPostWaiting`, `notWaiting`, `reloadSoon`,
  `refreshDeal` and `busy` (event handling, new-post queue, coalesced reload,
  card refresh and busy-card protection)
- `spec/live.test.ts:54-115`
- `spec/new-posts.test.ts:69-95`
- `d206304` — introduce ID-only Server-Sent Events and live-update tests
- `6ccc571` — limit refetches, distinguish new posts, and spread reloads
- `b089362` — make changes visible with a glow and new-post indicator
- `c7ae888` — animate the changed part of a card once
- `f1d0a20` — fix the own-post/new-post race and add its regression test
- COMP4020 final-project brief: multi-user, real-time, persistent site
