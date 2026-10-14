# 001. Worth the walk?

- **Status:** Draft
- **README rule served:** 2, "The crowd corrects posts." Walk answers are a
  new kind of crowd fact, from the people who went to the shop. The owner
  has placed them in the README as a supplement under rule 2, not as a new
  rule. They serve the standard all five rules serve: a student can "trust
  a single post enough to walk to the shop for it" (README, "What 'good'
  means here").
- **Asked for by:** the owner (u8113538), 14 October 2026, citing the
  README's "Judged" list. Revised the same day with the owner's answers to
  the first draft's seven open questions.

## Problem

The request asked three things. This plan answers only one of them: *was a
post worth the walk, according to the people who walked?*

A button can't answer the other two, and this plan does not try. One is
whether "👀 2 others looking" makes someone hurry or just feel watched. The
other is whether readers trust a post before they walk. Both are about
what someone feels before deciding, and the app stores nothing about who
looked (ADR 0002). The way to find out is a short session with strangers
(Option C), and the owner has deferred it. So once this plan is built,
both questions stay open: on the README's "Judged" list, and in ADR 0002's
status, "not yet tried with strangers". Walk answers come only from people
with accounts who choose to answer after the walk, so they can't stand in
for either question.

A student opens discountShow, sees "Instant noodles 5-pack $2.00 (was
$4.50)" at Daily Market, and walks there. When they arrive, one of these
has happened:

1. It's there as posted. They *can* press "I saw this too, it's right"
   (`.confirm`, `POST /api/deals/:id/confirm`).
2. It's gone. They *can* press "Sold out" (`POST /api/deals/:id/stock`).
3. The price is different. They *can* suggest a correction.
4. It's there and correct, but still not worth the trip (short-dated, a
   small pack). Nothing in the app records this.
5. It's there and correct, but too far to walk for what it saves. Nothing
   in the app records this either.

None of these says *I came because of this post*. A confirmation can come
from someone who was already in the shop, so the confirmation count is not
a count of walks. Most people who find an empty shelf probably report
nothing at all. So today the owner can't tell from the data whether posts
lead people to walk, or how those walks end. In particular, they can't
tell cases 2 and 3 apart from cases 4 and 5. In cases 2 and 3 the app
failed the reader, which is the README's "a stale price or empty shelf
costs them the trip". In cases 4 and 5 the app worked and the bargain was
poor. The next reader can't tell either.

The gap is admitted in three places: the README's "Judged" list
(`README.md:72-77`, "I have not yet tested it with strangers"), ADR 0002's
status, and `PROCESS.md`, under "Towards crit 10" ("Neither establishes that
strangers trust the posts").

## What the reader sees

The feature is one new row inside a card. Once three people have answered,
the row shows a quiet count line. A signed-in reader who didn't post the
special also gets a question. Nothing new appears above `#feed`.

**Where it sits, and the first screen.** The row sits inside each card,
after the confirmations (`.trust`) and before the corrections list
(`.history`), so it comes below the price, the stock bar and who reported
the stock. The first card's item and price sit above it, so they don't
move. The store map still starts open, and nothing is added between the
header and the feed, so the first special stays on the first screen at
390×844, 360 px and 400 px exactly as it is today.

**When the count shows (proposed, owner to confirm): from the third
answer.** Until three people have answered, nobody sees a count: not
guests, not the poster, not the answerers. The server sends `walks: null`
in the deal's JSON, so this is not only hidden by the page. The reasons:

- One answer is one person's word, and the card already carries one
  person's word, the poster's. A crowd fact should take a crowd.
- Three is the bar the app already sets for the crowd: rule 2's
  three-person correction quorum (`CORRECTION_QUORUM` in `server/db.ts`).
  Readers who know that rule meet the same number here.
- With one answer, a poster who saw someone in the shop can tell what that
  person said. Three makes the guess harder. No threshold stops someone who
  already knows two of the three answerers, so this narrows the problem
  without solving it.
- Faking a verdict on a card takes three accounts, not one. That proves
  nothing, but it costs more.
- The cost: on a quiet app few posts may reach three, so the line will
  often not show, and people get less back for answering. The admin
  summary sees every count from the first answer, so the owner can check
  how many posts reach three, and lower the bar to two if the line almost
  never shows.

**Guest at 390×844 (and 360 px, 400 px).** The card is unchanged down to
the confirmations line. Below it, once three people have answered, there is
one quiet line in the same style as `.watching`:

> 🚶 2 of 3 who went said worth it · latest 20 min ago

If none said worth it, the line reads "🚶 None of 3 who went said worth
it · latest 20 min ago". The line has no buttons and no "log in" prompt,
because a guest's card is read-only. With fewer than three answers the line
is hidden, as `.trust` is when there are no confirmations. At 360 px it
wraps to two lines and never scrolls sideways. The same row appears on a
post's own page (`/deals/:id`). A friend's shared link lands there, so
likely walkers often start from it.

**Signed in at 390×844.** The count line as above, once there are three
answers, then a row:

> Went for this? **[Worth the walk]** **[Not worth it]**

These are two small quiet buttons, on one line at 360 px. The label may
wrap above them.

- Press **Worth the walk**: the row becomes "You went: worth the walk.
  [Change]". Once there are three answers, the count line updates. My
  answer counts in the total. Presence leaves the reader out, but a walk
  is a fact about the post, so it counts.
- Press **Not worth it**: one tap records the answer straight away. The row
  becomes "You went: not worth it. What happened?", with five optional
  reasons as small buttons that wrap inside the card:
  **Sold out** · **Different price** · **Couldn't find it** · **There,
  but not worth it** · **Too far for the saving**. The chosen one shows as
  pressed (`aria-pressed`), and pressing another replaces it. "There, but
  not worth it" now means the item itself was poor (short-dated, a small
  pack). Distance has its own button.
  - **Sold out** also offers **[Mark it sold out for the next person]**.
    That button is the existing stock report: it goes under your name, it
    is rate-limited, and it is sent only if pressed. It isn't offered when
    the post is already sold out.
  - **Different price** opens the card's "Wrong? Suggest a correction" with
    "Special price" chosen.
- While the post has fewer than three answers, a hint under my answer says
  "Others see the count once 3 people have answered." Without it, the
  missing count looks like a lost answer.
- **[Change]** brings back the two buttons and adds **[Take it back]**,
  which removes my answer (for a mis-tap, or "I didn't actually go").
- On my own post there is no question, only the count line once three
  others have answered. A poster's own answer would only measure the
  poster.
- "Worth the walk" is not a confirmation (owner, 14 October). It doesn't
  add to "Confirmed by N people", and the "I saw this too, it's right"
  button stays where and as it is.

**Guest and signed in at 1920×1080.** The content is the same. At this
width, with posts, the feed runs in two columns beside the chains sidebar
(`.feed-layout.has-side`). In the subgrid, the new row is the card's row 8
(`.deal > .walk { grid-row: 8; }`). The rows after it each move down one:
`.history` 9, `.pending` 10, `.correct` 11, `.comments` 12, `.delete` 13.
`public/styles.css` sets `grid-row: span 12` in two places, both in a
`@media (min-width: 44rem)` block. One is on `.deal`; the other is on
`.feed > .skeleton`, the loading cards. Both become `span 13`. If only one
changes, either the cards or the loading cards stop lining up across a
row.

**Admin.** Cards look the same as for a signed-in person. In addition,
`GET /api/walks` (admin only) returns a JSON summary to read in the browser
while logged in. It holds totals, counts per reason, and counts per post
from the first answer, including posts that have ended, until their answers
are deleted (see "Retention" under "Rules it must keep"). It names no
answerer. Readers see no new panel.

**Real-time: a second session beside the first.** Say session 1 is signed
in and answers, and session 2 is open on the same post beside it, as a
guest or as another signed-in person.

- While the post has fewer than three answers, session 2 sees nothing
  change, and the stream sends nothing. Only a change others can see is
  announced. ADR 0001 already treats a report that hides nothing this way.
- The answer that makes three sends `deal` with the post's id. So does
  every later change that alters the public count: a new answer, a changed
  one, or one taken back, including the one that takes it from three back
  to two and hides the line. Session 2 fetches the post through the normal
  read route (`refreshDeal`), and its count line appears, changes or goes
  within moments, with the card's usual glow.
- If session 2 is typing a comment on that card, the card waits
  (`busy()` in `public/app.js`) and catches up on its next render.
- If session 2 is the same person in another tab, their "You went" row
  updates with that same event. When no event goes out (below three
  answers, or only a reason changed), that tab catches up when it is next
  shown (`visibilitychange`, then `loadFeed`).
- Nothing else moves. The map doesn't ripple, the post keeps its place in
  the feed, and "👀 N others looking" is unaffected.

**Logging in.** Answering still needs an account (owner, 14 October). A
separate plan, 002, is redesigning login, so that it stops being a form
that drops down at the top of the page and becomes a page of its own. This
plan doesn't design login, and relies on whatever flow 002 settles. A guest
never sees a walk button, so 001 meets login only when a session lapses
while the page is open. The walk handler calls `requireLogin()` before
sending, as `confirmDeal` does. That stops a request when the page already
knows the reader is logged out. When only the server knows, the POST gets
a 401: `apiResponse` in `public/app.js` runs `syncMe`, which finds the
reader logged out and reloads the feed as a guest's, so the card turns
read-only. The message ("log in to …") shows in `#feed-status`, as a
lapsed confirm's does. From there the reader logs in through the header's
"Log in", which opens today's drop-down form and, after 002, whatever 002
says. Nothing in 001 names the drop-down form, and its tests check only
that no answer was recorded and the buttons are gone. So either plan can
be built first. One thing 001 hopes 002 keeps: after logging in, the
reader comes back to the post they were on, so the question is within
reach. That choice belongs to 002.

**States.**

- *Loading:* nothing new. The skeleton cards and "Loading specials…" stay
  as they are, and the counts arrive inside each deal. On desktop the
  skeletons span 13 rows, as the cards do.
- *Empty:* with fewer than three answers there is no count line, and a
  signed-in reader sees just the question. An empty feed shows nothing new.
- *Error:* a refused or failed answer shows its message in the walk row
  (`alertIn`, as corrections do), and the buttons stay as they were. The
  exception is a 401 from a lapsed session, described under "Logging in":
  the card is rebuilt read-only and the message goes to `#feed-status`.
- *Live connection lost:* the count line shows what the card last fetched.
  It catches up on tab focus or reconnect, like the rest of the card, and
  the grey badge already says so. My own answer shows at once either way,
  from the POST response.
- *Sold out:* the question stays, because "it was gone when I got there" is
  exactly what we want to hear. The card still sorts last, because walk
  answers never change feed order. "Mark it sold out for the next person"
  isn't offered.
- *Busy card:* if a live update arrives while the reader is typing a
  comment on that card, it waits like any other.

## Rules it must keep

From "What the app must never do":

- **No guest writes.** `POST /api/deals/:id/walk` goes through
  `need(req, "walk", …)`, so a guest gets 401. Identity comes only from the
  cookie. An `author` in the body is ignored, as everywhere else.
- **Permissions from the role table.** `ACTIONS` in `server/auth.ts` gains
  `"walk"` (in `MEMBER`, so users and admins) and `"walk-summary"` (admin
  only). The summary is a different power from `"moderate"`, so it gets
  its own name.
- **Never reveal who.** The new table stores no name. The API gives counts
  (from the third answer) and, to the person asking, their own answer. This
  deliberately does *not* copy `Deal.confirmedBy`, which sends confirmers'
  names and ids to everyone. No public id ever appears in walk data, the
  admin summary included. Answering "Sold out" does not file a stock report
  by itself, because a stock report carries the reporter's name
  (`stockBy`). That stays a separate press, labelled as today's action.
- **The threshold is the server's.** `Deal.walks` is `null` until the post
  has three answers, in every response, for everyone. A page that ignored
  it would still have nothing to show.
- **Validators.** `worth` must be `true`, `false` or `null`, checked like
  `liked` is on comment likes. `reason` goes through `oneOf` with the five
  fixed values (`gone`, `price`, `missing`, `poor`, `far`), only when
  `worth` is `false`; it may be absent or `null` then. The post is found
  with `dealId()`, so a deleted post gives 404. There is no free text, so
  there is nothing new to render, escape or moderate. SQL uses parameters
  only. The page uses `textContent` and fixed strings.
- **Stock limit.** The walk route never writes stock. "Mark it sold out"
  calls the existing stock route, so `stockWait` still holds it to one
  report a minute per account.
- **Quorum and confirmations.** Walk answers count toward neither, and
  "Worth the walk" is not a confirmation. One account gives one answer per
  post: the primary key is `(deal_id, author_id)` and the write is an
  upsert, so two requests at once still make one row. The poster can't
  answer on their own post: 400, "that's your own post", as `confirm` does.
- **Live stream: ids only.** The DB function reads the post's public
  `walks` before and after the write, in the same transaction, and reports
  whether it changed, as `likeComment` reports whether anything changed.
  Only then does the route send `broadcast({ type: "deal", id })`, one of
  ADR 0001's four event types, as comment likes do. So nothing goes out
  for an unchanged answer, for any change that leaves the post under three
  answers, or for a reason added or changed. `updated_at` moves only when
  `worth` changes, so a reason, which nobody else sees, leaves the
  "latest" time alone. The listener cap is untouched. The map doesn't
  ripple for an answer, because `lastReportAt` comes only from posts and
  stock reports (`storesWithCounts` in `server/server.ts`). That keeps the
  same kind of promise as the README's "no ripple for a comment".
- **256 MB.** Nothing is held in memory. `toDeal` adds one small query per
  deal for the counts, on the primary-key index, and a signed-in reader
  adds one more for their own answer. That makes up to twenty more per
  page of ten. The deletion sweep is a couple of statements an hour.
- **No new dependency.**
- **No data lost, and retention (proposed, owner to confirm).** There is
  one new `CREATE TABLE IF NOT EXISTS walks (…)` in `server/db.ts` beside
  the others, and existing tables are untouched. It lives in `specials.db`
  under `DATA_DIR`, so answers survive a restart. The owner asked that
  answers be deleted some time after the post ends. That deletion is
  deliberate and must be stated in the README, so it is not "losing data".
  Proposed: **seven days**, done the way shelf photos are done.
  `PHOTO_KEEP_DAYS = 7` in `server/db.ts`, and `sweepPhotos(today)` runs at
  startup and then hourly with Canberra's today (`server/server.ts`, at the
  end of the file). A sibling `sweepWalks(today)`, with its own
  `WALK_KEEP_DAYS = 7`, runs beside it. Answers go:
  - for a post with an end date, once that date is more than seven days
    past (`ends_on < today − 7`), exactly the photo rule;
  - for a deleted post, at once, in the same transaction in `deleteDeal`
    that removes its photo, with the sweep catching any left over;
  - for a post with no end date, seven days after it sold out: when its
    latest stock report says "gone" and is more than seven days old. A
    later report (it came back) means it hasn't ended. An undated post
    that is neither deleted nor sold out stays in the feed and keeps its
    answers, because they still serve the next reader.

  Why seven days. It is the period readers already see for photos ("a week
  after the special ends", README), so the README can give one rule for
  both. Once a post ends, the count line serves no reader. What's left is
  the owner's summary, and a week is long enough to read it. Each row says
  that one account went to one shop for one post at a certain time, and
  once the post is over that has no use to readers. Two costs. The owner
  loses the answers on a post the poster deleted, perhaps because it was
  wrong, which is exactly a failure they would want to see. And the
  undated rule is new: photos have no rule for undated posts and keep them
  until the post is deleted. An answer sent to a post already past its
  week is accepted and goes at the next hourly sweep. Refusing it would
  need the page and the server to agree on the cut-off, for little gain.
- **Duplicates and price rules.** Untouched, since no deal field changes.

From "What the pages must hold to":

- **Specials first.** The row is inside a card, below stock and
  confirmations. Nothing is added above `#feed`, so the first special's
  item and price don't move at 390×844, 360 or 400 px with the map open.
- **Guest card read-only.** A guest gets the count line only, with no
  button that would be refused, and no "log in to answer" button.
- **Sold-out order.** Unchanged: walk writes don't call `feedChanged()`.
- **Form field names.** The row uses buttons with `data-walk` /
  `data-reason` attributes, like the stock buttons' `data-stock`, and has
  no named fields. `spec/forms.test.ts` keeps holding.
- **No horizontal scroll** at 390×844, 360 px, 400 px or 1920×1080. Check
  the look in Chrome over the DevTools protocol, as CLAUDE.md says, and
  close each tab.
- **The device's location** is still never sent (`public/app.js`, top
  comment). No geofence "proves" a walk, including "Too far for the
  saving", which is the reader's own judgement.
- **`/readme/` headings.** The README change below adds text under rule 2
  and no headings, so `spec/invariants.test.ts` still holds.

Changes the builder must make outside code (not mine to make):

- **`README.md`, under rule 2** (the owner's placement). Proposed wording,
  for the owner to approve with the plan: "People who went can also say
  whether it was worth the walk, and if not, why. Once three have
  answered, the post shows how many said it was worth it and when the
  latest did, as a count, never who. An answer is not a confirmation, and
  answers go a week after the post ends." The number and the week follow
  open questions 1 and 3. Add to the "Enforced" list: walk answers (one
  per person per post, not the poster's, counts only and only from the
  third answer, never who, stock untouched, deleted a week after the post
  ends). Only the owner changes the "Judged" list. This build leaves its
  sentence about strangers true.
- **ADR 0001** lists what rides on `deal`. Add walk answers there, and
  note that an answer that changes nothing others can see sends nothing.
- **`CLAUDE.md`, "What the app must never do" (proposed, owner to
  confirm).** Add: "Show who answered whether a post was worth the walk, to
  anyone, admins included: walk answers leave the server only as counts,
  and each person's own answer to that person." Why a "never" line and not
  just a test: the agents read CLAUDE.md first, and the obvious pattern to
  copy, `Deal.confirmedBy`, sends names and ids to everyone. A walk row is
  about a person's movements (one account, one shop, one time), much as
  the device's location is, which the app already never sends. The
  three-answer threshold is left to tests rather than this line, because
  the number may change.
- **Tests post at `spar-civic`**, which no spec uses yet, so spec files
  running in parallel don't collide (CLAUDE.md, "Changes must not break").

## Out of scope

- **Whether "👀 N others looking" makes people hurry or feel watched, and
  whether readers trust a post before they walk.** This plan cannot answer
  either. A question in the app would lead the answer, nothing about who
  looked is stored, and walk answers come after the walk. Option C is the
  instrument for these, and it is deferred.
- **Guests answering.** The owner kept the rule: CLAUDE.md forbids any
  guest write, and the README says writing needs an account. So strangers
  must register to answer, and the answers lean toward people who already
  did. With Option C deferred, nothing in this build hears from guests.
- **Login itself.** It belongs to plan 002 (see "Logging in" above).
- **Proving someone walked.** There is no location check (location never
  leaves the device) and no time gate. An answer is a self-report, weighed
  like a confirmation. Throwaway accounts can inflate it. `PROCESS.md`
  admits the same weakness for the correction rules ("They still cannot
  guarantee that one person has only one account"); the three-answer
  threshold only raises the cost.
- **Free-text reasons.** Comments already carry "still there?" talk, and a
  fixed list needs no moderation.
- **Counting how many people opened a post**, to turn walks into a "walk
  rate". That would store something ADR 0002 says isn't stored ("nothing
  about who looked survives a restart"), and it needs its own plan.
- **Keeping anonymous totals after the answers go.** The owner reads the
  summary within the week. If the totals should outlive the rows, a small
  follow-on could fold each post's counts into a table with no account ids
  before the sweep.
- **The undated sold-out rule for photos.** Photos keep their present rule.
  Whether they should follow walks is a separate change.
- **Feed order by verdict, reasons on the card, walk counts in link
  previews (`dealMeta`), and telling the poster.** Each is a separate
  change to what readers see. The reasons go to the owner's summary first.
- **An admin page for the summary.** JSON is enough to learn from. A view
  can follow if it gets used.

## Options considered

**A. "Went for this?" on the card, with public counts (recommended; chosen
by the owner, 14 October).** The reader's view is described above. The
server gets:

- one table, `walks(deal_id, author_id, worth INTEGER NOT NULL, reason
  TEXT, created_at, updated_at)`, with primary key `(deal_id, author_id)`
  and no name column;
- one write route, `POST /api/deals/:id/walk {worth, reason}`, answering
  200 with the deal;
- one admin route, `GET /api/walks`;
- `Deal.walks = { worth, notWorth, latestAt } | null` for everyone (`null`
  under three answers), and `Deal.myWalk = { worth, reason } | null` for
  the person asking. This is the same "by whoever asked" pattern as
  `Comment.liked`;
- `sweepWalks(today)` beside `sweepPhotos`, and the deletion in
  `deleteDeal`.

Cost:

- `getDeal` gains an optional viewer. `feedPage`, `GET /api/deals/:id` and
  the POST responses that return a deal (confirm, corrections, stock,
  photo) pass `whoIs(req)?.id`. `similarDeals` and `dealMeta` stay
  viewer-less.
- The card gains a row in `#deal-template` (`public/index.html`), between
  `.trust` and `.history`. The desktop subgrid grows from 12 rows to 13 in
  both places, and the rows after `.trust` are renumbered.
- README, ADR 0001 and (if confirmed) CLAUDE.md text.

The gain: the next reader gets direct evidence ("2 of 3 who went said
worth it"), and people see their answer count, which is a reason to give
one. The risk: a stale "worth it" could send someone to an empty shelf,
the exact failure the README warns of. That is why the line always shows
how long ago the latest answer came, and why it sits *below* stock, which
stays the primary fact. It can also herd: the fourth person may echo the
first three.

**B. The same question, with answers kept private.** A reader sees the
question and their own answer, never a count, and the owner reads
`GET /api/walks`. Cost: the same server work, minus the count line. Readers
get nothing new to trust, so fewer may bother answering. On the other
hand there is no stale-verdict risk, no herding and no new public claim on
the card. Switching between A and B is cheap: B is A with `walks` always
`null` outside the admin summary. The owner chose A. Below three answers,
A behaves like B anyway.

**C. No code: a short session with strangers (deferred by the owner, 14
October; not part of this build).** For example: five students the owner
doesn't know, each on their own phone, as guests.

1. Pick a special you'd walk for, and say why aloud.
2. Look at a card showing "👀 2 others looking": what does it make you
   want to do?
3. Would you trust this post enough to go now?

Note their words, not scores, and record no names. Cost: the owner's
time, a small sample, and no ongoing data. It still matters because it is
the only option that hears from guests and first-time visitors, and the
only one that can answer the request's other two questions: hurry or feel
watched, and trust before the walk. Without it those stay on the "Judged"
list, and ADR 0002 stays "not yet tried with strangers". Nothing in this
plan blocks running it later. When it is run, the course's guidance on
testing with people applies, including what participants are told about
what is noted.

**D. Read only what's already stored.** An admin summary of
confirmations, stock reports and corrections per post after it was
posted, with no new UI. This is the cheapest. It can't tell a walk made
because of the post from someone already in the shop. Nor can it capture
cases 4 and 5 ("there, but not worth it", "too far"), and those are the
distinction the README's standard turns on.

**E. Ask later.** The page remembers on the device (in `localStorage`,
never sent) which posts the reader opened. On their next visit, a few
minutes to a day later, it asks once: "Did you go for Instant noodles at
Daily Market?" More of the answers would come from people who actually
walked. Cost: timing rules, a stored list, and a prompt that must not push
the first special off the first screen at 390×844 (the top of the page is
already `#notices`, the map and the filters). Worth adding on top of A if
the card question gets too few answers, but not first.

**F. A link to an external survey (Google Forms, etc.).** This reaches
guests. But it is another service, the data sits outside the SQLite
volume, it can't hold to one person, one account, it sends readers off the
page, and a third party sees who answered. Rejected.

## Acceptance

**Automated**: each becomes a test in `spec/`.

`spec/walks.test.ts` (new; over HTTP against the app `pnpm check` starts;
posts at `spar-civic`; identities from `person()`; skipped without
`writes`, like the other writing specs):

- [ ] A signed-in person who isn't the poster sends
      `POST /api/deals/:id/walk {worth: true}` and gets 200 with the deal,
      whose `myWalk` is `{worth: true, reason: null}`. For a guest, and for
      someone who didn't answer, `myWalk` is `null`.
- [ ] With one and with two answers, `walks` is `null` in
      `GET /api/deals/:id` and in `/api/deals?store=spar-civic`, read by a
      guest, by the poster and by an answerer. At the third answer it is
      `{worth, notWorth, latestAt}` with the right numbers, for all three.
- [ ] On a post with three answers: a guest's answer gets 401, and the
      poster's own answer gets 400. The counts are unchanged after each.
- [ ] Answering again replaces the answer: `{worth: false, reason: "gone"}`
      moves one from `worth` to `notWorth`. `{worth: null}` takes it back,
      and with only two answers left, `walks` is `null` again.
- [ ] Two identical requests from the same person, sent at once, count as
      one answer.
- [ ] Read by a third person or a guest, the deal's JSON contains no
      answerer's name or public id, and no list of who answered.
- [ ] These get 400: `worth` missing, or not `true`/`false`/`null`;
      `reason` not one of `gone`, `price`, `missing`, `poor`, `far`; any
      `reason` with `worth: true` or `worth: null`. Each of the five
      reasons is accepted with `worth: false`.
- [ ] An answer on a deleted post gets 404.
- [ ] A "gone" answer changes neither the post's stock, nor its place in
      `/api/deals?store=spar-civic`, nor its confirmations. A "worth the
      walk" answer leaves `confirmations` and `confirmedBy` unchanged.
- [ ] A guest's live stream receives exactly `{"type":"deal","id":N}`
      after each of these: the third answer, a later answer that changes
      the counts, and taking an answer back so that two are left. It
      receives no `deal` event for N within 1.5 s after each of these:
      the first answer, the second, the same answer sent again, and a
      reason added to an existing "not worth it".
- [ ] `GET /api/walks` gives 401 to a guest, 403 to a user and 200 to an
      admin. The admin's answer includes this test's post with its counts
      and reasons, including a post with only one answer. It contains no
      answerer's name, public id or cookie. (The admin part is skipped
      without `adminUser`, as in `accounts.test.ts`.)

`spec/walks-retention.test.ts` (new; its own app on a throwaway data
directory, started and restarted with `spec/launch.ts` as in
`admins.test.ts`). Time is moved by editing the stopped app's
`specials.db` with Node's built-in `node:sqlite`. With the server as it
is, that is the only way to make a week pass without adding a test-only
clock (the API refuses an end date in the past). The checks themselves
are over HTTP.

- [ ] Answers survive a restart: three answers, restart, the same counts.
- [ ] A post whose end date is moved to eight days ago has no answers
      after the next start: `walks` is `null` and the answerer's `myWalk`
      is `null`. A post moved to six days ago keeps them.
- [ ] An undated post whose latest stock report ("gone") is moved to eight
      days ago loses its answers. An undated post that isn't sold out
      keeps them, and so does one reported sold out eight days ago and
      then "some" since.
- [ ] Deleting a post removes its answers: after `POST
      /api/deals/:id/delete` and a stop, the `walks` table has no rows for
      it.

`spec/walks-page.test.ts` (new; the real `app.js` via `openPage` in
`spec/page.ts`):

- [ ] For a guest, a card with three answers (two "worth") shows
      "🚶 2 of 3 who went said worth it · latest …" and has no walk
      buttons. A card with two answers shows no count line and no buttons.
- [ ] For a signed-in non-poster, the card shows "Went for this?" with two
      buttons. Pressing "Worth the walk" sends exactly one
      `POST /api/deals/:id/walk`, and the row then reads "You went: worth
      the walk" with a Change button, plus the "once 3 people have
      answered" hint while there are fewer than three.
- [ ] Pressing "Not worth it" shows the five reasons. Pressing "Sold out"
      then sends the walk answer with `reason: "gone"` and no stock
      request (checked with `openPage`'s `network` spy). "Mark it sold out
      for the next person" then appears, and only pressing it sends
      `POST /api/deals/:id/stock {stock: "gone"}`. On a post already sold
      out, it doesn't appear.
- [ ] Pressing "Different price" opens that card's correction form with
      "Special price" chosen.
- [ ] Change, then "Take it back", sends `{worth: null}`, and the row goes
      back to the question.
- [ ] The poster's own card shows the count line (with three answers) and
      no walk buttons.
- [ ] After the third answer is sent over HTTP, a `deal` event played by
      `FakeEventSource` makes the open card's count line appear.
- [ ] With the session ended over HTTP (`POST /api/logout` with the same
      cookie), pressing "Worth the walk" records nothing (checked over
      HTTP afterwards), the card goes read-only with no walk buttons, and
      `#feed-status` says to log in. The test doesn't check which login
      screen appears, since plan 002 owns that.
- [ ] In each card the walk row comes after `.trust` and before
      `.history`, and nothing is added to the page before `#feed`.
- [ ] `/styles.css`: in the `min-width: 44rem` rules, `.deal` and
      `.feed > .skeleton` both span 13 rows, the highest `grid-row` given
      to any part of `.deal` is 13, and no `span 12` is left.
- [ ] `spec/forms.test.ts` still passes.

**Observed**: checked by a person in Chrome over the DevTools protocol
(CLAUDE.md: plain headless Chrome below about 500 px lays out wider than
asked), against a throwaway app with posts at zero, two and three answers.
Close each tab afterwards. Record what was seen, where and when.

- [ ] At 390×844, and again at 360 px and 400 px, guest and signed in,
      map open: the first special's item and price are on the first
      screen, and there is no horizontal scroll. (These are facts, not
      judgements; they are here only because `spec/` has no harness that
      lays a page out. See open question 4.)
- [ ] At 390×844 and 360 px, signed in: the two walk buttons sit on one
      line, the five reasons wrap inside the card without overflowing, and
      the count line wraps rather than widening the card.
- [ ] At 1920×1080, guest and signed in: the cards' rows still line up
      across a row of cards with the walk row in place, and the loading
      cards line up with real ones while the feed loads (slow the network
      in DevTools to see them).
- [ ] At 1920×1080, with two windows side by side, one signed in answering
      and one a guest on the same post: the third answer makes the guest's
      count line appear within moments, without a reload. The first and
      second answers change nothing on the guest's page.
- [ ] At 390×844, signed in, on a live post and on a sold-out one
      (judgement): the stock bar still reads as the first fact on the card
      and the count line as secondary, and the reasons read as optional.
      Passing means a person reading the card for the first time looks at
      stock before the walk row.

## Open questions

The owner answered the first draft's seven questions on 14 October 2026,
and the answers are built into the sections above: public counts (A); the
promise goes under README rule 2; answering still needs an account, and
login is redesigned in plan 002; "worth the walk" is not a confirmation;
five reasons; answers are deleted some time after the post ends; Option C
is deferred. Still open:

1. **When the count line shows (proposed, owner to confirm).** I propose
   from the third answer, enforced on the server (`walks: null` below
   it). It matches the correction quorum, keeps a single verdict off the
   card, makes it harder to guess who said what, and means a fake verdict
   takes three accounts. The cost is that on a quiet app the line will
   often not show. Two is the fallback, if the admin summary shows few
   posts reaching three. Reasoning in full under "When the count shows".
2. **A "never" line in CLAUDE.md (proposed, owner to confirm).** I propose
   adding "Show who answered whether a post was worth the walk, to anyone,
   admins included: walk answers leave the server only as counts, and each
   person's own answer to that person." Reasoning under "Changes the
   builder must make outside code".
3. **How long answers are kept (proposed, owner to confirm).** I propose
   seven days after the post ends, like shelf photos (`PHOTO_KEEP_DAYS`),
   in an hourly sweep beside `sweepPhotos`. Answers on a deleted post go
   at once. A post with no end date counts as ended when it has been sold
   out for seven days; one that is neither sold out nor deleted keeps its
   answers while it is in the feed. Reasoning and costs under "Rules it
   must keep". Its test moves time by editing a throwaway app's database
   between restarts; say if you would rather the server took a test-only
   clock instead.
4. **Layout facts as observed lines.** "The first special is on the first
   screen at 390×844" and "no horizontal scroll" are testable facts. But
   `spec/page.ts` runs `app.js` in jsdom, which computes no positions, so
   this plan leaves them to a person in Chrome. Should they stay observed
   for this build, or should a Chrome-driven spec harness come first? That
   harness would need its own plan, because it changes how every plan's
   layout lines are checked.

## Approval

None: this is a draft, not yet approved.

## Revisions

None: changes after approval go here, and this plan has not been approved.

## Built evidence

None: nothing has been built from this plan.
