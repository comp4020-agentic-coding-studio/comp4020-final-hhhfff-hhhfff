# 002. A login page of its own

- **Status:** Draft
- **README rule served:** none of the five numbered rules directly. It
  serves the paragraph they rest on: "Reading is free; writing needs an
  account. I first used a nickname and a browser-held key, since friction
  matters in an aisle. But the rules above count *people*, and a new browser
  was a new person" (README, after "What 'good' means here"). Rules 2 and 3
  count people, so people have to log in, and the README's stated worry is
  friction. To be plain about it: a separate page is one more step than
  today's panel, so it **adds** friction unless the reader comes back to
  exactly where they were with nothing lost. This plan treats that return
  as the core of the feature. The look serves no rule. It goes on the
  README's "judged" side, not the "enforced" side.
- **Asked for by:** the owner (u8113538), 14 October 2026: "Logging in
  should still be required to write. But login shouldn't just be a window
  that pops up at the top of the page. Make it a separate login page, and it
  should have a sense of design."

## Problem

Today, logging in is the hidden `#account` card in `public/index.html`. It
sits above the store header and the filters. The header's `#show-login`
button toggles it (`aria-expanded`), and `requireLogin(what)` in
`public/app.js` opens it through `showAuth(why)`, which scrolls it into view
and focuses the username. One form does two jobs: its submit button logs in
(`enter("/api/login")`), and `#register-btn` creates an account
(`enter("/api/register")`). What goes wrong, concretely:

1. **It loses your place.** A guest on a phone opens the comments on the
   eighth card and presses "Log in to comment". `showAuth` scrolls up to
   the panel at the top of the page, and the card leaves the screen. After
   `enter()` succeeds, `hideAuth()` folds the panel away and the feed
   reloads. The card's comments stay open (`renderFeed` keeps open
   `details`), but the reader is at the top of the page. Nothing scrolls
   back to the card or puts the cursor in its comment box.
2. **Registering is a second-class button.** Both actions share
   `autocomplete="current-password"`, so Chrome doesn't offer to generate a
   password for a new account and may save it as an update to another one.
   Enter always logs in, so a newcomer who types a name and presses Enter
   gets "wrong username or password".
3. **It doesn't tell newcomers two things they need to know.** Your
   username is shown on everything you post (`by amy` on every card). And
   there is no password reset: the README says "I chose not to build email
   login, password reset".
4. **Errors are the server's raw words.** `enter()` shows `err.message`:
   "wrong username or password", "that username is taken", "too many wrong
   passwords, wait a minute". The page doesn't say which field to fix, and
   the button stays pressable during the 429 pause.
5. **A lapsed session strands what you typed.** Your session can end
   because you logged out in another tab, or after `SESSION_DAYS` (30). Then
   pressing Post shows "Log in first (top of the page)." (the `#post`
   submit handler). A comment being typed is worse off. The 401 makes
   `apiResponse` call `syncMe()`, which re-renders every card for the new
   "person" (`cardKey` includes `me.id`), and the typed text is gone. Only
   the post form survives, because it isn't part of the feed.
6. **It looks like an afterthought.** It's a plain `.card` with a flex row
   of fields (`styles.css`, the `.account` rules). There is nothing of the
   app's own language: the red masthead, the yellow shelf ticket
   (`.prices`), the starburst sticker (`.off[data-depth="huge"]`), the
   rubber stamp (`.sold-out::after`). In the owner's words, it is "just a
   window that pops up".

## What the reader sees

### Getting to the page

- **Addresses.** `/login` logs in; `/register` creates an account. Both are
  the same new page (`public/login.html` with `public/login.js`). Each has
  its own heading, button, `<title>` and password autocomplete, so password
  managers see two distinct forms. A link on each switches to the other in
  place (no reload). It updates the address with `history.replaceState`,
  keeps the typed username, clears the password, and carries `next` across.
- **From the header.** The header's "Log in" becomes a link (`<a
  id="login-link" class="on-accent">`) that looks exactly like today's
  button. Its address is `/login?next=<this page>`, where "this page" is the
  path and search as `syncAddress()` keeps them: for example
  `/login?next=%2Fstores%2Fcoles-civic%3Fq%3Dmilk%26page%3D2`. The link is
  rebuilt whenever the address changes (in `syncAddress`, on `popstate`,
  and at start), so it always carries the page as it is now.
- **From a write button a guest presses.** Every way a guest is asked to
  log in becomes a real link, not a script navigation. It looks the same as
  now, and it carries an *intent* in the hash of `next`:
  - "Log in to post a special": for a guest, a link `#post-login` with
    `.post-toggle`'s look stands where `#post-toggle` stands. Its target is
    `next=<this page>#post`. Wherever the page hides the post button today
    (`showStorePage` for the store list, `showSingleLayout`), it hides both.
    For a guest, "Post the first one" (`#post-first`) follows the same link.
  - "Log in to comment" on a card (`.login-to-comment`, now an `<a>`):
    `next=<this page>#comment-<deal id>`.
  - The address is worked out when the link is pressed (on `click` and
    `auxclick`), because a card can be reused from the `built` cache after
    the reader changed page or search.
- **Button wording stays as it is.** "Log in", "Log in to post a special"
  and "Log in to comment" are unchanged, so the CLAUDE.md line "a guest sees
  the feed and a prompt to log in, and the write buttons ask them to" holds
  word for word. The only text that goes is "Log in first (top of the
  page)." (see "Half-done work").

### Coming back to exactly where you were

- **Where you land.** After a successful login or registration,
  `login.js` goes to the checked `next` with `location.replace`. The login
  page then isn't left in history: Back from the feed goes to the page you
  pressed "Log in" on, not to the login form.
- **What is returned.** The path and search, which covers the page
  (`/`, `/stores`, `/stores/<id>`, `/deals/<id>`), the search (`q`) and the
  page number (`page`). Your scroll position comes back too. The page
  doesn't save a pixel offset, which would be wrong once signed-in cards
  are taller. It saves the id of the card at the top of the screen and, on
  return, scrolls that card to the top. If the card is gone, you land at
  the top of the page.
- **The intent, on return.** `app.js` reads the hash once the feed has
  rendered and then removes it (`history.replaceState`), so a reload
  doesn't repeat it:
  - `#post`: the post form opens (a sheet on a phone, as `openPost()` does
    now).
  - `#comment-<id>`: that card's comments open and the cursor goes into the
    comment box. If the card is no longer on this page (sold out and moved
    down, or a new page one), `#feed-status` says "That special has moved:
    open it" with a link to `/deals/<id>#comment-<id>`, and the saved text
    goes with it. If the special was deleted, it says so.
  - If you're still a guest (you pressed Back on the login page), the hash
    is removed and ignored.
- **One-tap actions are never replayed.** Confirming, reporting stock and
  agreeing to a correction aren't offered to guests anyway (their card is
  read-only). If a lapsed session refused one, the button is back on the
  card after login, to be pressed again. The page never sends a write on
  the reader's behalf after login.
- **Checking `next` (no open redirect).** It is checked in one function in
  `login.js`, and the result is shown as the page's "← Back to …" link. A
  test can therefore read exactly where the page would send you, and the
  reader can see it too. The rules:
  1. A missing `next`, or one longer than 512 characters, gives `/`.
  2. The decoded value must start with `/`, must not start with `//`, and
     must contain no `\`.
  3. `new URL(raw, location.origin)` must have `origin ===
     location.origin`. The URL parser drops tabs and newlines, so `/`,
     a tab, then `/evil` becomes `//evil` and fails here.
  4. The pathname must match one of: `^/$`, `^/stores$`,
     `^/stores/[a-z0-9-]{1,60}$`, `^/deals/\d{1,9}$`. These are the pages
     with write buttons. `/login`, `/register`, `/readme/` and `/api/…` are
     not allowed, so the page can't loop on itself or point at an API.
  5. The result is **rebuilt, never echoed**: the matched pathname, then
     only `q` (at most 80 characters, like `SEARCH_MAX`) and `page` (1 to
     100000), re-encoded with `URLSearchParams`, then only a `#post` or
     `#comment-\d{1,9}` hash. Anything else is dropped.
  6. Anything that fails gives `/`. The page says nothing alarming; it
     simply returns home.

  The label of the back link follows the path: "← Back to the specials"
  (`/`), "← Back to the stores", "← Back to the store", "← Back to the
  special". No fetch is needed for it.

### Half-done work

Every login link, when pressed, first saves what is half-typed on the page
into one record in the tab's `sessionStorage`. The key is
`discountShow.return`, named like the existing `discountShow.theme`. The
record holds:

```
{ at: "/stores/coles-civic?q=milk", savedAt: <ms>, top: <deal id> | null,
  post: { storeId, product, was, now, endsOn, stock, source } | null,
  comments: [{ dealId, body, replyTo }], corrections: [{ dealId, field, value, note }] }
```

- **Restored, never sent.** After login, `app.js` restores the record only
  when the person is signed in, the address equals `at`, and it is under 30
  minutes old. The post form reopens with its fields filled. A comment goes
  back into its card's box, with the "Replying to @…" chip if it had one,
  and a correction goes back into its card's form. Nothing is submitted;
  the reader presses Post or Reply themselves. The record is deleted once
  it is used, or once it is found stale or for another address.
- **The shelf photo isn't kept** (open question 3). If the draft had one,
  the reopened form says "Your photo wasn't kept. Add it again." beside the
  photo field.
- **A lapsed session.** In place of "Log in first (top of the page).", the
  post form's error line says: "You've been logged out (maybe in another
  tab). **Log in to post it →**". The link saves the draft, with `#post` as
  its intent. A comment or correction refused with 401 shows the same
  message on its card, with `#comment-<id>`.
- **When the page learns the person changed.** Before `syncMe()`
  re-renders the cards for a different person, it saves any typed comment
  or correction into the record. The card then turns read-only, as a
  guest's card must. Its "Log in to comment" link reads "Log in to send
  your comment", and after login the text is back. This fixes problem 5.
- **What is never saved:** the password, the session, any user id, or
  anything sent to the server. The record lives only in this tab, goes when
  the tab closes, expires after 30 minutes, and logging out deletes it.
- **Storage blocked** (private mode, or storage disabled): every
  `sessionStorage` call is in `try`/`catch`. Nothing is saved, but the
  intent in the hash still opens the right form, just empty.

### Already logged in, and logging out

- **Visiting `/login` while logged in.** The page asks `/api/me`, a
  same-origin fetch that carries the cookie. The server can't decide this,
  because the session cookie is `SameSite=Strict` (`setCookie` in
  `server/server.ts`). A link from a chat app or another site therefore
  arrives without it, though the page's own fetch has it. If someone is
  signed in, the card shows "You're logged in as **amy**" ("amy (admin)"
  for an admin). It offers a primary link "Back to the specials →" (to the
  checked `next`) and a quiet "Log out" button that switches to the form
  with "Logged out." (open question 1: or go straight back).
- **Logging out from the feed.** The header's "Log out" stays a button and
  keeps today's handler: `POST /api/logout`, then the page becomes a guest's
  at the same address, because reading is free. It also deletes the return
  record and writes a timestamp to `localStorage["discountShow.session"]`
  so other tabs notice. `#feed-status` says "You're logged out. Reading
  stays free." Focus moves to the header's "Log in" link, because the
  button that had focus has gone.

### The look

"A sense of design" here means the login page is unmistakably discountShow.
It uses the colours, shapes and motion the feed already uses, not a generic
centred box. It takes no web font, no image file and no library: everything
is CSS on the existing tokens in `:root` (`styles.css`, top), so dark mode
comes free through `light-dark()`.

- **The idea.** You are standing at the shelf: the red shop sign above, a
  yellow shelf tag naming what this is, and a ticket with a tear-off stub.
- **The masthead.** The same red band (`.masthead`, `--accent`), with the
  name as `<p class="title">` linking home, as `/readme/` does, because the
  page's `h1` is "Log in". On the right is only the theme button
  (`#theme-toggle`, behaving exactly as on the feed). There is no site nav,
  no live badge and no "Log in": a focused page. Under the band hangs an
  **awning edge**, a row of red half-discs 1.5rem wide and 0.75rem deep,
  drawn with a repeating `radial-gradient` on `.masthead::after`. It is
  purely decorative and invisible to screen readers.
- **The back link.** "← Back to the specials" (the checked `next`), 0.9rem,
  `--muted`. It sits above the card, as "← All stores" sits on a store page
  (`.store-head .back`).
- **The shelf tag (the heading).** A yellow tag in the shape of the price
  ticket: `--ticket` background, `border-radius: 4px 12px 12px 4px`, a
  punched hole on the left (`.prices::before`, coloured `--card`). It is
  tilted −1° and overlaps the card's top edge by about half its height, as
  a tag clipped to a shelf edge. It holds the page's `h1`, "Log in" or
  "Create an account", at 1.9rem, weight 800, letter-spacing −0.02em, in
  `--ticket-price` red on yellow, like a card's special price. On the
  tag's right end is a **starburst sticker** reading "FREE". It is the
  existing `.off[data-depth="huge"]` shape (the `clip-path` polygon,
  `#d0102b`, white, `rotate: -10deg`), 3.6rem across. It is decorative
  (`aria-hidden`), and the "why" line says accounts are free in words. At
  360 px, "Create an account" wraps to two lines on the tag; that's
  allowed.
- **The ticket (the card).** `.card` (`--card`, 1px `--line`, 10px radius).
  It is at most 26rem wide, with 1.25rem padding (1rem at 360 px) and room
  at the top for the tag. Inside it:
  - **The why line**, 0.95rem, `--muted`. By default: "Post what you
    spot, and confirm, correct or mark sold out what others post. It's
    free, and reading needs no account." With `#post`: "Log in to post a
    special. Reading stays free." With `#comment-…`: "Log in to comment.
    Reading stays free." (the same wording `showAuth` builds today).
  - **Fields**: visible labels above each field (0.9rem, weight 600, as
    `.post label`), never placeholders. The inputs are bigger than the
    feed's for a thumb: padding 0.7rem 0.8rem, font-size 1.05rem (16px or
    more, so iOS doesn't zoom), 8px radius, about 48px tall.
  - **"Show"/"Hide"** sits inside the password field's right edge: a
    `button type="button"`, `.quiet.small`, `aria-pressed`,
    `aria-controls="password"`, with a 44px hit area. It changes only the
    input's `type`.
  - **Hints** appear only on `/register`, linked by `aria-describedby`.
    Username: "3–24 letters, digits, - or _. It's shown on everything you
    post." Password: "At least 8 characters. There's no password reset, so
    let your browser or password manager save it." (open questions 2 and
    4).
  - **The error box** (`role="alert"`) sits above the button: `.error`
    text (`--accent-text`, weight 600) on `--soft`, with a 3px left bar in
    `--accent-text`, padding 0.5rem 0.75rem. It is hidden when empty, as
    `.error:empty` already is.
  - **The primary button** is full width: `--accent` background,
    `--accent-ink` text, 1.05rem, weight 700, padding 0.8rem, 8px radius,
    with `.post-toggle`'s hover lift (`translate: 0 -1px` and its shadow).
    It doesn't get the perpetual sheen: this page has nothing to be
    noticed among.
  - **A perforation** follows: a 2px dashed `--line` rule with a
    half-circle notch cut into each side of the card (two `--paper` circles
    on the card's edges). Below it, on the "stub", is the switch: "New
    here? **Create an account**" or "Already have an account? **Log in**"
    (`--accent-text`, weight 600).
- **Under the card**: three mini shelf tags, under the heading "What an
  account lets you do": "Post a markdown you spotted", "Confirm it, or
  correct the price", "Mark it sold out before someone walks". Each is
  yellow with a punched hole, `--ticket-ink`, 0.95rem, weight 700, tilted
  −1.5°, 1° and −0.5° like tags pinned to a board. Then the closing line
  "Reading is free, with or without an account."
- **Type.** The app's own `system-ui` stack. Weight 800 for the tag
  heading (as `.prices .now`), 700 for buttons, 600 for labels. Small
  capitals spaced 0.08em on the sticker (as `.prices .off small`). Tabular
  figures for the 429 countdown.
- **Dark mode** (the system's, or chosen with the toggle, which
  `theme.js` applies before paint). The shelf tag, sticker and mini tags
  stay yellow and red, as cards' tickets do ("the shelf ticket stays yellow
  in dark mode too"). The punched hole takes the card's dark colour, and
  the card, fields, muted text, error red (`#ff7a8a`) and focus ring
  (`#7aa7ff`) all follow their existing dark values. The awning and button
  use the dark `--accent` (`#b5102a`) with white text. Nothing new needs a
  dark value of its own except the notch circles, which use `--paper`.
- **Motion**: once, small, and never perpetual on this page (unlike the
  feed's glint and live pulse).
  - On load, the card drops in with the existing `drop-in` (0.25s), and the
    sticker stamps on with the existing `stamp-on` (0.4s, 0.15s delay).
  - A wrong password gives a short horizontal shake of the card (new
    `shake`, 0.3s, ±4px, three times). A 429 doesn't shake.
  - Switching between log in and register fades the tag's heading in
    (`fade-in`, 0.2s).
  - On success, the button turns `--good` green and reads "✓ Logged in"
    (or "✓ Account created"). The page leaves at once, with no wait for an
    animation.
  - With `prefers-reduced-motion: reduce`, none of it moves. The global
    rule at `styles.css` (the `*, *::before, *::after` block) already stops
    every animation and transition. The error still shows by its box, its
    bar and focus, never by motion alone. No motion is driven from script.
- **Layout by width.**
  - **Phone (below 44rem), at 390×844**: one column with 1rem gutters. From
    the top: masthead (about 46px), awning, back link, the card with the
    tag across its top edge, then the mini tags. The tag, why line, both
    fields and the button end about 480px down. They fit on the first
    screen, and with the on-screen keyboard up (about 340px), the focused
    username and the password stay above it. The masthead is one row at 360
    px: the feed's `max-width: 24rem` rule, which shrinks `.masthead h1` to
    1.2rem, is extended to `.masthead .title`.
  - **Tablet (44–64rem)**: the same column, centred, the card 26rem.
  - **Desktop (64rem and up), at 1920×1080**: the masthead's `.wrap` is
    76rem as on the feed, so the name doesn't jump when you come from the
    feed. Below it is a two-column grid, at most 60rem wide and centred,
    `1fr 26rem`, with a 3rem gap and about 4rem from the masthead. On the
    left: the site's tagline "Cheap food, spotted by students, for
    students." at 2.25rem, weight 800, `--ink`, at most 18ch wide, with the
    three mini tags under it. On the right: the card. All of it sits within
    the first 700px or so, with nothing wider than 60rem.

### Guest at 390×844 (and 360 px, 400 px)

- **On the feed**, nothing moves. The header's "Log in" link has the same
  size and colours as today's button, and the guest's post button, which
  is now a link, looks like `.post-toggle`. Removing the hidden `#account`
  card changes nothing on screen. The first special is where it was, with
  the map open. "Log in to comment" in an open comment section looks like
  today's quiet small button.
- **On `/login`**, the layout is as above. The cursor starts in Username
  (`autofocus`; the page's only job is this form). The reader types,
  presses Enter or "Log in", sees "Logging in…", and lands back where they
  were, with the post form or comment box open if that's why they came.
- **At 360 px**: no horizontal scroll. "Show" stays inside the password
  field. The sticker overlaps the tag's end but not the heading text.
  "Create an account" wraps on the tag.

### Signed in at 390×844

- **On `/login`**: the "You're logged in as amy" card, as above.
- **On the feed after coming back**: the page as a signed-in person sees it
  today, at the same address, with the card that was at the top of the
  screen at the top, and any intent and draft restored. The header shows
  the name and "Log out", as now.

### Guest and signed in at 1920×1080

- **`/login` and `/register`**: two columns, as above. The theme toggle
  works there. Signed in, the right-hand card is the "You're logged in"
  card.
- **The feed**: unchanged, apart from the header link and the
  post-button link for guests looking the same as before.

### Admin

The same page. Admins still come only from `ADMIN_USERS`, and nothing on
the login or register page can ask for a role. The "already logged in" card
adds "(admin)" after the name, as the header's `#who` does.

### Real-time: a second session beside the first

- **Same browser, another tab or window.** When one tab logs in or out,
  the other follows within moments. `login.js` and the logout handler
  write a timestamp to `localStorage["discountShow.session"]`. The value
  holds no name, id or token, only "something changed". `app.js` listens
  for the `storage` event on that key and runs `syncMe()`, which already
  reconnects the live stream and reloads the feed. Today the other tab
  notices only when it is hidden and shown again (`visibilitychange`), so
  two windows side by side stay out of step (open question 7). A comment
  typed in the other tab is saved first (see "Half-done work").
- **Another browser or device.** Unaffected: its session is its own, and
  logging out ends only that session (`spec/accounts.test.ts`).
- **The live stream.** `/login` opens none. While someone is on the login
  page, they hold no listener against the 300 cap and count on no post's
  "👀 N others looking". The feed they left closed its stream when they
  navigated away, and reopens it on return. After login, `connectLive()`
  reconnects as them, so their notices arrive, as now.

### States

- **Loading.** `/login` is static HTML and usable at once. Its `/api/me`
  check runs in the background. If it finds a session, the "already logged
  in" card replaces the form, normally before anyone can type. If it fails
  (offline), the form stays. While a login is being sent, the button reads
  "Logging in…" (or "Creating your account…") and has
  `aria-disabled="true"`. It isn't `disabled`, which would throw focus to
  the page. The form has `aria-busy="true"` and repeat presses are ignored.
  Back on the feed, its own "Loading specials…" and skeleton cards show as
  now, and drafts are restored after the first render.
- **Empty.** Pressing "Log in" with an empty field says "Enter your
  username." or "Enter your password." and focuses that field. Nothing is
  sent.
- **Errors.** Each puts its text in the error box, marks the field
  `aria-invalid="true"` and links it to the box with `aria-describedby`,
  then moves focus to the field to fix:

  | Server answer | The page says | Focus, fields |
  |---|---|---|
  | 401 on login | "That username and password don't match. Check both and try again." (It never says which, as the server doesn't.) | Password, cleared; username kept. The card shakes. |
  | 400, bad username | "Usernames are 3–24 letters, digits, - or _." (Checked before sending, too.) | Username |
  | 400, bad password | Log in: "Passwords here are at least 8 characters." Register: "At least 8 characters, at most 128." (Checked before sending, too.) | Password |
  | 409 on register | "Someone already has the name amy. Pick another, or log in if it's yours." with a quiet button "Log in as amy instead", which switches to log in and keeps the name. | Username |
  | 429 on login | "Too many wrong passwords for amy. Try again in 60 s." The button reads "Wait 60 s" (`aria-disabled`) and counts down each second. A separate polite live region announces only the start and "You can try again now." The pause is per username (`loginBlocked` in `server/server.ts`), so changing the username field re-enables the button at once. 60 s always covers what's left of the server's window. | Username |
  | Network failure, or 5xx | "Couldn't reach discountShow. Check your connection and try again." | Fields kept. The button works again. |

- **Live connection lost.** The login page has no live stream and no badge,
  so there is nothing to lose there. Back on the feed, the badge behaves as
  now.
- **Sold out.** Nothing on the login page. A comment intent on a post that
  sold out meanwhile still opens, since sold-out cards take comments. If it
  moved off the page, the status line links to it (see "Coming back").

## Rules it must keep

From "What the app must never do":

- **No guest writes; identity only from the session cookie.** No server
  route changes. `/api/login` and `/api/register` take `{username,
  password}` and nothing else matters; a `role` in the body is already
  ignored (`spec/accounts.test.ts`). The login page sends exactly those two
  fields. Neither `next`, the hash nor the return record carries an
  identity, and the page never sends a write on the reader's behalf after
  login.
- **No password, hash or session token in any response.** The login page's
  HTML is the same bytes for a guest and a signed-in person, and it sets no
  cookie. The "already logged in" card shows only what `/api/me` already
  returns (`{id, name, role}`; the public id isn't displayed). `login.js`
  never writes the password anywhere: not to storage, the address, the
  console or an attribute. "Show" changes the input's `type` only.
  - The form is `<form method="post" action="/api/login" novalidate>`. If
    the script failed to load, Enter would then POST the password in a body
    (the server answers 400) rather than GET it into the address bar and
    history. Today's `#auth` form has no `method`, so it has that latent
    flaw (latent, because the form is hidden until the script shows it).
  - A public id never stands in for a session: nothing here reads one.
- **Permissions from the role table.** `server/auth.ts` is untouched.
  Admins still come only from `ADMIN_USERS`.
- **Validators and rendering.** The server's `USERNAME` and `password()`
  checks stay the only gate. The page's own checks mirror them for quick
  feedback, never instead of them. Every name, message and label is set
  with `textContent`.
- **The live stream** is untouched: ids only, the listener cap unchanged.
  The login page opens no stream at all.
- **256 MB, no new dependency, no build step.** Two small static files
  (about 80 lines of HTML, about 250 of script), served like `index.html`.
  No library, font or image.
  - `spec/page.ts` evaluates `app.js` as text, so neither `app.js` nor
    `login.js` may use `import`. The theme button's code (`showTheme` and
    its click handler in `app.js`) therefore moves into `public/theme.js`.
    It is wired on `DOMContentLoaded` and does nothing on a page without
    `#theme-toggle`. Both pages then share one copy.
- **No data lost.** Nothing new is stored on the server. `Dockerfile`
  already copies all of `public/`.

From "What the pages must hold to":

- **Specials first; the post form folded; the map open.** The feed's
  layout doesn't change: the hidden `#account` card is removed, and the
  header link and the guest's post link keep their old size. The first
  special still shows on the first screen at 360, 390 and 400 px with the
  map open.
- **A guest sees the feed and a prompt to log in; the write buttons ask
  them to.** Kept, with the same words. The prompts now lead to a page
  instead of opening a panel. A guest's card stays read-only.
- **Form field names.** The login form's fields are `username` and
  `password`. Its ids (`username`, `password`, `login-error`,
  `username-hint`, `password-hint`, `show-password`) are none of the
  reserved names `spec/forms.test.ts` collects. That test must also check
  `/login` and `/register`.
- **No horizontal scroll** at 360 px, 400 px or desktop, checked over the
  DevTools protocol with each tab closed after, as CLAUDE.md says.
- **Today is Canberra's today, and prices are cents.** Not touched.

New, for the builder to add (not mine to change):

- **`server/server.ts`.** `GET /login` and `GET /register` serve
  `public/login.html` through `sendPage`, which gains a `file` argument
  (default `index.html`). `login.html` carries the same `<!-- page meta -->`
  markers as `index.html`. The titles are "Log in · discountShow" and
  "Create an account · discountShow", and the description is "Log in to
  post and keep specials near ANU honest. Reading is free." If approved
  (open question 8), these two responses also send
  `content-security-policy: frame-ancestors 'none'`, so the login form
  can't be framed by another site and clicked through.
- **`public/index.html` and `public/app.js`.**
  - Remove `#account`, `showAuth`, `hideAuth`, `enter`, the `WHY` text and
    their handlers. `requireLogin(what)` stays the single gate, but instead
    of opening a panel it shows the inline "You've been logged out… Log in
    to … →" link and returns `false`.
  - Add `loginHref(intent)`, `saveReturn()`, `restoreReturn()` and the
    `storage` listener.
  - In `public/styles.css`, remove the `.account` rules and add `a.on-accent`
    (the button's look on a link) and the login page's rules.
- **`README.md`.** "What is enforced" should gain: "logging in returns only
  to the app's own pages, with what was half-typed restored and never sent"
  (open question 8). The judged list should gain whether the login page
  looks like discountShow.
- **`CLAUDE.md`.** Propose a "never" line for the owner: "Send someone off
  the site, or to an API, after logging in: the return address is checked
  against the app's own pages and rebuilt."

## Out of scope

- **Password reset, email, social login, passkeys.** The README chose
  against email login and password reset. Social login needs another
  service. Passkeys are their own plan.
- **Changing your username or password, deleting an account, a profile
  page.** Each is a new write and needs its own plan.
- **Limiting registrations or CAPTCHA.** Not asked for. Throwaway accounts
  are already admitted as a weakness of the quorum in PROCESS.md.
- **Any change to `/api/login`, `/api/register`, `/api/logout`, `/api/me`,
  session length or the 429 rule.** The page fits the API as it is. (A
  `Retry-After` header would let the countdown be exact, but 60 s is always
  enough.)
- **Logging in without JavaScript.** The whole app needs it. The form's
  `method="post"` only makes sure a failed script can't leak the password
  into the address.
- **Plan 001's "Went for this?" row.** It will use this flow, since a
  guest's prompt to answer is just another login link with an intent. Its
  buttons, wording and intent name belong to 001.
- **The `/readme/` page's header.** It keeps its own simple masthead.

## Options considered

**A. Its own small page at `/login` and `/register`, returning through a
checked `next`, with drafts kept in the tab (recommended).** What the reader
sees is described above.

- Cost: `public/login.html` and `public/login.js` (new), about 180 lines of
  CSS, and in `app.js` about 70 lines removed and 130 added (links, return
  record, restore, `storage`).
- The theme button's code moves to `theme.js`, `sendPage` gains a file
  argument, and two routes are added.
- The masthead's markup exists twice (`index.html`, `login.html`), so a
  test checks that they agree on the name link and theme button.
- Gain: the page loads only `styles.css`, `theme.js` and about 8 KB of
  script. It doesn't load `app.js` (about 30 KB gzipped), the stores or a
  live stream. It is a real page with its own address, which a password
  manager can recognise, Back can leave and a link can open.

**B. `/login` as another view of `index.html`, switched by `app.js`
(client-side, with `pushState`).** It is the same idea as `single` and
`directory`: the feed, map and filters hide, and a full-page login view
shows.

- What the reader sees is almost the same, and a press of "Log in" never
  reloads. Half-done work could stay in memory with no `sessionStorage` at
  all, which is B's real advantage.
- Cost: `app.js`, already about 2,500 lines with three page modes, gains a
  fourth and a router. A direct visit to `/login` loads the whole app,
  fetches the stores and the feed, and opens a live stream. That counts
  against the 300-listener cap and adds a "looker" to presence for someone
  who is only logging in. Every startup step (`loadFeed`, `drawMap`,
  `connectLive`) needs a guard. Password managers handle it less reliably,
  because the "page" never changes.
- Worth choosing if keeping drafts in storage is unacceptable.

**C. Keep it on the feed, but as a designed modal (`<dialog>`) in the
middle of the screen.** This is the cheapest: no new route, nothing lost,
and the new look could be applied as is. It isn't a separate page, so it
doesn't do what was asked. Rejected, and listed so the owner can see what
was given up.

**D. Open the login page in a new tab** and let the original page pick up
the session through `syncMe()` when shown again. The original page and
everything typed in it stay untouched. But on a phone a new tab is easy to
lose, the reader has to find their way back, and two tabs then hold two
live streams. Rejected.

**Sub-choices within A:**

- **Register: the same page with two addresses (recommended), its own
  page, or one form with two buttons (today).** Two addresses on one file
  give each its own heading, `autocomplete` (`current-password` or
  `new-password`) and Enter behaviour, at no extra file. A separate file
  would repeat the masthead and the styles hook-up a third time. One form
  with two buttons keeps problem 2.
- **The return address: in `next`, checked and rebuilt (recommended);
  only in `sessionStorage`; or from the `Referer` header.**
  - `sessionStorage` alone has no open-redirect surface at all. But it
    fails in a new tab, after storage is blocked, and for a link opened
    later, so it's kept for drafts, not the address.
  - `Referer` is unreliable (policies strip it), it would need the server
    to choose the destination, and it leaks search words.
- **After login: replace the login page in history (recommended) or push
  the destination.** Pushing leaves Back from the feed pointing at a login
  form you've already used.

## Acceptance

**Automated**: each becomes a test.

`spec/login-page.test.ts` (new; over HTTP, the HTML parsed with JSDOM and
no script run). The account-making parts sit under `skipIf(!writes)`.

- [ ] `GET /login` and `GET /register` answer 200 `text/html` with
      `<title>Log in · discountShow</title>` and `<title>Create an account ·
      discountShow</title>` (and the same `og:title`).
- [ ] `/login` has a form with `method="post"`, an input `username`
      (`autocomplete="username"`, `autocapitalize="none"`) and an input
      `password` of `type="password"`, each with a visible `<label>`.
- [ ] `/login` loads `/theme.js` in the head before `/styles.css`, loads
      `/login.js`, and does not load `/app.js`.
- [ ] `/login`'s masthead has the name linking to `/` and a
      `#theme-toggle` whose `aria-label` matches the feed's.
- [ ] Fetched with a signed-in person's cookie, `/login` returns exactly
      the same HTML as for a guest, contains neither the person's name, id
      nor cookie value, and sends no `set-cookie`.
- [ ] If open question 8 is approved: both pages answer with a
      `content-security-policy` containing `frame-ancestors 'none'`.

`spec/forms.test.ts` (updated):

- [ ] Runs its reserved-name check over `/`, `/login` and `/register`.

`spec/theme.test.ts` (updated):

- [ ] Its "theme.js in the head, before the styles" test includes `/login`.
- [ ] New: in a page with a `#theme-toggle`, `theme.js` wires the button.
      One press goes from system to light, sets `data-theme="light"`,
      stores `discountShow.theme`, and the `aria-label` names the next
      choice.

`spec/login-flow.test.ts` (new; the real `app.js` through `openPage` and
the real `login.js` through a new `openLogin(as, path, {session})` helper in
`spec/page.ts`):

- The helper waits until the page has its `/api/me` answer, which
  `login.js` marks with `data-ready` on the form. `openPage` gains a
  `session` option that seeds `sessionStorage` before the script runs.
- jsdom doesn't navigate, so these tests read the links' addresses, the
  back link (which is what `location.replace` is given) and the network
  spy, never a page change. Identities come from `person()`. Writing tests
  sit under `skipIf(!writes)`.

The tests:

- [ ] A guest on `/stores/coles-civic?q=milk` sees a header link
      `#login-link` whose `href` is `/login?next=` +
      `encodeURIComponent("/stores/coles-civic?q=milk")`. After the search
      changes to `tea`, the link follows.
- [ ] A guest's "Log in to post a special" is a link to
      `/login?next=…%23post`. A card's "Log in to comment" is a link to
      `…%23comment-<id>`, built at the press: after moving to another
      search, it carries that search. No `POST` goes out while a guest
      presses any of them.
- [ ] On `/login?next=` + `encodeURIComponent(v)`, the back link is
      exactly `/` for every hostile `v`:
      - `https://evil.example/`, `//evil.example`, `/\evil.example`,
        `\/evil.example`, `/` + a tab + `/evil.example`,
        `/` + a newline + `/evil.example`, `javascript:alert(1)`,
        `http:evil.example`;
      - `/login`, `/register`, `/api/logout`, `/readme/`,
        `/stores/../api/me`, `/deals/abc`;
      - a 600-character path.

      For each allowed `v`, it is the value rebuilt:
      - `/` stays `/`;
      - `/?q=milk&page=2` stays `/?q=milk&page=2`;
      - `/stores/coles-civic?q=milk&evil=1` becomes
        `/stores/coles-civic?q=milk`;
      - `/deals/42#comment-42` stays `/deals/42#comment-42`;
      - `/deals/42#x` becomes `/deals/42`.
- [ ] Logging in on `/login?next=%2Fdeals%2F<id>%23comment-<id>` as a
      registered person sends exactly one `POST /api/login`, whose JSON
      keys are exactly `username` and `password`. The button then reads
      "✓ Logged in", and the destination (the back link) is
      `/deals/<id>#comment-<id>`. The password appears in neither
      `sessionStorage`, `localStorage` nor `location.href`.
- [ ] A wrong password puts the "don't match" text in `#login-error`
      (`role="alert"`). The password input gets `aria-invalid="true"`, is
      empty and has focus, and the username is kept.
- [ ] After five wrong passwords over HTTP, the page's next try shows the
      wait, with the submit button `aria-disabled="true"` and reading
      "Wait". Editing the username field makes it pressable again.
- [ ] On `/login`, pressing "Create an account" changes the `h1` to
      "Create an account", the address to `/register?next=<same>`, and the
      password's `autocomplete` to `new-password`. The username is kept
      and the password cleared.
- [ ] Registering a taken name shows the "already has the name" text and a
      "Log in as … instead" button. Registering a fresh name sends
      `POST /api/register` (201), and the button reads "✓ Account
      created".
- [ ] `/login`, opened as a signed-in person, shows "You're logged in as
      <name>", a continue link and "Log out". Pressing "Log out" sends
      `POST /api/logout`, the form appears, and `/api/me` with that cookie
      is then `null`.
- [ ] A signed-in page opened at `/#post`, with `discountShow.return`
      seeded for `/` and holding a post draft, shows `#post` open with
      those values in its fields. No `POST /api/deals` is sent, the record
      is gone, and the address has no hash.
- [ ] A record for another address, or more than 30 minutes old, is not
      restored and is removed.
- [ ] A signed-in page opened at `/deals/<id>#comment-<id>`, with a saved
      comment for that address, shows the card's comments open, the text
      in its box and focus in the box. Nothing is posted.
- [ ] With the page open as a person whose session is then ended over
      HTTP: the person types a comment and presses Reply. The record in
      `sessionStorage` then holds that text (and no password or user id),
      and the card's login link points to `…%23comment-<id>`.
- [ ] Pressing the header's "Log out" sends `POST /api/logout`. The page
      keeps its address as a guest, and `#feed-status` says "You're logged
      out". Focus is on `#login-link`, the record is removed, and
      `localStorage["discountShow.session"]` has changed.
- [ ] A `storage` event for `discountShow.session` makes the page ask
      `/api/me` (seen by the network spy).

Existing files stay green. Nothing in `spec/` refers to `#account`,
`#show-login`, `#register-btn` or `#auth-cancel` today.

**Observed**: in Chrome over the DevTools protocol, local, each tab closed
after. Record the date, width, guest or signed in, theme, and what was seen.

- [ ] **At 390×844 (and 360 and 400 px), guest, light and dark, on `/login`
      and `/register`.** The masthead is one row. The back link, the tag
      with its sticker, the why line, both fields and the button are on the
      first screen without scrolling. There is no horizontal scroll, the
      sticker doesn't cover the heading's text, and "Show" stays inside the
      field.
- [ ] **At 1920×1080, guest and signed in, light and dark.** Two columns,
      the card about 26rem, everything within the first screen, and the
      name in the same place as on the feed.
- [ ] **The owner's judgement of the look**, at 390×844 and 1920×1080,
      both themes, side by side with the feed. Passing means the owner says
      the page looks like discountShow (the sign, the shelf tag, the
      sticker, the ticket stub) and not a template, and notes what they'd
      change.
- [ ] **With `prefers-reduced-motion: reduce` emulated.** Nothing moves on
      load, on a wrong password or on switching, and the error is still
      plain from its box and focus.
- [ ] **Keyboard only, at 1920×1080.** Tab goes name → theme → back →
      Username → Password → Show → Log in → Create an account. The focus
      ring is visible on each, including on the red masthead. Enter
      submits, and after an error focus is on the field to fix.
- [ ] **Text contrast.** All text on the tag, card and button is at least
      4.5:1 in both themes, in DevTools' contrast check.
- [ ] **Password managers.** Chrome's password manager offers a strong
      password on `/register` and offers to save it after. On `/login` it
      offers to fill the saved account. Once on the owner's own phone: the
      keyboard doesn't capitalise the username, and the focused field isn't
      hidden by the keyboard.
- [ ] **The feed is unchanged**, at 360, 390×844 and 400 px, guest and
      signed in, with the map open. The first special's item and price are
      on the first screen, and the header is the same height as on `main`
      before the change.
- [ ] **The round trip by hand.**
  - On `/stores/coles-civic?q=…`, with the fifth card at the top of the
    screen, a guest presses "Log in" and logs in. They land at the same
    address with that card at the top.
  - "Log in to comment" on a card comes back with that card's comments
    open and the cursor in the box.
  - A half-typed post, with the session then ended in another tab, comes
    back filled in after login, with the photo note if there was a photo.
- [ ] **Two windows side by side at 1920×1080.** Log in in one: the other
      shows the name within about 2 s without being touched. Log out: it
      turns guest. A second browser stays as it was.

## Open questions

1. **Already logged in at `/login`**: show "You're logged in as amy" with
   Continue and Log out (recommended: no surprise, and it lets someone
   switch account), or send them straight back to `next`?
2. **Typos in a new password.** There is no password reset, so a mistyped
   new password locks the account for good. Is "Show" plus the "let your
   password manager save it" hint enough (recommended: less friction in an
   aisle), or should `/register` also ask for the password twice?
3. **The photo in a half-done post.** Drop it and say so (recommended), or
   keep it in the tab's `sessionStorage` (it is already shrunk, about
   400 KB as text)?
4. **Privacy wording.** Is "It's shown on everything you post" the right
   way to tell a newcomer their username is public? Do you also want to
   say usernames can't be changed later, since that's true today?
5. **How much look.** Are the awning edge, the "FREE" sticker and the
   three mini tags (beside the card on desktop, under it on a phone) all
   in? Or do you want a plainer page with just the shelf-tag heading and
   the ticket card?
6. **Header wording.** Keep "Log in" alone (recommended: the login page
   offers "Create an account", and CLAUDE.md's guest-prompt line holds
   word for word), or "Log in / Join", so newcomers see sign-up from the
   feed?
7. **Tabs following each other.** Is the `storage` signal, so a second
   tab in the same browser follows a login or logout within moments, in
   scope here, or a separate change? (Without it, the other tab catches up
   when next shown, as today.)
8. **The README, CLAUDE.md and the frame header.**
   - Add "logging in returns only to the app's own pages, with what was
     half-typed restored and never sent" to the README's enforced list?
   - Add the proposed "never" line to CLAUDE.md?
   - Send `frame-ancestors 'none'` on the two login pages (and, later,
     everywhere)?

## Approval

## Revisions

## Built evidence
