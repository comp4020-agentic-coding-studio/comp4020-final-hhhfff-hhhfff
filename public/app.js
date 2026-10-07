// discountShow: the whole client. No framework, no build step.
//
// Identity is an account: log in with a username and password and the server
// keeps you signed in with an HttpOnly cookie this script never sees. A guest
// can only look; the buttons that write ask them to log in. The server is what
// enforces that, not this file.
// A location, if the visitor shares one, is only used here to sort stores;
// it is never sent to the server.

const ANU = { lat: -35.2777, lon: 149.1185 };
const QUORUM = 3; // must match CORRECTION_QUORUM in server/db.ts

const $ = (sel, root = document) => root.querySelector(sel);

// --- who am I

let me = null; // { id, name, role } once logged in, null for a guest
const isMe = (a) => !!me && a.id === me.id;
const isAdmin = () => me?.role === "admin";
const nameOf = (a) => (isMe(a) ? "you" : a.name);

// --- formatting

const money = (c) => `$${(c / 100).toFixed(2)}`;

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const dayFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short" });
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Canberra" }).format(d);
const dayText = (date) => (date === ymd(new Date()) ? "today" : dayFmt.format(new Date(`${date}T12:00:00`)));
const endsText = (endsOn) => (endsOn ? `ends ${dayText(endsOn)}` : "no end date");

const SOURCE_TEXT = {
  "in-store": "seen in store",
  "store-website": "from the store's site",
  catalogue: "from the catalogue",
  "word-of-mouth": "word of mouth",
};

const STOCK_TEXT = { plenty: "plenty", some: "some", few: "only a few", gone: "sold out" };

const FIELD_TEXT = { item: "Item", wasCents: "Usual price", nowCents: "Special price", endsOn: "End date" };
const FIELDS = ["item", "wasCents", "nowCents", "endsOn"];

function valueText(field, v) {
  if (field === "wasCents" || field === "nowCents") return money(v);
  if (field === "endsOn") return v ? dayText(v) : "no end date";
  return v;
}

// Item names compare loosely, like the server's itemKey; everything else exactly.
const loose = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, "");
const sameValue = (field, a, b) => (field === "item" ? loose(a) === loose(b) : a === b);

const toCents = (s) => {
  const t = String(s).trim().replace(/^\$/, "");
  return /^\d{1,4}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
};

// --- api

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  // the server may know me as someone else now (another tab logged in or out)
  if (res.status === 401 || res.status === 403) syncMe();
  if (!res.ok) throw Object.assign(new Error(data.error ?? `request failed (${res.status})`), { status: res.status, data });
  return data;
}

// --- stores, sorted by distance from ANU or from the visitor

let stores = [];
let origin = ANU;
const storeById = () => new Map(stores.map((s) => [s.id, s]));

function km(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const storeLabel = (s) => `${s.name}, ${s.where} (${km(origin, s).toFixed(1)} km)`;

function renderStoreOptions() {
  stores.sort((a, b) => km(origin, a) - km(origin, b));
  const filter = $("#store-filter");
  const picker = $("#post [name=storeId]");
  const [keepFilter, keepPicker] = [filter.value, picker.value];

  filter.replaceChildren(new Option("All stores", ""), ...stores.map((s) => new Option(storeLabel(s), s.id)));
  picker.replaceChildren(new Option("Choose a store", ""), ...stores.map((s) => new Option(storeLabel(s), s.id)));
  filter.value = keepFilter;
  picker.value = keepPicker;
}

$("#locate").addEventListener("click", () => {
  const status = $("#locate-status");
  if (!navigator.geolocation) {
    status.textContent = "This browser can't share a location, so stores stay sorted from ANU.";
    return;
  }
  status.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      renderStoreOptions();
      renderFeed();
      status.textContent = "Stores are sorted by distance from you. Your location stays on this device.";
    },
    () => {
      status.textContent = "No location, no problem: stores stay sorted by distance from ANU.";
    },
    { timeout: 10000, maximumAge: 300000 },
  );
});

// --- notifications: what happened to my posts while I was away

async function loadNotices() {
  if (!me) return;
  try {
    const notes = await api("/api/notifications", {});
    if (!notes.length) return;
    const box = $("#notices");
    for (const n of notes) {
      const p = document.createElement("p");
      p.className = "notice";
      p.textContent = `${n.text} (${ago(n.createdAt)})`;
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "quiet small";
      ok.textContent = "Got it";
      ok.addEventListener("click", () => {
        p.remove();
        box.hidden = !box.children.length;
      });
      p.append(" ", ok);
      box.append(p);
    }
    box.hidden = false;
  } catch {
    // notices can wait for the next visit
  }
}

// --- the feed

let deals = [];

async function loadFeed() {
  const store = $("#store-filter").value;
  const feed = $("#feed");
  const status = $("#feed-status");
  feed.setAttribute("aria-busy", "true");
  if (!feed.children.length) status.textContent = "Loading specials…";
  try {
    deals = await api(`/api/deals${store ? `?store=${encodeURIComponent(store)}` : ""}`);
    renderFeed();
  } catch (err) {
    // on a slow or dropped connection, say so and offer a way back, keeping what's shown
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "quiet small";
    retry.textContent = "Try again";
    retry.addEventListener("click", loadFeed);
    status.replaceChildren(`Couldn't load specials: ${err.message}. `, retry);
  } finally {
    feed.setAttribute("aria-busy", "false");
  }
}

// Sold-out posts go after the rest, as the server sends them; otherwise newest first.
const shelfOrder = (list) => [...list].sort((a, b) => (a.stock === "gone") - (b.stock === "gone"));

function replaceDeal(updated) {
  deals = deals.map((x) => (x.id === updated.id ? updated : x));
  renderFeed();
}

function renderFeed() {
  deals = shelfOrder(deals);
  const byId = storeById();
  const keep = (sel) => new Set([...document.querySelectorAll(`#feed ${sel}[open]`)].map((d) => d.closest("li").dataset.id));
  const [openComments, openCorrect] = [keep("details.comments"), keep("details.correct")];
  $("#feed").replaceChildren(
    ...deals.map((d) => dealCard(d, byId.get(d.storeId), openComments.has(String(d.id)), openCorrect.has(String(d.id)))),
  );
  const store = byId.get($("#store-filter").value);
  $("#feed-status").textContent = "";
  $("#empty-title").textContent = store
    ? `Nothing shared for ${store.name}, ${store.where} yet`
    : "No one has shared a special yet";
  showChains();
}

// With posts, the chains' links are a sidebar; with none, they fill the middle
// under the empty-feed note. Hidden until the feed first loads.
function showChains() {
  const empty = !deals.length;
  $("#chains").hidden = false;
  $("#chains").classList.toggle("empty", empty);
  $("#chains-empty").hidden = !empty;
  $("#feed-layout").classList.toggle("has-side", !empty);
}

// the same toggle as the post button, so a guest is asked to log in rather than shown a form
$("#post-first").addEventListener("click", () => toggle.click());

function dealCard(d, store, commentsOpen, correctOpen) {
  const li = $("#deal-template").content.firstElementChild.cloneNode(true);
  li.dataset.id = d.id;
  li.id = `deal-${d.id}`;
  li.classList.toggle("sold-out", d.stock === "gone");
  $(".item", li).textContent = d.item;
  $(".store", li).textContent = store ? `${store.name}, ${store.where} · ${km(origin, store).toFixed(1)} km` : d.storeId;
  $(".now", li).textContent = money(d.nowCents);
  $(".was", li).textContent = money(d.wasCents);
  $(".off", li).textContent = `${Math.round((1 - d.nowCents / d.wasCents) * 100)}% off`;
  $(".meta", li).textContent = `${SOURCE_TEXT[d.source]} · ${endsText(d.endsOn)} · by ${nameOf(d.author)}, ${ago(d.createdAt)}`;

  if (isMe(d.author) || isAdmin()) wireDelete(d, li);
  if (!isMe(d.author)) $(".delete-start", li).textContent = "Delete post (admin)";

  // a guest sees how much is left; only someone logged in gets the buttons to report it
  const group = $(".stock", li);
  group.hidden = !me;
  group.setAttribute("aria-label", `How much ${d.item} is left`);
  for (const b of group.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.stock === d.stock));
    b.addEventListener("click", () => updateStock(d, b.dataset.stock));
  }
  // who said so, and the two reports before, so a sudden flip-flop is visible
  const earlier = d.stockHistory.slice(1, 3).map((r) => `${STOCK_TEXT[r.stock]} (${nameOf(r.by)}, ${ago(r.at)})`);
  $(".stock-by", li).textContent =
    // the pressed button already shows the level to someone logged in
    (me ? `by ${nameOf(d.stockBy)}, ${ago(d.stockAt)}` : `Left: ${STOCK_TEXT[d.stock]} · ${nameOf(d.stockBy)}, ${ago(d.stockAt)}`) +
    (earlier.length ? `. Before: ${earlier.join(", ")}` : "");

  // confirmations
  const confirmedByMe = d.confirmedBy.some(isMe);
  const others = d.confirmations - (confirmedByMe ? 1 : 0);
  const people = (k) => (k === 1 ? "1 other person" : `${k} other people`);
  $(".confirmed", li).textContent =
    d.confirmations === 0 ? ""
    : confirmedByMe ? `✓ You confirmed this${others ? `, and so did ${people(others)}` : ""}.`
    : `✓ Confirmed by ${d.confirmations === 1 ? "1 person" : `${d.confirmations} people`} besides the poster.`;
  const confirm = $(".confirm", li);
  confirm.hidden = !me || isMe(d.author) || confirmedByMe;
  confirm.addEventListener("click", () => confirmDeal(d.id));
  $(".trust", li).hidden = d.confirmations === 0 && confirm.hidden;

  // what's been corrected
  $(".history", li).replaceChildren(
    ...d.history.map((h) => {
      const item = document.createElement("li");
      item.textContent = `Corrected ${ago(h.at)} by ${h.by === "poster" ? "the poster" : "other shoppers"}: ` +
        `${FIELD_TEXT[h.field].toLowerCase()} was ${valueText(h.field, h.from)}, now ${valueText(h.field, h.to)}.`;
      return item;
    }),
  );

  // open corrections, each with a way to agree
  $(".pending", li).replaceChildren(...d.pending.map((p) => pendingItem(d, p)));

  const correct = $("details.correct", li);
  correct.hidden = !me; // a guest still sees open and applied corrections above
  const form = $(".correct-form", li);
  const fit = () => fitCorrectionInput(form, d);
  form.elements.field.addEventListener("change", fit);
  fit();
  $(".correct-rule", li).textContent = isMe(d.author)
    ? "This is your post, so your correction applies straight away."
    : `When ${QUORUM} people suggest the same correction, the post changes and the poster is told.`;
  form.addEventListener("submit", (e) => submitCorrection(e, d));
  if (correctOpen) correct.open = true;

  const details = $("details.comments", li);
  $("summary", details).textContent = d.comments === 1 ? "1 comment" : `${d.comments} comments`;
  details.addEventListener("toggle", () => details.open && loadComments(d.id, li));
  $(".comment-form", li).addEventListener("submit", (e) => postComment(e, d.id, li));
  $(".comment-form", li).hidden = !me;
  const loginToComment = $(".login-to-comment", li);
  loginToComment.hidden = !!me;
  loginToComment.addEventListener("click", () => requireLogin("comment"));
  if (commentsOpen) details.open = true;
  return li;
}

// Deleting asks first, on the card itself, and says what else goes with it.
function wireDelete(d, li) {
  const box = $(".delete", li);
  const start = $(".delete-start", box);
  const ask = $(".delete-confirm", box);
  box.hidden = false;

  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const others = [
    d.confirmations && plural(d.confirmations, "confirmation", "confirmations"),
    d.comments && plural(d.comments, "comment", "comments"),
    d.pending.length && plural(d.pending.length, "open correction", "open corrections"),
  ].filter(Boolean);
  $(".delete-warning", box).textContent =
    "Delete this post? It disappears for everyone." +
    (others.length
      ? ` It has ${others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others.at(-1)}` : others[0]} from other people, which will be hidden too.`
      : "");

  start.addEventListener("click", () => {
    start.hidden = true;
    ask.hidden = false;
    $(".delete-no", box).focus();
  });
  $(".delete-no", box).addEventListener("click", () => {
    ask.hidden = true;
    start.hidden = false;
    start.focus();
  });
  $(".delete-yes", box).addEventListener("click", async () => {
    try {
      await api(`/api/deals/${d.id}/delete`, {});
      deals = deals.filter((x) => x.id !== d.id);
      renderFeed();
      $("#feed-status").textContent = `Deleted “${d.item}”.`;
    } catch (err) {
      alertIn(box, err.message);
    }
  });
}

function pendingItem(d, p) {
  const item = document.createElement("li");
  const mine = p.voters.some(isMe);
  const others = p.voters.filter((v) => v.id !== d.author.id).length;
  const text = document.createElement("span");
  text.textContent = `${FIELD_TEXT[p.field]} should be ${valueText(p.field, p.value)}? ` +
    `${others} of ${QUORUM} agree${mine ? " (including you)" : ""}.` +
    (p.notes.length ? ` “${p.notes.join("” “")}”` : "");
  item.append(text);
  if (me && !mine) {
    const agree = document.createElement("button");
    agree.type = "button";
    agree.className = "quiet small";
    agree.textContent = isMe(d.author) ? "Accept, it's right" : "Agree";
    agree.addEventListener("click", () => sendCorrection(d, p.field, p.value, null, item));
    item.append(" ", agree);
  }
  return item;
}

// The "it should be" input changes shape with the field being corrected.
function fitCorrectionInput(form, d) {
  const field = form.elements.field.value;
  const input = form.elements.value;
  input.value = "";
  input.type = field === "endsOn" ? "date" : "text";
  input.inputMode = field === "wasCents" || field === "nowCents" ? "decimal" : "";
  input.required = field !== "endsOn";
  input.min = field === "endsOn" ? ymd(new Date()) : "";
  input.placeholder = field === "item" ? d.item : field === "endsOn" ? "" : (d[field] / 100).toFixed(2);
}

function readCorrection(form) {
  const field = form.elements.field.value;
  const raw = form.elements.value.value.trim();
  if (field === "wasCents" || field === "nowCents") {
    const c = toCents(raw);
    if (Number.isNaN(c)) throw new Error("A price should look like 2.75.");
    return { field, value: c };
  }
  if (field === "endsOn") return { field, value: raw || null };
  if (raw.length < 2) throw new Error("What should the item be called?");
  return { field, value: raw };
}

async function submitCorrection(e, d) {
  e.preventDefault();
  const form = e.target;
  let c;
  try {
    c = readCorrection(form);
  } catch (err) {
    return alertIn(form, err.message);
  }
  sendCorrection(d, c.field, c.value, form.elements.note.value.trim() || null, form);
}

async function sendCorrection(d, field, value, note, where) {
  if (!requireLogin()) return;
  try {
    const r = await api(`/api/deals/${d.id}/corrections`, { field, value, note });
    replaceDeal(r.deal);
    $("#feed-status").textContent = r.applied
      ? `Corrected: ${FIELD_TEXT[field].toLowerCase()} is now ${valueText(field, value)}.`
      : `Suggestion recorded: ${r.votes} of ${r.needed} needed agree so far.`;
  } catch (err) {
    alertIn(where, err.message);
  }
}

async function confirmDeal(id) {
  if (!requireLogin()) return;
  try {
    replaceDeal(await api(`/api/deals/${id}/confirm`, {}));
  } catch (err) {
    $("#feed-status").textContent = err.message;
  }
}

async function updateStock(d, stock) {
  if (!requireLogin()) return;
  try {
    replaceDeal(await api(`/api/deals/${d.id}/stock`, { stock }));
  } catch (err) {
    $("#feed-status").textContent = err.message;
  }
}

async function loadComments(id, li) {
  const list = $(".comment-list", li);
  try {
    const comments = await api(`/api/deals/${id}/comments`);
    list.replaceChildren(
      ...comments.map((c) => {
        const item = document.createElement("li");
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = `${nameOf(c.author)} · ${ago(c.createdAt)}`;
        const body = document.createElement("p");
        body.textContent = c.body;
        item.append(who, body);
        return item;
      }),
    );
  } catch (err) {
    list.textContent = `Couldn't load comments: ${err.message}`;
  }
}

async function postComment(e, id, li) {
  e.preventDefault();
  if (!requireLogin()) return;
  const input = e.target.elements.body;
  if (!input.value.trim()) return input.focus();
  try {
    await api(`/api/deals/${id}/comments`, { body: input.value });
    input.value = "";
    const d = deals.find((x) => x.id === id);
    if (d) d.comments += 1;
    $("details.comments summary", li).textContent = d?.comments === 1 ? "1 comment" : `${d?.comments ?? ""} comments`;
    loadComments(id, li);
  } catch (err) {
    alertIn(li, err.message);
  }
}

function alertIn(container, message) {
  let p = $(":scope > .error", container);
  if (!p) {
    p = document.createElement("p");
    p.className = "error";
    p.setAttribute("role", "alert");
    container.append(p);
  }
  p.textContent = message;
}

// --- account

const authForm = $("#auth");
const account = $("#account");
const WHY = $("#auth-why").textContent;

function showMe() {
  $("#who").textContent = me ? `${me.name}${isAdmin() ? " (admin)" : ""}` : "";
  $("#show-login").hidden = !!me;
  $("#logout").hidden = !me;
  if (me) hideAuth();
  // a guest's post button says what it takes, rather than opening a form they can't send
  $("#post-toggle").textContent = me ? "+ Post a special" : "Log in to post a special";
}

// `why` says what the visitor was trying to do when they were asked to log in
function showAuth(why = "") {
  account.hidden = false;
  $("#show-login").setAttribute("aria-expanded", "true");
  $("#auth-why").textContent = why ? `${why} Reading stays free.` : WHY;
  $("#auth-error").textContent = "";
  account.scrollIntoView({ block: "nearest" });
  authForm.elements.username.focus();
}

function hideAuth({ refocus = false } = {}) {
  account.hidden = true;
  $("#show-login").setAttribute("aria-expanded", "false");
  if (refocus) $("#show-login").focus();
}

// The session cookie is shared by every tab, so another tab can log in or out
// as someone else. Ask the server who I am and catch up if it differs.
async function syncMe() {
  const now = await api("/api/me").catch(() => undefined);
  if (now === undefined || (now?.id ?? null) === (me?.id ?? null)) return; // offline, or unchanged
  me = now;
  if (!me) {
    $("#notices").replaceChildren();
    $("#notices").hidden = true;
  }
  showMe();
  connectLive();
  await loadFeed();
  loadNotices();
}

// Writes need an account: say so, and open the login form.
function requireLogin(what = "do that") {
  if (me) return true;
  showAuth(`Log in or create an account to ${what}.`);
  return false;
}

async function enter(path) {
  const error = $("#auth-error");
  error.textContent = "";
  try {
    me = await api(path, { username: authForm.elements.username.value, password: authForm.elements.password.value });
    authForm.reset();
    showMe();
    connectLive(); // so this connection gets my own notices
    await loadFeed();
    loadNotices();
  } catch (err) {
    error.textContent = err.message;
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  enter("/api/login");
});
$("#register-btn").addEventListener("click", () => enter("/api/register"));
$("#auth-cancel").addEventListener("click", () => hideAuth({ refocus: true }));
account.addEventListener("keydown", (e) => e.key === "Escape" && hideAuth({ refocus: true }));
$("#show-login").addEventListener("click", () => (account.hidden ? showAuth() : hideAuth()));
$("#logout").addEventListener("click", async () => {
  await api("/api/logout", {}).catch(() => {});
  me = null;
  $("#notices").replaceChildren();
  $("#notices").hidden = true;
  closePost();
  showMe();
  connectLive();
  await loadFeed();
});

// --- posting a special: check for one already in the feed first

const post = $("#post");
const similar = $("#similar");
let draft = null; // the special being posted, while #similar asks about it

$("#next-tuesday").addEventListener("click", () => {
  const d = new Date();
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7));
  post.elements.endsOn.value = ymd(d);
});

post.elements.endsOn.min = ymd(new Date());

function readDraft() {
  const f = post.elements;
  const wasCents = toCents(f.was.value);
  const nowCents = toCents(f.now.value);
  const problem =
    !f.storeId.value ? "Which store was it?"
    : f.product.value.trim().length < 2 ? "What's the item?"
    : Number.isNaN(wasCents) ? "The usual price should look like 5.50."
    : Number.isNaN(nowCents) ? "The special price should look like 2.75."
    : nowCents >= wasCents ? "The special price has to be lower than the usual price."
    : "";
  if (problem) throw new Error(problem);
  return {
    storeId: f.storeId.value,
    item: f.product.value.trim(),
    wasCents,
    nowCents,
    endsOn: f.endsOn.value || null,
    stock: f.stock.value,
    source: f.source.value,
  };
}

post.addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#post-error");
  error.textContent = "";
  if (!requireLogin("post a special")) {
    error.textContent = "Log in first (top of the page).";
    return;
  }
  try {
    draft = readDraft();
    const params = new URLSearchParams({ store: draft.storeId, item: draft.item });
    const matches = await api(`/api/deals/similar?${params}`);
    if (matches.length) return showSimilar(matches);
    await publish();
  } catch (err) {
    error.textContent = err.message;
  }
});

// The form is folded behind #post-toggle until someone wants to post; while
// it (or the "already posted?" check) is open, the toggle steps aside.
const toggle = $("#post-toggle");

function openPost() {
  similar.hidden = true;
  post.hidden = false;
  toggle.hidden = true;
  toggle.setAttribute("aria-expanded", "true");
  post.elements.storeId.focus();
}

function closePost({ refocus = false } = {}) {
  similar.hidden = true;
  post.hidden = true;
  toggle.hidden = false;
  toggle.setAttribute("aria-expanded", "false");
  $("#post-error").textContent = "";
  if (refocus) toggle.focus();
}

toggle.addEventListener("click", () => requireLogin("post a special") && openPost());
$("#post-close").addEventListener("click", () => closePost({ refocus: true }));
for (const panel of [post, similar]) {
  panel.addEventListener("keydown", (e) => e.key === "Escape" && closePost({ refocus: true }));
}

function showSimilar(matches) {
  $("#similar-list").replaceChildren(...matches.map(similarItem));
  // the server allows one live post per item per store, whoever posted it, so
  // "post mine" only makes sense when none of these is the same item
  $("#post-anyway").hidden = matches.some((m) => m.score === 1);
  post.hidden = true;
  similar.hidden = false;
  similar.focus();
}

// the special has been dealt with (posted, confirmed or corrected): fold up
function closeSimilar(message) {
  closePost();
  draft = null;
  if (message) $("#feed-status").textContent = message;
}

function similarItem(m) {
  const li = document.createElement("li");
  li.className = "similar-item";
  const head = document.createElement("p");
  const name = document.createElement("strong");
  name.textContent = m.item;
  const meta = document.createElement("span");
  meta.className = "hint";
  meta.textContent = `posted by ${nameOf(m.author)}, ${ago(m.createdAt)}` +
    (m.confirmations ? ` · confirmed by ${m.confirmations}` : "");
  head.append(name, " ", meta);
  li.append(head);

  // yours against theirs, field by field
  const table = document.createElement("table");
  const headRow = table.createTHead().insertRow();
  for (const text of ["", "Posted", "Yours"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = text;
    headRow.append(th);
  }
  table.createTBody();
  const differs = [];
  for (const field of FIELDS) {
    const same = sameValue(field, m[field], draft[field]);
    if (!same) differs.push(field);
    const tr = document.createElement("tr");
    tr.className = same ? "" : "differs";
    for (const [tag, text] of [["th", FIELD_TEXT[field]], ["td", valueText(field, m[field])], ["td", valueText(field, draft[field])]]) {
      const cell = document.createElement(tag);
      if (tag === "th") cell.scope = "row";
      cell.textContent = text;
      tr.append(cell);
    }
    table.tBodies[0].append(tr);
  }
  li.append(table);

  const actions = document.createElement("div");
  actions.className = "actions";
  const button = (text, cls, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    actions.append(b);
    return b;
  };

  if (isMe(m.author)) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = differs.length
      ? "This is your own post. Change it with a correction rather than posting it again."
      : "This is your own post, and it already says all this.";
    li.append(p);
    if (differs.length) button("Correct my post", "", () => applyDifferences(m, differs, li));
    button("Show it", "quiet", () => {
      closeSimilar();
      jumpTo(m.id);
    });
  } else {
    if (!differs.length || differs.every((f) => f === "endsOn" && !draft.endsOn)) {
      button("Same thing, and it's right", "", () => confirmFromDraft(m, li));
    } else {
      button("Same thing, and the post is right", "", () => confirmFromDraft(m, li));
      button(`Same thing, but ${differs.length === 1 ? "this needs" : "these need"} correcting`, "quiet", () =>
        applyDifferences(m, differs, li),
      );
    }
  }
  li.append(actions);
  return li;
}

async function confirmFromDraft(m, li) {
  try {
    replaceOrAdd(await api(`/api/deals/${m.id}/confirm`, {}));
    clearPost();
    closeSimilar(`Thanks: you confirmed “${m.item}” instead of posting it twice.`);
    jumpTo(m.id);
  } catch (err) {
    alertIn(li, err.message);
  }
}

// one correction per field where the draft disagrees with the post
async function applyDifferences(m, fields, li) {
  try {
    let latest = null;
    const lines = [];
    for (const field of fields) {
      if (field === "endsOn" && !draft.endsOn) continue; // not knowing the end date isn't a correction
      const r = await api(`/api/deals/${m.id}/corrections`, {
        field,
        value: draft[field],
        note: null,
      });
      latest = r.deal;
      lines.push(`${FIELD_TEXT[field].toLowerCase()} ${r.applied ? "corrected" : `suggested (${r.votes} of ${r.needed} agree)`}`);
    }
    if (latest) replaceOrAdd(latest);
    clearPost();
    closeSimilar(lines.length ? `On “${m.item}”: ${lines.join("; ")}.` : "Nothing to correct.");
    jumpTo(m.id);
  } catch (err) {
    alertIn(li, err.message);
  }
}

$("#post-anyway").addEventListener("click", async () => {
  try {
    await publish();
  } catch (err) {
    alertIn(similar, err.message);
  }
});

$("#similar-cancel").addEventListener("click", () => {
  draft = null;
  openPost();
  post.elements.product.focus();
});

async function publish() {
  try {
    const deal = await api("/api/deals", draft);
    clearPost();
    replaceOrAdd(deal);
    closeSimilar(`Posted “${deal.item}”.`);
    jumpTo(deal.id);
  } catch (err) {
    // the server's one-post-per-item-per-store rule: show the post that's already there
    if (err.status === 409 && err.data.existing) {
      showSimilar([{ ...err.data.existing, score: 1 }]);
      return;
    }
    throw err;
  }
}

function clearPost() {
  for (const name of ["product", "was", "now", "endsOn"]) post.elements[name].value = "";
}

function replaceOrAdd(deal) {
  const filter = $("#store-filter").value;
  if (filter && filter !== deal.storeId) return;
  if (deals.some((x) => x.id === deal.id)) replaceDeal(deal);
  else {
    deals = [deal, ...deals];
    renderFeed();
  }
}

function jumpTo(id) {
  const card = document.getElementById(`deal-${id}`);
  if (!card) return;
  card.scrollIntoView({ block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1600);
}

// --- live: the server only says which deal changed; fetch it and swap that card

let live = null;

function connectLive() {
  live?.close();
  if (!window.EventSource) return; // the tab-focus refresh below still works
  const source = (live = new EventSource("/api/events"));
  let opened = false;
  source.addEventListener("open", () => {
    // a reconnect may have missed events, so catch up
    if (opened) {
      loadFeed();
      loadNotices();
    }
    opened = true;
  });
  source.addEventListener("message", (e) => {
    try {
      onLive(JSON.parse(e.data));
    } catch {
      // not an event we know: ignore it
    }
  });
}

function onLive(ev) {
  if (ev.type === "notice") loadNotices();
  else if (ev.type === "deleted") removeCard(ev.id);
  else if (ev.type === "deal") refreshDeal(ev.id);
}

function removeCard(id) {
  deals = deals.filter((x) => x.id !== id);
  document.getElementById(`deal-${id}`)?.remove();
  if (!deals.length) renderFeed();
  else showChains();
}

// Someone is mid-way through something on this card: don't pull it out from under them.
const busy = (card) =>
  card.contains(document.activeElement) ||
  !!card.querySelector(".delete-confirm:not([hidden])") ||
  [...card.querySelectorAll("details[open] input, details[open] textarea")].some((i) => i.value);

async function refreshDeal(id) {
  let d;
  try {
    d = await api(`/api/deals/${id}`);
  } catch (err) {
    if (err.status === 404) removeCard(id);
    return;
  }
  const filter = $("#store-filter").value;
  if (filter && filter !== d.storeId) return;
  const known = deals.some((x) => x.id === id);
  deals = known ? deals.map((x) => (x.id === id ? d : x)) : [d, ...deals];
  const card = document.getElementById(`deal-${id}`);
  if (card && busy(card)) return; // the data is kept; the card catches up on the next render
  if (card && card.classList.contains("sold-out") !== (d.stock === "gone")) return renderFeed(); // it moves
  const fresh = dealCard(
    d,
    storeById().get(d.storeId),
    !!card?.querySelector("details.comments")?.open,
    !!card?.querySelector("details.correct")?.open,
  );
  if (card) card.replaceWith(fresh);
  else {
    $("#feed").prepend(fresh);
    $("#feed-status").textContent = "";
    showChains();
  }
}

// --- start

$("#store-filter").addEventListener("change", loadFeed);
// coming back to the tab picks up what others posted meanwhile
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  syncMe();
  loadFeed();
  loadNotices();
});

me = await api("/api/me").catch(() => null);
showMe();
stores = await api("/api/stores");
renderStoreOptions();
await loadFeed();
loadNotices();
connectLive();
