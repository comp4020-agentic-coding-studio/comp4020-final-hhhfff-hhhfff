# discountShow

Supermarket specials near ANU, shared and updated by the students who shop there.

## What "good" means here

I work at Daily Market, where stock approaching expiry can be marked down
without advance notice. Students nearby may miss it, or arrive after it
sells out. discountShow is good if a student can **trust a post enough to
walk to the shop**. A useful post needs a believable price, a location and
current stock information.

Five rules support that:

1. **One live post per item per store.** Repeats point to the existing post,
   including when different people submit at once.
2. **The crowd corrects posts.** Readers confirm information or propose fixes.
   Three accounts agreeing on a correction apply it; the poster can correct
   their own post immediately.
3. **Stock is a first-class fact.** Readers report plenty, some, few or gone.
   Recent reports remain visible, limited to one per account per post per minute.
4. **Specials are cheaper, or they are not specials.** Prices and corrections
   must stay below the usual price.
5. **"Gone" arrives before the walk.** Visible posts update live. New posts
   wait behind a notification so the feed stays steady while someone reads.

Browse without an account; choose Log in to register or sign in before
contributing. Only the poster or an admin can delete a post. Optional
shelf-tag photos provide evidence for readers to judge, with metadata removed.
Comments support questions and replies. Ten accounts reporting a comment or
photo hide it pending admin review.

The map shows nearby shops and activity. Live status and anonymous
who-is-looking counts give context without naming readers. Each post and
store has a shareable address so information can travel through friends' chats.

## What is enforced and what is judged

**Enforced:** tests in `spec/` check duplicate and price rules, confirmations,
corrections, stock-report limits, account permissions and private data handling.
They cover live updates, search and pagination, share links, photo handling
and moderation. Server action logs identify actions and refusals without
passwords, session tokens or comment text.

**Judged:** whether students trust posts enough to travel, understand stock
labels and find the page useful on a phone. During crit10, two classmates
posted, commented and changed stock; I could see updates on my side. One
noticed that expanding a card left wasted space beside it. That feedback
led to a waterfall layout. This small exercise does not establish sustained
use or whether people find reader counts and map animations helpful.

## Sources and what I left out

[Coles](https://www.coles.com.au/on-special) and
[ALDI](https://www.aldi.com.au/) cover their own offers.
[Xiaohongshu](https://www.xiaohongshu.com/explore) showed me students sharing
bargains, but scattered across posts.
[PetrolSpy](https://petrolspy.com.au/) supplied a model for crowd-reported
prices. Shop and street-map data come from an
[OpenStreetMap](https://www.openstreetmap.org/) snapshot.

Ben Hoyt's [The small web is beautiful](https://benhoyt.com/writings/the-small-web-is-beautiful/)
supports simple architecture and fewer dependencies, fitting the single-process
SQLite stack. Robin Sloan's
[An app can be a home-cooked meal](https://www.robinsloan.com/notes/home-cooked-app/)
describes software tailored to his family. I take it as a case for serving
a particular group well. The ANU focus comes from my work experience;
an open feed still needs participation and trust. With few contributors,
three-person corrections may remain unresolved.

I prioritise current price and stock over price-history charts. Scraping
would miss small shops without websites; receipt photos show past purchases,
not whether an offer is still available. Optional shelf-tag photos are more
relevant to that decision, though still unverified. Email login and password
reset remain outside the current development scope; there is no self-service
account recovery. At most 300 pages can watch live at once.
