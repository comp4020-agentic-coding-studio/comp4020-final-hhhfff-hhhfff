# discountShow

Supermarket specials near ANU, spotted and kept honest by the students who
shop there.

## What "good" means here

Coles and Aldi publish their specials weeks ahead. The small shops students
actually rely on, the Asian grocers and convenience stores around Civic,
Acton and Dickson, mostly have no website at all. I work at one of them,
Daily Market. When stock nears its expiry date, the shop decides on the
spot to mark it down, and nothing announces it. Stock moves fast and
restocking is slow, so a bargain can be gone within the hour, and a student
who would grab it has no way to find out.

So discountShow is good if a student can **trust a single post enough to
walk to the shop for it**. A stale price or empty shelf costs them the
trip, and after twice they stop looking. That standard, not the number of
posts, is what the design serves:

1. **One post per item per store.** A repeat is refused and points at the
   existing post, so the feed never shows conflicting prices.
2. **The crowd corrects posts, not just the poster.** Anyone can say "same
   and correct". If the price, item or end date is wrong, three different
   people proposing the same fix rewrites the post and the poster is told.
   Two people, or three with different fixes, change nothing. The poster's
   own correction applies at once.
3. **Stock is a first-class fact.** Anyone can report plenty, some, few or
   gone, with name and time, because "gone" is how a markdown usually ends. One person can report a given post once a minute, and the last few reports stay visible, so a flip-flop shows rather than silently winning.
4. **Specials are cheaper, or they are not specials.** A post not below the
   usual price never reaches the feed, and no correction can change that.

Nobody has an account; low friction matters in an aisle. You pick a
nickname and the browser holds a secret key that proves later actions are
yours. The server never sends it back. Only the poster can delete their
post.

## What is enforced and what is judged

Enforced, by tests in `spec/` against the running app: duplicate refusal,
the confirmation and three-person correction rules, poster-only delete, the
price check, the one-minute stock-report limit, and the secret key never leaking.

Judged, by a person: whether the problem is real, which rests on my own
experience and not a survey; whether the feed scans quickly on a phone;
and whether "few" means anything to a hungry reader. I have not yet tested
it with strangers.

## Sources and what I left out

What I looked at while deciding:

- **The big chains' specials pages.** They cover only their own shops and
  say nothing about the small grocers.
- **Xiaohongshu (RedNote).** Students share bargains there, but posts are
  scattered and rarely live; it is not what the platform is for.
- **PetrolSpy**, where drivers report fuel prices on a map across
  Australia. It showed me people will keep prices current for strangers,
  and it is the model for crowd-reported prices here.
- **My friends.** They find cheap food by chance in a shop or on
  Xiaohongshu and pass it on in chat. It works, but only by luck.

The shop list comes from OpenStreetMap, petrol stations dropped. Each post
records where the poster saw it (in-store, store website, catalogue or
word-of-mouth), so readers can weigh it.

I chose not to build accounts, receipt photos, price-history charts or
website scraping: each adds a login barrier or a claim the app cannot
check, and the shops that matter most have no website. Live push to other
open browsers is not built yet; a page shows what was true when it loaded.
