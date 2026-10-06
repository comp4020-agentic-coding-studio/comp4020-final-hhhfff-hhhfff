// discountShow: the whole client. No framework, no build step.
//
// Identity is a secret key plus a nickname, kept in this browser's
// localStorage and sent with every write. The server shows only a hash of the
// key (the public id), so nobody can act as you by copying what they see.
// A location, if the visitor shares one, is only used here to sort stores;
// it is never sent to the server.

const ANU = { lat: -35.2777, lon: 149.1185 };
const ME_KEY = "specials.me";
const QUORUM = 3; // must match CORRECTION_QUORUM in server/db.ts

const $ = (sel, root = document) => root.querySelector(sel);

// --- who am I

function loadMe() {
  try {
    const saved = JSON.parse(localStorage.getItem(ME_KEY) ?? "null");
    if (saved && typeof saved.key === "string") return saved;
    // the first version called the key `id`
    if (saved && typeof saved.id === "string") return { key: saved.id, name: saved.name ?? "" };
  } catch {
    // storage blocked or corrupt: start fresh
  }
  return { key: crypto.randomUUID(), name: "" };
}

const me = loadMe();
const author = () => ({ key: me.key, name: me.name });

function saveMe() {
  try {
    localStorage.setItem(ME_KEY, JSON.stringify({ key: me.key, name: me.name }));
  } catch {
    // private window: the identity lasts as long as the tab
  }
}

// the same hash the server makes of the key (server/server.ts publicId)
async function publicIdOf(key) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
let myId = "";
const isMe = (a) => a.id === myId;

// Two people can pick the same nickname, so every name is shown with the
// last four characters of its public id.
const tagOf = (a) => `#${a.id.slice(-4)}`;
const nameOf = (a) => (isMe(a) ? "you" : `${a.name} ${tagOf(a)}`);

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
const endsText = (endsOn) => (endsOn ? `ends ${dayText(endsOn)}` : "no end date given");

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
  if (!myId) return;
  try {
    const notes = await api("/api/notifications", { author: author() });
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
  try {
    deals = await api(`/api/deals${store ? `?store=${encodeURIComponent(store)}` : ""}`);
    renderFeed();
  } catch (err) {
    $("#feed-status").textContent = `Couldn't load specials: ${err.message}`;
  }
}

function replaceDeal(updated) {
  deals = deals.map((x) => (x.id === updated.id ? updated : x));
  renderFeed();
}

function renderFeed() {
  const byId = storeById();
  const keep = (sel) => new Set([...document.querySelectorAll(`#feed ${sel}[open]`)].map((d) => d.closest("li").dataset.id));
  const [openComments, openCorrect] = [keep("details.comments"), keep("details.correct")];
  $("#feed").replaceChildren(
    ...deals.map((d) => dealCard(d, byId.get(d.storeId), openComments.has(String(d.id)), openCorrect.has(String(d.id)))),
  );
  const store = byId.get($("#store-filter").value);
  $("#feed-status").textContent = deals.length
    ? ""
    : `Nothing posted${store ? ` for ${store.name}, ${store.where}` : ""} yet. Spotted a special? Be the first.`;
}

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
  $(".meta", li).textContent = `${SOURCE_TEXT[d.source]} · ${endsText(d.endsOn)} · posted by ${nameOf(d.author)}, ${ago(d.createdAt)}`;

  if (isMe(d.author)) wireDelete(d, li);

  const group = $(".stock", li);
  group.setAttribute("aria-label", `How much ${d.item} is left`);
  for (const b of group.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.stock === d.stock));
    b.addEventListener("click", () => updateStock(d, b.dataset.stock));
  }
  $(".stock-by", li).textContent = `${STOCK_TEXT[d.stock]}, according to ${nameOf(d.stockBy)}, ${ago(d.stockAt)}`;

  // confirmations
  const confirmedByMe = d.confirmedBy.some(isMe);
  const others = d.confirmations - (confirmedByMe ? 1 : 0);
  const people = (k) => (k === 1 ? "1 other person" : `${k} other people`);
  $(".confirmed", li).textContent =
    d.confirmations === 0 ? "Not confirmed by anyone else yet."
    : confirmedByMe ? `✓ You confirmed this${others ? `, and so did ${people(others)}` : ""}.`
    : `✓ Confirmed by ${d.confirmations === 1 ? "1 person" : `${d.confirmations} people`} besides the poster.`;
  const confirm = $(".confirm", li);
  confirm.hidden = isMe(d.author) || confirmedByMe;
  confirm.addEventListener("click", () => confirmDeal(d.id));

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
      await api(`/api/deals/${d.id}/delete`, { author: author() });
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
  if (!mine) {
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
  if (!requireName()) return;
  try {
    const r = await api(`/api/deals/${d.id}/corrections`, { field, value, note, author: author() });
    replaceDeal(r.deal);
    $("#feed-status").textContent = r.applied
      ? `Corrected: ${FIELD_TEXT[field].toLowerCase()} is now ${valueText(field, value)}.`
      : `Suggestion recorded: ${r.votes} of ${r.needed} needed agree so far.`;
  } catch (err) {
    alertIn(where, err.message);
  }
}

async function confirmDeal(id) {
  if (!requireName()) return;
  try {
    replaceDeal(await api(`/api/deals/${id}/confirm`, { author: author() }));
  } catch (err) {
    $("#feed-status").textContent = err.message;
  }
}

async function updateStock(d, stock) {
  if (!requireName()) return;
  try {
    replaceDeal(await api(`/api/deals/${d.id}/stock`, { stock, author: author() }));
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
  if (!requireName()) return;
  const input = e.target.elements.body;
  if (!input.value.trim()) return input.focus();
  try {
    await api(`/api/deals/${id}/comments`, { body: input.value, author: author() });
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

// --- nickname

const nickname = $("#nickname");

function showMe() {
  nickname.value = me.name;
  $("#me-tag").textContent = me.name && myId ? `#${myId.slice(-4)}` : "";
}

nickname.addEventListener("change", () => {
  me.name = nickname.value.trim().slice(0, 24);
  saveMe();
  showMe();
});

function requireName() {
  if (me.name) return true;
  nickname.focus();
  nickname.setAttribute("aria-invalid", "true");
  $("#feed-status").textContent = "Pick a nickname first, so others know who's reporting.";
  return false;
}

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
  if (!requireName()) {
    error.textContent = "Pick a nickname first (top of the page).";
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

toggle.addEventListener("click", openPost);
$("#post-close").addEventListener("click", () => closePost({ refocus: true }));
for (const panel of [post, similar]) {
  panel.addEventListener("keydown", (e) => e.key === "Escape" && closePost({ refocus: true }));
}

function showSimilar(matches) {
  $("#similar-list").replaceChildren(...matches.map(similarItem));
  // you can't post a second copy of your own, so "post mine" only makes sense
  // when every match is someone else's
  $("#post-anyway").hidden = matches.some((m) => isMe(m.author) && m.score === 1);
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
    replaceOrAdd(await api(`/api/deals/${m.id}/confirm`, { author: author() }));
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
        author: author(),
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
    const deal = await api("/api/deals", { ...draft, author: author() });
    clearPost();
    replaceOrAdd(deal);
    closeSimilar(`Posted “${deal.item}”.`);
    jumpTo(deal.id);
  } catch (err) {
    // the server's one-post-per-person rule: show the post that's already there
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

// --- start

$("#store-filter").addEventListener("change", loadFeed);
nickname.addEventListener("input", () => nickname.removeAttribute("aria-invalid"));
// coming back to the tab picks up what others posted meanwhile
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  loadFeed();
  loadNotices();
});

saveMe();
myId = await publicIdOf(me.key);
showMe();
stores = await api("/api/stores");
renderStoreOptions();
await loadFeed();
loadNotices();
