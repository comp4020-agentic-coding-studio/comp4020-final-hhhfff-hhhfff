# 001. Worth the walk?

- **Status:** Draft
- **README rule served:** 2, "The crowd corrects posts." It adds a new kind
  of crowd fact, from the people who went to the shop, in service of the
  standard all five rules serve: a student can "trust a single post enough
  to walk to the shop for it" (README, "What 'good' means here"). It also
  gives the owner data for the "Judged" list ("I have not yet tested it
  with strangers").
- **Asked for by:** the owner (u8113538), 14 October 2026, citing the
  README's "Judged" list.

## Problem

The request asks three things. This plan answers one of them: *was a post
worth the walk, according to the people who walked?* The other two can't
be answered by a button. One is whether "👀 2 others looking" makes someone
hurry or just feel watched; the other is whether readers trust a post
before they walk. Both are about what someone feels before deciding, and
the app stores nothing about who looked (ADR 0002). For those, Option C
below (a short session with strangers, no code) is the honest instrument.
I recommend doing it alongside Option A, not instead.

A student opens discountShow, sees "Instant noodles 5-pack $2.00 (was
$4.50)" at Daily Market, and walks there. When they arrive, one of four
things has happened:

1. It's there as posted. They *can* press "I saw this too, it's right"
   (`.confirm`, `POST /api/deals/:id/confirm`).
2. It's gone. They *can* press "Sold out" (`POST /api/deals/:id/stock`).
3. The price is different. They *can* suggest a correction.
4. It's there and correct, but still not worth the trip (short-dated, a
   small pack, too far for what it saves). Nothing in the app records this.

None of these says *I came because of this post*. A confirmation can come
from someone who was already in the shop, so the confirmation count is not
a count of walks. Most people who find an empty shelf probably report
nothing at all. So today the owner can't tell from the data whether posts
lead people to walk, or how those walks end, and in particular can't tell
cases 2 and 3 (the app failed the reader, which is the README's "a stale
price or empty shelf costs them the trip") from case 4 (the app worked and
the bargain was poor). The next reader can't tell either.

The gap is admitted in the README's "Judged" list (`README.md:72-77`), in
ADR 0002's status ("implemented, not yet tried with strangers"), and in
PROCESS.md ("I did not survey anyone beyond my friends").

## What the reader sees

The feature is one new row on a card, plus a quiet count line. Nothing new
appears above the feed, so the first special stays where it is.

**Guest, phone (360 px and 400 px).** The card is unchanged down to the
confirmations line (`.trust`). Below it, once anyone has answered, there is
one quiet line in the same style as `.watching`:

> 🚶 2 of 3 who went said worth it · latest 20 min ago

It has no buttons and no "log in" prompt, because a guest's card is
read-only. When nobody has answered, the line is hidden (like `.trust`
with no confirmations). At 360 px the line wraps to two lines and never
scrolls sideways. The same row appears on a post's own page (`/deals/:id`),
which is where a friend's shared link lands, and so where a likely walker
comes from.

**Signed in, phone.** The count line as above, then a row:

> Went for this? **[Worth the walk]** **[Not worth it]**

These are two small quiet buttons on one line at 360 px; the label may
wrap above them.

- Press **Worth the walk**: the row becomes "You went: worth the walk.
  [Change]", and the count line updates. My answer counts in the total;
  unlike presence, which leaves out the reader, a walk is a fact about the
  post.
- Press **Not worth it**: the answer is recorded straight away (one tap is
  enough). The row becomes "You went: not worth it. What happened?" with
  four optional reasons as small buttons that wrap inside the card:
  **Sold out** · **Different price** · **Couldn't find it** · **There,
  but not worth it**. The chosen one shows as pressed (`aria-pressed`).
  - **Sold out** also offers **[Mark it sold out for the next person]**.
    That button is the existing stock report: under your name,
    rate-limited, and sent only if pressed. It isn't offered when the post
    is already sold out.
  - **Different price** opens the card's "Wrong? Suggest a correction"
    with "Special price" chosen.
- **[Change]** brings back the two buttons and adds **[Take it back]**,
  which removes my answer (for a mis-tap, or "I didn't actually go").
- On my own post: the count line only, with no question. A poster's own
  answer would only measure the poster.

**Desktop.** The content is the same. In the two- and three-column grid the
new row gets its own row in the card's subgrid, after `.trust`, so the
cards' rows still line up across a row of cards.

**Admin.** Cards look the same as for a signed-in person. In addition,
`GET /api/walks` (admin only) returns a JSON summary to read in the browser
while logged in: totals, reasons, and per-post counts, including posts that
have ended. Readers see no new panel.

**States.**

- *Loading:* nothing new. The skeleton cards and "Loading specials…" stay
  as they are, and the counts arrive inside each deal.
- *Empty:* with no answers there is no count line, and a signed-in reader
  sees just the question.
- *Error:* a refused or failed answer shows its message on the card
  (`alertIn`, as corrections do) and the buttons stay as they were. A
  lapsed session goes through `syncMe` / `requireLogin` like every other
  write.
- *Live connection lost:* the count line shows what the card last fetched.
  It catches up on tab focus or reconnect, like the rest of the card, and
  the grey badge already says so. My own answer shows at once from the
  POST response either way.
- *Sold out:* the question stays, since "it was gone when I got there" is
  exactly what we want to hear. The card still sorts last, because walk
  answers never change feed order.
- *Busy card:* if a live update arrives while the reader is typing a
  comment on that card, it waits like any other (`busy()` in `app.js`).

## Rules it must keep

From "What the app must never do":

- **No guest writes.** `POST /api/deals/:id/walk` goes through
  `need(req, "walk", …)`, so a guest gets 401. Identity comes only from the
  cookie; an `author` in the body is ignored, as everywhere.
- **Permissions from the role table.** `ACTIONS` in `server/auth.ts` gains
  `"walk"` (in `MEMBER`, so users and admins) and `"walk-summary"` (admin
  only). The admin summary is a different power from `"moderate"`, so it
  gets its own name.
- **Never reveal who.** The new table stores no name. The API gives counts
  plus, for the requester only, their own answer. This deliberately does
  *not* copy `Deal.confirmedBy`, which sends confirmers' names and ids to
  everyone. A public id never appears in walk data. Answering "Sold out"
  does not file a stock report by itself, because a stock report carries
  the reporter's name (`stockBy`). That stays a separate press, labelled
  as today's action.
- **Validators.** `worth` must be `true`, `false` or `null` (checked like
  `liked` on comment likes). `reason` goes through `oneOf` with the four
  fixed values, and only when `worth` is `false`. The post is found with
  `dealId()`. There is no free text, so nothing new to render, escape or
  moderate. SQL uses parameters only. The page uses `textContent` and
  fixed strings.
- **Stock limit.** The walk route never writes stock. "Mark it sold out"
  calls the existing stock route, so `stockWait` still holds it to one
  report a minute per account.
- **Quorum and confirmations.** Walk answers count toward neither. One
  account gives one answer per post (primary key `(deal_id, author_id)`,
  an upsert, so two requests at once still make one row). The poster can't
  answer on their own post: 400, "that's your own post", as `confirm` does.
- **Live stream: ids only.** A changed answer sends
  `broadcast({ type: "deal", id })`, one of ADR 0001's four event types,
  as comment likes do. An unchanged answer sends nothing (the DB function
  returns whether anything changed, like `likeComment`). The listener cap
  is untouched. The map doesn't ripple for an answer, because
  `lastReportAt` comes only from posts and stock reports
  (`storesWithCounts` in `server/server.ts`). That keeps the README's "no
  ripple for a comment" kind of promise.
- **256 MB.** Nothing is held in memory. `toDeal` adds one small query per
  deal on the primary-key index, so ten more per page.
- **No new dependency.**
- **No data lost.** It is a new `CREATE TABLE IF NOT EXISTS walks (…)` in
  `server/db.ts` beside the others, with existing tables untouched. It
  lives in `specials.db` under `DATA_DIR`. A deleted post is hidden, not
  removed (`deleteDeal`), so its answers stay in the table, like its
  comments, and are left out of the summary.
- **Duplicates and price rules.** Untouched, since no deal field changes.

From "What the pages must hold to":

- **Specials first.** The row is inside a card, below stock and
  confirmations. Nothing is added above `#feed`, so the first special's
  item and price don't move at 360 or 400 px with the map open.
- **Guest card read-only.** A guest gets the count line only, with no
  button that would be refused.
- **Sold-out order.** Unchanged: walk writes don't call `feedChanged()`.
- **Form field names.** The row uses buttons with `data-walk` / `data-reason`
  attributes, like the stock buttons' `data-stock`, and no named fields.
  `spec/forms.test.ts` keeps holding.
- **No horizontal scroll** at 360 px, 400 px or desktop. The look must be
  checked over the DevTools protocol, as CLAUDE.md says.
- **The device's location** is still never sent (`public/app.js`, top
  comment). No geofence "proves" a walk.

Changes the builder must make outside code (not mine to make):

- **`README.md`:** say what readers can now do and see, and add walk
  answers to the "Enforced" list (one per person per post, not the
  poster's, counts only, stock untouched). Only the owner changes the
  "Judged" sentence about strangers. Where the promise sits is an open
  question.
- **ADR 0001** lists what rides on `deal`. Add walk answers there.
- **`CLAUDE.md`:** propose a "never" line, "show who answered whether a
  post was worth the walk", for the owner to accept.
- **Tests post at `spar-civic`**, which no spec uses yet, so parallel spec
  files don't collide (CLAUDE.md, "Changes must not break").

## Out of scope

- **Whether "👀 N others looking" makes people hurry or feel watched.** A
  question in the app would lead the answer, and nothing about who looked
  is stored. See Option C.
- **Guests answering.** CLAUDE.md forbids any guest write, and the README
  says writing needs an account. So strangers must register to answer, and
  the sample leans toward people who already did. Option C reaches guests.
- **Proving someone walked.** There is no location check (location never
  leaves the device) and no time gate. An answer is a self-report, weighed
  like a confirmation. Throwaway accounts can inflate it, the same weakness
  PROCESS.md admits for the correction quorum.
- **Free-text reasons.** Comments already carry "still there?" talk, and a
  fixed list needs no moderation.
- **Counting how many people opened a post**, to turn walks into a "walk
  rate". That would store something ADR 0002 says isn't stored ("nothing
  about who looked survives a restart") and needs its own plan.
- **Feed order by verdict, reasons on the card, walk counts in link
  previews, and telling the poster.** Each is a separate change to what
  readers see. The reasons go to the owner's summary first.
- **An admin page for the summary.** JSON is enough to learn from. A view
  can follow if it's used.

## Options considered

**A. "Went for this?" on the card, with public counts (recommended).**
What the reader sees is described above. The server gets:

- one table: `walks(deal_id, author_id, worth INTEGER, reason TEXT,
  created_at, updated_at)`, primary key `(deal_id, author_id)`;
- one write route, `POST /api/deals/:id/walk {worth, reason}`, answering
  200 with the deal;
- one admin route, `GET /api/walks`;
- `Deal.walks = { worth, notWorth, latestAt }` for everyone, and
  `Deal.myWalk = { worth, reason } | null` for the person asking. This is
  the same "by whoever asked" pattern as `Comment.liked`.

Cost:

- `getDeal` gains an optional viewer. `feedPage`, `GET /api/deals/:id` and
  the POST responses (confirm, corrections, stock, photo) pass
  `whoIs(req)?.id`. `similarDeals` and `dealMeta` stay viewer-less.
- The card gains a row, and the desktop subgrid grows from `span 12` to
  `span 13` (the `@media (min-width: 44rem)` block in `public/styles.css`).
- README and ADR text.

The gain is that the next reader gets direct evidence ("2 of 3 who went
said worth it"), and people see their answer count, which is a reason to
give one. The risk is a stale "worth it" sending someone to an empty shelf,
the exact failure the README warns of. That is why the line always shows
how long ago the latest answer was, and sits *below* stock, which stays the
primary fact.

**B. The same question, answers private.** A reader sees the question and
their own answer, never a count; the owner reads `GET /api/walks`. Cost:
the same server work minus the count line. Readers get nothing new to
trust, so fewer may bother. There's no stale-verdict risk, no herding (the
fifth answer isn't swayed by the first four), and no new public claim on
the card. Switching between A and B is cheap: B is A with the count line
shown only to admins. If the owner wants clean measurement more than a
reader-facing signal, choose this.

**C. No code: a short session with strangers.** For example, five students
the owner doesn't know, each on their own phone, as guests:

1. Pick a special you'd walk for, and say why aloud.
2. Look at a card showing "👀 2 others looking": what does it make you
   want to do?
3. Would you trust this post enough to go now?

Note their words, not scores, and record no names. Cost: the owner's time,
a small sample and no ongoing data. It is the only option that answers the
"hurry or feel watched" and "do they trust it" parts of the request, and
reaches guests. Recommended alongside A or B.

**D. Read only what's already stored.** An admin summary of confirmations,
stock reports and corrections per post after it was posted, with no new
UI. This is the cheapest. It can't tell a walk made because of the post
from someone already in the shop, and it can't capture case 4 ("there,
but not worth it"), which is the distinction the README's standard turns
on.

**E. Ask later.** The page remembers on the device (in `localStorage`,
never sent) which posts the reader opened. On their next visit, a few
minutes to a day later, it asks once: "Did you go for Instant noodles at
Daily Market?" More of the answers would come from people who actually
walked. Cost: timing rules, a stored list, and a prompt that must not push
the first special below the first screen at 360 px (the top of the page is
already `#notices`, the map and the filters). Worth adding on top of A or B
if the card question gets too few answers. Not first.

**F. A link to an external survey (Google Forms, etc.).** This reaches
guests. But it is another service, the data sits outside the SQLite volume,
there's no one-person-one-account, readers are sent off the page, and a
third party sees who answered. Rejected.

## Acceptance

Server: `spec/walks.test.ts` (new; posts at `spar-civic`; identities from
`person()`):

- [ ] A signed-in person who isn't the poster sends
      `POST /api/deals/:id/walk {worth: true}` and gets 200. `GET
      /api/deals/:id` then shows `walks.worth` 1 and `walks.notWorth` 0.
      With their cookie, `myWalk` is `{worth: true, reason: null}`; for a
      guest, and for someone who didn't answer, `myWalk` is `null`.
- [ ] A guest's answer gets 401, and the counts are unchanged.
- [ ] The poster's answer on their own post gets 400, and the counts are
      unchanged.
- [ ] Answering again replaces the answer: `{worth: false, reason: "gone"}`
      leaves `worth` 0 and `notWorth` 1. `{worth: null}` takes it back,
      leaving both 0.
- [ ] Two requests from the same person at once count as one answer.
- [ ] Answers from two other people count two. Read by a third person or a
      guest, the deal's JSON contains neither answerer's name or public id,
      and no list of who answered.
- [ ] These get 400: `worth` missing or not `true`/`false`/`null`; `reason`
      not one of the four; any `reason` with `worth: true`.
- [ ] An answer on a deleted post gets 404.
- [ ] A "gone" answer changes neither the post's stock, nor its place in
      `/api/deals?store=spar-civic`, nor its confirmations.
- [ ] A guest's live stream receives exactly `{"type":"deal","id":N}` after
      a changed answer, and no `deal` event for N within 1.5 s after the
      same answer is sent again.
- [ ] `GET /api/walks` gives 401 to a guest, 403 to a user, and 200 to an
      admin. The admin's answer includes this test's post with its counts,
      and contains no answerer's name, public id or cookie. (The admin part
      is skipped without `adminUser`, as in `accounts.test.ts`.)
- [ ] Answers survive a restart. On a throwaway data directory started with
      `spec/launch.ts` (the `admins.test.ts` pattern): answer, restart, and
      read the same counts.

Page: `spec/walks-page.test.ts` (new; the real `app.js` via `openPage` in
`spec/page.ts`):

- [ ] For a guest, a card with one "worth" answer shows "🚶 1 of 1 who went
      said worth it" (or the wording approved under open question 1) and
      has no walk buttons. A card with no answers shows no count line.
- [ ] For a signed-in non-poster, the card shows "Went for this?" with two
      buttons. Pressing "Worth the walk" sends one
      `POST /api/deals/:id/walk`, and the row then reads "You went: worth
      the walk" with a Change button.
- [ ] Pressing "Not worth it" and then "Sold out" sends the walk answer with
      `reason: "gone"` and no stock request (checked with `openPage`'s
      `network` spy). "Mark it sold out for the next person" then appears,
      and only pressing it sends `POST /api/deals/:id/stock {stock: "gone"}`.
- [ ] Pressing "Different price" opens that card's correction form with
      "Special price" chosen.
- [ ] The poster's own card shows the count line and no walk buttons.
- [ ] After someone else answers over HTTP, a `deal` event played by
      `FakeEventSource` updates the open card's count line.
- [ ] `spec/forms.test.ts` still passes.

Named manual checks:

- [ ] In Chrome over the DevTools protocol, at 360 px, 400 px and 1280 px,
      as a guest and signed in, with the map open: the first special's item
      and price are on the first screen; there is no horizontal scroll; the
      two walk buttons fit on one line at 360 px and the four reasons wrap
      inside the card; on desktop, the cards' rows still line up across a
      row of cards. Close each tab afterwards.
- [ ] If Option C is approved: the session is run, and the owner's notes
      from it, not the app's counts, decide what happens to
      "👀 N others looking".

## Open questions

1. **Public counts (A) or private (B)?** A adds a reader-facing claim to
   the README's argument. B keeps the measurement clean. If public, show
   the count from the first answer, or only from the second or third (one
   verdict looks authoritative, and a poster may guess whose it was)?
2. **Where does it go in the README?** A sentence under rule 2, a new
   numbered rule, or only the "Enforced" list? And should CLAUDE.md's
   "never" list gain "show who answered whether a post was worth the
   walk"?
3. **Answering needs an account.** That is the rule, so the people the
   owner most wants to hear from, first-visit strangers, will mostly not
   answer. Accept that bias and rely on Option C for guests, or reconsider?
   (Changing it means changing the README's "writing needs an account".)
4. **Should "Worth the walk" also count as a confirmation?** I recommend
   not: the confirmation count would stop meaning exactly "same and
   correct", and the measurement would blur.
5. **Are the four reasons right?** Sold out / different price / couldn't
   find it / there but not worth it. Should "too far for the saving" be
   separate from the last one?
6. **Retention (privacy).** Each row records that one account went to one
   shop for one post, kept like stock reports are, indefinitely. Keep it,
   or drop answers some time after the post ends (as photos go a week
   after)?
7. **Option C.** Will you run it, with whom and when? Check the course's
   guidance on testing with people, and what you tell them is noted.

## Review notes

Checked against the code on 14 October 2026, before approval. Each
function, route and file named above exists as described. One gap:
`public/styles.css` sets `grid-row: span 12` twice, on `.deal` *and* on
`.feed > .skeleton` (the loading cards). Both must become `span 13`, or the
loading cards stop lining up with real ones on desktop.

Written to the first template. Before approval it needs the current one
(`docs/plans/README.md`): the reader views at the marking viewports,
390×844 and 1920×1080, and a second session beside the first; acceptance
split into automated and observed lines (its "named manual checks" become
observed lines); and empty "Approval" and "Built evidence" sections.

## Revisions

None: this is a draft and hasn't been approved.
