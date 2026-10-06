# discountShow

Supermarket specials near ANU, spotted and kept honest by the students who
shop there.

## What "good" means here

Coles and Aldi publish their specials weeks ahead. The small shops students
actually rely on, the Asian grocers and convenience stores around Civic,
Acton and Dickson, mostly have no website at all. I work at one of them,
Daily Market. When stock nears its expiry date, the shop decides on the
spot to mark it down, and nothing announces it. Stock moves fast and
restocking is slow, so a bargain can be gone within the hour. A student who
would happily grab it has no way to find out.

So discountShow is good if a student can **trust a single post enough to
walk to the shop for it**. A stale price or an empty shelf costs them the
trip, and once that happens twice they stop looking. That standard, not
the number of posts, is what the rest of the design serves:

1. **One post per item per store.** Posting something already listed there
   is refused and points you at the existing post, so the feed never shows
   conflicting prices for the same thing.
2. **The crowd corrects posts, not just the poster.** Anyone can say "same
   and correct". If the price, item or end date is wrong, three different
   people proposing the same fix rewrites the post and the poster is told.
   Two people, or three with different fixes, change nothing. The poster's
   own correction applies at once.
3. **Stock is a first-class fact.** Anyone can report plenty, some, few or
   gone, with their name and time on it, because "gone" is how a
   short-lived markdown usually ends.
4. **Specials are cheaper, or they are not specials.** A post priced at or
   above the usual price never reaches the feed, and no correction can
   make it so.

Nobody has an account; low friction matters when you are standing in an
aisle. You pick a nickname and the browser holds a secret key that proves
later actions are yours. The server never sends that key back, and knowing
someone's public id does not let you act as them. Only the poster can
delete their post.

## What is enforced and what is judged

Enforced, by tests in `spec/` that run against the live app: duplicate
refusal, the confirmation and three-person correction rules, poster-only
delete, the price check, and the secret key never leaking.

Judged, by a person: whether the problem is real, which rests on my own
experience at Daily Market and not on a survey; whether the feed is quick
to scan on a phone; and whether the stock wording ("few") means anything
to a hungry reader. I have not yet tested it with strangers.

## Sources and what I left out

The store list covers the supermarkets, Asian grocers and convenience
shops near ANU that students use. Each post records where the poster saw
it (in-store, store website, catalogue or word-of-mouth), so readers can
weigh it.

I chose not to build accounts, receipt photos, price-history charts, or
scraping of store websites: each adds a login barrier or a claim the app
cannot check, and the shops that matter most have no website to scrape.
Live push of new posts to other open browsers is not built yet; for now a
page shows what was true when it loaded.
