# discountShow

Supermarket specials near ANU, spotted and kept honest by the students who
shop there.

## What "good" means here

Coles and Aldi publish their specials weeks ahead. The small shops students
actually rely on, the Asian grocers and convenience stores around Civic,
Acton and Dickson, mostly have no website. I work at one, Daily Market.
When stock nears its expiry date, the shop marks it down on the spot, and
nothing announces it. A bargain can be gone within the hour, and a student
who would grab it has no way to find out.

So discountShow is good if a student can **trust a single post enough to
walk to the shop for it**. A stale price or empty shelf costs them the
trip, and after twice they stop looking. The design serves that standard,
not the number of posts:

1. **One live post per item per store.** A repeat, from anyone, is refused
   and points at the existing post, so the feed never shows conflicting
   prices.
2. **The crowd corrects posts.** Anyone can confirm a post ("same and
   correct"). If the price, item or end date is wrong, three different
   people proposing the same fix rewrites the post and the poster is told.
   The poster's own correction applies at once.
3. **Stock is a first-class fact.** Anyone can report plenty, some, few or
   gone, because "gone" is how a markdown usually ends. One report per
   person per post a minute, and recent reports stay visible.
4. **Specials are cheaper, or they are not specials.** No post or
   correction can put a special at or above the usual price.
5. **"Gone" arrives before the walk.** An open page shows changes to the
   posts on it, and new posts on page one, within moments.

Comments are where readers ask "still there?" and answer each other: one
level of replies, likes (not your own, one each), and deleting your own,
which takes its replies with it. A comment ten different people report is
hidden until an admin restores it or keeps it hidden, so a few people can't
silence one they merely disagree with, and an admin decides rather than the
crowd alone. Every reported comment waits in an admin-only inbox until it is
restored, hidden or deleted, so none is lost when a notice is dismissed.

Reading is free; writing needs an account. I first used a nickname and a
browser-held key, since friction matters in an aisle. But the rules above
count *people*, and a new browser was a new person, so three "different"
people could be one. Now the same login in any browser is the same person.
Only the poster, or an admin, can delete a post.

## What is enforced and what is judged

Enforced, by tests in `spec/` against the running app: duplicate refusal,
including simultaneous posts; the confirmation and three-person correction
rules; poster-only delete; admins only from `ADMIN_USERS`; the price check;
the stock-report limit; comment replies, likes, deleting with replies, and
the ten-report hide with an admin's review and inbox, including reports at once;
guests being read-only; logins across browsers; no
password or session token leaking; typo-tolerant search; every live post
reachable across pages; and live updates reaching an open page.

Judged, by a person: whether the problem is real, which rests on my own
experience and not a survey; whether the feed scans quickly on a phone;
and whether "few" means anything to a hungry reader. I have not yet tested
it with strangers.

## Sources and what I left out

- **The big chains' specials pages** cover only their own shops; the feed
  only links to them.
- **Xiaohongshu (RedNote).** Students share bargains there, but posts are
  scattered and rarely live.
- **PetrolSpy**, where drivers report fuel prices for strangers, is the
  model for crowd-reported prices here.
- **My friends** pass on cheap food in chat, found by luck.

The shop list and the street map come from OpenStreetMap, taken once, not fetched at runtime. Each post records where the poster
saw it, so readers can weigh it.

I chose not to build email login, password reset, receipt photos,
price-history charts or website scraping: each adds friction or a claim
the app cannot check, and the shops that matter most have no website.
At most 300 pages can watch live at once.
