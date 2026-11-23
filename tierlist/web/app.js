"use strict";
// Tier List Studio: import characters (KoiLog / VNDB), rank them on tiers, export a picture (see export.js).

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STORE = "tierlistStudio.v1";

const TIER_PRESETS = {
  "S – F": [["S", "#ff7f7f"], ["A", "#ffbf7f"], ["B", "#ffdf7f"], ["C", "#bfff7f"], ["D", "#7fbfff"], ["F", "#bf7fff"]],
  "Stars": [["5 ★", "#f2b94b"], ["4 ★", "#e58fb0"], ["3 ★", "#9c8fe0"], ["2 ★", "#6aaed6"], ["1 ★", "#8fa3a8"]],
  "Love scale": [["Soulmate", "#e8467c"], ["Adore", "#f08a5d"], ["Like", "#f2c14e"], ["Fine", "#7bc47f"], ["Not for me", "#7a8ba8"]],
  "Top tiers": [["Best boy", "#d6a63c"], ["Great", "#c96b8c"], ["Good", "#8f7bd1"], ["Okay", "#5fa3c4"], ["Skip", "#8a8f9c"]],
};

let uid = 0;
const newId = () => "t" + Date.now().toString(36) + (uid++).toString(36);
const makeTiers = (preset) => preset.map(([name, color]) => ({ id: newId(), name, color, keys: [] }));

const DEFAULT_UI = { poolPos: "right", poolW: 340, boardCard: 84, poolCard: 64, labelW: 96, labelFs: 22, vennCard: 56, axisCard: 7, captions: true, numbered: false };
const VENN_COLORS = ["#e8467c", "#3aa0e0", "#f2b94b"];
const makeVenn = (n = 3) => ({ n, size: 100, overlap: 55,
  circles: [["Best personality", 0], ["Best design", 1], ["Best voice", 2]].map(([name, i]) => ({ name, color: VENN_COLORS[i] })), regions: {} });
const makeAxis = () => ({ xMin: "Hate", xMax: "Love", yMin: "Villain", yMax: "Hero", grid: 10, aspect: "square", numbers: false, nMin: -5, nMax: 5,
  snap: false, axisColor: "", gridColor: "", quad: ["", "", "", ""], pos: {} });
const state = { name: "My character tier list", mode: "tier", tiers: makeTiers(TIER_PRESETS["S – F"]), items: {}, order: [], venn: makeVenn(), axis: makeAxis(), ui: { ...DEFAULT_UI }, customPresets: {} };
let selected = null;

// ---------- persistence ----------
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage full or blocked: ignore */ } }
function load(doc) {
  if (!doc || !Array.isArray(doc.tiers)) return false;
  state.name = doc.name || state.name;
  state.tiers = doc.tiers.map((t) => ({ id: t.id || newId(), name: t.name || "", color: t.color || "#888888", keys: (t.keys || []).filter((k) => doc.items && doc.items[k]) }));
  state.items = doc.items || {};
  state.order = (doc.order || Object.keys(state.items)).filter((k) => state.items[k]);
  state.mode = doc.mode === "venn" || doc.mode === "axis" ? doc.mode : "tier";
  const v = doc.venn;
  if (v && Array.isArray(v.circles) && v.circles.length >= 2) {
    state.venn = { n: v.n === 2 ? 2 : 3, size: +v.size || 100, overlap: v.overlap ?? 55, regions: {},
      circles: [0, 1, 2].map((i) => ({ name: v.circles[i]?.name ?? makeVenn().circles[i].name, color: v.circles[i]?.color || VENN_COLORS[i] })) };
    for (const [r, ks] of Object.entries(v.regions || {})) state.venn.regions[r] = (ks || []).filter((k) => state.items[k]);
  } else state.venn = makeVenn();
  const ax = doc.axis || {};
  state.axis = { ...makeAxis(), ...ax, quad: [0, 1, 2, 3].map((i) => String(ax.quad?.[i] ?? "")), pos: {} };
  for (const [k, p] of Object.entries(ax.pos || {})) if (state.items[k] && p && isFinite(p.x) && isFinite(p.y)) state.axis.pos[k] = { x: +p.x, y: +p.y };
  state.ui = { ...DEFAULT_UI, ...(doc.ui || {}) };
  state.customPresets = doc.customPresets && typeof doc.customPresets === "object" ? doc.customPresets : {};
  return true;
}
try { load(JSON.parse(localStorage.getItem(STORE))); } catch (e) { /* first run */ }

// ---------- small helpers ----------
function toast(msg, kind = "") {
  const t = $("#toast"); t.textContent = msg; t.className = "toast " + kind; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3800);
}
function inkFor(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || ""); if (!m) return "#111";
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1a1a1a" : "#ffffff";
}
const imgSrc = (u) => (u ? `/proxy/img?u=${encodeURIComponent(u)}` : "");
const placed = () => new Set(state.mode === "venn" ? Object.values(state.venn.regions).flat() : state.mode === "axis" ? Object.keys(state.axis.pos) : state.tiers.flatMap((t) => t.keys));

async function mapPool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; await fn(list[k], k); }
  }));
}

// ---------- layout settings ----------
function applyUi() {
  const u = state.ui, r = document.documentElement.style;
  r.setProperty("--card-w", u.boardCard + "px"); r.setProperty("--pool-card", u.poolCard + "px"); r.setProperty("--label-w", u.labelW + "px");
  r.setProperty("--label-fs", u.labelFs + "px"); r.setProperty("--pool-w", u.poolW + "px"); r.setProperty("--venn-card", u.vennCard + "px");
  document.body.classList.toggle("no-captions", !u.captions);
  document.body.classList.toggle("pool-bottom", u.poolPos === "bottom");
  r.setProperty("--axis-card", u.axisCard);
  document.body.classList.toggle("is-venn", state.mode === "venn");
  document.body.classList.toggle("is-axis", state.mode === "axis");
}

// ---------- boards ----------
function cardHtml(key, idx) {
  const it = state.items[key]; if (!it) return "";
  const tip = [it.label, it.alt && it.alt !== it.label ? it.alt : "", it.game, it.rating ? `your rating ${it.rating}/5` : ""].filter(Boolean).join(" · ");
  return `<figure class="card${selected === key ? " sel" : ""}" draggable="true" data-key="${esc(key)}" title="${esc(tip)}">
    ${it.img ? `<img loading="lazy" src="${esc(imgSrc(it.img))}" alt="">` : `<span class="ph">${esc((it.label || "?")[0])}</span>`}
    ${idx != null ? `<span class="num">${idx + 1}</span>` : ""}<figcaption>${esc(it.label)}</figcaption></figure>`;
}

// Venn geometry in a 100-wide space (height varies). Also used by export.js.
function vennGeom(v) {
  const n = v.n, r0 = 27 * (v.size / 100), d = r0 * (2.2 - 1.2 * (v.overlap / 100));
  const cs = n === 2 ? [[-d / 2, 0], [d / 2, 0]] : [[-d / 2, 0], [d / 2, 0], [0, d * 0.866]];
  const minX = Math.min(...cs.map((c) => c[0] - r0)), maxX = Math.max(...cs.map((c) => c[0] + r0));
  const minY = Math.min(...cs.map((c) => c[1] - r0)), maxY = Math.max(...cs.map((c) => c[1] + r0));
  const sc = Math.min(1, 74 / (maxX - minX)), W = (maxX - minX) * sc, H = (maxY - minY) * sc, mx = 13, my = 11;
  const circles = cs.map(([x, y]) => ({ cx: mx + (x - minX) * sc + (74 - W) / 2, cy: my + (y - minY) * sc, r: r0 * sc }));
  const vh = H + my * 2;
  const keyAt = (x, y) => circles.map((c, i) => ((x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2 ? i : -1)).filter((i) => i >= 0).join("");
  const acc = {};
  for (let y = 0; y < vh; y += 0.5) for (let x = 0; x < 100; x += 0.5) {
    const k = keyAt(x, y); if (!k) continue;
    const a = (acc[k] ||= { sx: 0, sy: 0, n: 0 }); a.sx += x; a.sy += y; a.n++;
  }
  const regions = {};
  for (const [k, a] of Object.entries(acc)) {
    const cx = a.sx / a.n, cy = a.sy / a.n; let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    while (keyAt(x0 - 0.5, cy) === k) x0 -= 0.5;
    while (keyAt(x1 + 0.5, cy) === k) x1 += 0.5;
    while (keyAt(cx, y0 - 0.5) === k) y0 -= 0.5;
    while (keyAt(cx, y1 + 0.5) === k) y1 += 0.5;
    regions[k] = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }
  const mid = { x: circles.reduce((a, c) => a + c.cx, 0) / n, y: circles.reduce((a, c) => a + c.cy, 0) / n };
  const labels = circles.map((c) => {
    if (n === 2) return { x: c.cx, y: c.cy - c.r - 1.5, ax: 0, ay: -1 };
    const dx = c.cx - mid.x, dy = c.cy - mid.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    return { x: c.cx + ux * (c.r + 1.5), y: c.cy + uy * (c.r + 1.5), ax: Math.abs(ux) < 0.3 ? 0 : Math.sign(ux), ay: uy < -0.3 ? -1 : uy > 0.3 ? 1 : 0 };
  });
  return { vh, circles, regions, labels, keyAt };
}

/** Largest card width (<= cap) that lets n cards fit in a bw x bh box. */
function fitCard(n, bw, bh, cap, min, gap = 3, ratio = 1.25, extra = () => 0) {
  for (let cw = Math.floor(cap); cw > min; cw--) {
    const per = Math.floor((bw + gap) / (cw + gap)); if (per < 1) continue;
    const rows = Math.ceil(n / per);
    if (rows * (cw * ratio + extra(cw)) + (rows - 1) * gap <= bh) return cw;
  }
  return min;
}

function vennBoardHtml() {
  const v = state.venn, g = vennGeom(v), px = (x) => x.toFixed(2) + "%", py = (y) => (y / g.vh * 100).toFixed(2) + "%";
  const circ = g.circles.map((c, i) => `<div class="vcircle" style="left:${px(c.cx - c.r)};top:${py(c.cy - c.r)};width:${px(c.r * 2)};height:${py(c.r * 2)};background:${esc(v.circles[i].color)}33;border-color:${esc(v.circles[i].color)}"></div>`).join("");
  const labs = g.labels.map((l, i) => `<div class="vlabel" style="left:${px(l.x)};top:${py(l.y)};transform:translate(${-50 + l.ax * 50}%,${-50 + l.ay * 50}%);color:${esc(v.circles[i].color)}">${esc(v.circles[i].name)}</div>`).join("");
  const regs = Object.entries(g.regions).map(([k, r]) => {
    const keys = (v.regions[k] || []).filter((x) => state.items[x]);
    const ppu = ($("#board").clientWidth || 900) / 100;
    const cw = keys.length ? fitCard(keys.length, r.w * 0.92 * ppu, r.h * 0.86 * ppu, state.ui.vennCard, 16) : state.ui.vennCard;
    return `<div class="vregion" data-region="${k}" style="left:${px(r.cx)};top:${py(r.cy)};width:${px(r.w * 0.92)};--venn-card:${cw}px">${keys.map((x) => cardHtml(x)).join("")}</div>`;
  }).join("");
  return `<div class="venn" id="venn" style="aspect-ratio:100/${g.vh.toFixed(2)}">${circ}${labs}${regs}</div>`;
}

function renderVennBar() {
  const bar = $("#vennBar"), v = state.venn; bar.hidden = state.mode !== "venn"; if (bar.hidden) return;
  bar.innerHTML = `<label>Circles <select id="vN"><option value="2"${v.n === 2 ? " selected" : ""}>2</option><option value="3"${v.n === 3 ? " selected" : ""}>3</option></select></label>
    ${v.circles.slice(0, v.n).map((c, i) => `<span class="vc"><input type="color" data-vc="${i}" data-f="color" value="${esc(c.color)}" aria-label="Circle ${i + 1} colour"><input data-vc="${i}" data-f="name" value="${esc(c.name)}" maxlength="30" aria-label="Circle ${i + 1} name"></span>`).join("")}
    <label>Circle size <input type="range" id="vSize" min="60" max="130" value="${v.size}"></label>
    <label>Overlap <input type="range" id="vOver" min="15" max="95" value="${v.overlap}"></label>`;
}

function render() {
  const venn = state.mode === "venn";
  applyUi();
  if (renderVennBar.lastMode !== state.mode + state.venn.n) { renderVennBar(); renderAxisBar(); renderVennBar.lastMode = state.mode + state.venn.n; }
  $("#modeSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  $("#btnTiers").hidden = state.mode !== "tier"; $("#btnAuto").textContent = { venn: "Auto-fill from ratings", axis: "Auto-plot from ratings", tier: "Auto-rank by rating" }[state.mode];
  if (state.mode === "axis") $("#board").innerHTML = axisBoardHtml();
  else if (venn) $("#board").innerHTML = vennBoardHtml();
  else $("#board").innerHTML = state.tiers.map((t) => `
    <div class="tier" data-tier="${t.id}">
      <div class="tier-label" data-rename="${t.id}" style="background:${esc(t.color)};color:${inkFor(t.color)}" title="Double-click to rename"><span>${esc(t.name)}</span></div>
      <div class="tier-cards" data-tier="${t.id}">${t.keys.map((k, i) => cardHtml(k, state.ui.numbered ? i : null)).join("")}</div>
    </div>`).join("");
  const inBoard = placed();
  const q = $("#poolSearch").value.trim().toLowerCase();
  let keys = state.order.filter((k) => !inBoard.has(k) && state.items[k]);
  const all = keys.length;
  if (q) keys = keys.filter((k) => `${state.items[k].label} ${state.items[k].alt || ""} ${state.items[k].game || ""}`.toLowerCase().includes(q));
  const sort = $("#poolSort").value;
  if (sort === "name") keys.sort((a, b) => state.items[a].label.localeCompare(state.items[b].label));
  else if (sort === "game") keys.sort((a, b) => (state.items[a].game || "").localeCompare(state.items[b].game || "") || state.items[a].label.localeCompare(state.items[b].label));
  else if (sort === "rating") keys.sort((a, b) => (state.items[b].rating || 0) - (state.items[a].rating || 0));
  $("#pool").innerHTML = keys.map((k) => cardHtml(k)).join("") || `<p class="muted empty">${all ? "No match." : "Nothing here yet. Use <b>Import characters</b>."}</p>`;
  $("#poolCount").textContent = all ? `${all} unranked` : "";
  if (document.activeElement !== $("#listName")) $("#listName").value = state.name;
}

/** dest: a tier id (tier mode) or a Venn region key like "01" (venn mode); "" returns the card to the pool. */
function moveKey(key, dest, beforeKey, at) {
  if (state.mode === "axis") { if (dest === "axis" && at) state.axis.pos[key] = at; else delete state.axis.pos[key]; selected = null; save(); render(); return; }
  const lists = state.mode === "venn" ? Object.values(state.venn.regions) : state.tiers.map((t) => t.keys);
  lists.forEach((arr) => { const i = arr.indexOf(key); if (i >= 0) arr.splice(i, 1); });
  if (dest) {
    const arr = state.mode === "venn" ? (state.venn.regions[dest] ||= []) : state.tiers.find((x) => x.id === dest)?.keys;
    if (!arr) return;
    const i = beforeKey ? arr.indexOf(beforeKey) : -1;
    if (i >= 0) arr.splice(i, 0, key); else arr.push(key);
  }
  selected = null; save(); render();
}

function vennRegionAt(e) {
  const el = $("#venn"); if (!el) return null;
  const r = el.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
  const g = vennGeom(state.venn);
  return g.keyAt((e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * g.vh);
}
function dropTarget(e) {
  if (state.mode === "axis") {
    if (e.target.closest("#pool")) return { tier: "", before: null };
    const at = axisPointAt(e); return at ? { tier: "axis", before: null, at } : null;
  }
  if (state.mode === "venn") {
    if (e.target.closest("#pool")) return { tier: "", before: null };
    if (!e.target.closest("#venn")) return null;
    const card = e.target.closest(".card"); let before = null;
    if (card) { const r = card.getBoundingClientRect(); const nx = e.clientX > r.left + r.width / 2 ? card.nextElementSibling : card; before = nx?.dataset?.key || null; }
    const k = vennRegionAt(e);
    return { tier: k || "", before: k ? before : null };
  }
  const zone = e.target.closest("[data-tier]"); if (!zone) return null;
  const zoneEl = zone.classList.contains("tier") ? zone.querySelector(".tier-cards") : zone;
  const card = e.target.closest(".card");
  let before = null;
  if (card && card.dataset.key) {
    const r = card.getBoundingClientRect();
    const next = e.clientX > r.left + r.width / 2 ? card.nextElementSibling : card;
    before = next && next.dataset ? next.dataset.key || null : null;
  }
  return { tier: zoneEl.dataset.tier || "", before };
}

document.addEventListener("dragstart", (e) => {
  const c = e.target.closest?.(".card"); if (!c) return;
  e.dataTransfer.setData("text/plain", c.dataset.key); e.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragover", (e) => { if (e.target.closest?.("[data-tier], #venn, #axis")) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  const key = e.dataTransfer.getData("text/plain"); const d = dropTarget(e);
  if (!key || !state.items[key] || !d) return;
  e.preventDefault(); moveKey(key, d.tier, d.before === key ? null : d.before, d.at);
});
document.addEventListener("click", (e) => {
  const c = e.target.closest?.(".card");
  if (c) { selected = selected === c.dataset.key ? null : c.dataset.key; render(); return; }
  if (!selected) return;
  if (state.mode !== "tier") { const d = dropTarget(e); if (d) moveKey(selected, d.tier, null, d.at); return; }
  const zone = e.target.closest?.("#board .tier, #pool");
  if (zone) moveKey(selected, zone.dataset.tier || "");
});
document.addEventListener("contextmenu", (e) => {
  const c = e.target.closest?.(".card"); if (!c) return;
  e.preventDefault();
  const it = state.items[c.dataset.key];
  if (it && confirm(`Remove ${it.label} from this list?`)) removeItem(c.dataset.key);
});
function removeItem(key) {
  state.tiers.forEach((t) => (t.keys = t.keys.filter((k) => k !== key)));
  Object.values(state.venn.regions).forEach((a) => { const j = a.indexOf(key); if (j >= 0) a.splice(j, 1); });
  delete state.axis.pos[key];
  delete state.items[key]; state.order = state.order.filter((k) => k !== key); save(); render();
}

// ---------- adding items ----------
function addItems(list) {
  let n = 0;
  for (const it of list) {
    if (!it.key || !it.label) continue;
    if (!state.items[it.key]) { state.order.push(it.key); n++; }
    state.items[it.key] = { ...state.items[it.key], ...it };
  }
  save(); render(); return n;
}

// ---------- KoiLog ----------
async function kl(path) {
  const r = await fetch("/proxy/koilog/" + path);
  if (r.status === 404) throw new Error("Not found on KoiLog");
  if (!r.ok) throw new Error(`KoiLog said ${r.status}`);
  return r.json();
}
const pickName = (names, def = true) => (names || []).find((n) => n.default)?.value || (names || [])[0]?.value || "";
const origName = (names) => (names || []).find((n) => n.isOriginal)?.value || (names || []).find((n) => n.lang === "ja")?.value || "";
const gameTitle = (g) => (g.titles || []).find((t) => t.default)?.value || (g.titles || [])[0]?.value || "";

function klCharItem(c, game, extra = {}) {
  return { key: "kl:" + c.id, label: pickName(c.names), alt: origName(c.names), game: gameTitle(game),
    img: c.avatarUrls?.thumbnail || "", imgHi: c.avatarUrls?.original || "", ...extra };
}

async function importKoilogUser(input, onlyPlayed, withRatings, progress) {
  const name = input.trim().replace(/^.*\/u\//, "").replace(/[/?#].*$/, "");
  if (!name) throw new Error("Enter a username");
  progress(0, "Looking up profile…");
  const user = await kl("users/" + encodeURIComponent(name));
  if (user.isProfilePublic === false) throw new Error("That profile is private");
  const games = [];
  for (let p = 1; ; p++) {
    progress(0, `Reading game list (page ${p})…`);
    const d = await kl(`users/${user.id}/games/status-summary?page=${p}&pageSize=50`);
    games.push(...d.data);
    if (!d.pagination?.hasMore) break;
  }
  const ratings = {};
  if (withRatings) {
    try { for (const r of await kl(`users/${user.id}/character-ratings`)) ratings[r.characterId] = r; } catch (e) { /* optional */ }
  }
  const wanted = (r) => !onlyPlayed || (r.routeStatus && r.routeStatus !== "TO_PLAY");
  const targets = games.filter((g) => (g.routeStatuses || []).some(wanted));
  let done = 0, added = 0;
  await mapPool(targets, 8, async (g) => {
    try {
      const [game, chars] = await Promise.all([kl("games/" + g.id), kl(`games/${g.id}/characters`)]);
      const byId = Object.fromEntries(chars.map((c) => [c.id, c]));
      const items = [];
      for (const rs of g.routeStatuses || []) {
        const c = byId[rs.characterId]; if (!c || !wanted(rs)) continue;
        const rt = ratings[c.id];
        items.push(klCharItem(c, game, { status: rs.routeStatus, rating: rt?.overall || 0,
          sub: rt ? [rt.appearance || 0, rt.storyline || 0, rt.personality || 0, rt.voiceActing || 0] : [] }));
      }
      added += addItems(items);
    } catch (e) { /* skip a game that fails */ }
    progress(++done / targets.length, `Fetched ${done} of ${targets.length} games · ${added} characters`);
  });
  if (!$("#listName").dataset.touched && state.name === "My character tier list") { state.name = `${user.displayName || name}'s characters`; save(); render(); }
  return { added, games: targets.length };
}

// ---------- VNDB ----------
async function vndb(endpoint, body, method = "POST") {
  const r = await fetch("https://api.vndb.org/kana/" + endpoint, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`VNDB said ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}
async function vndbAll(endpoint, body) {
  const out = [];
  for (let page = 1; ; page++) {
    const d = await vndb(endpoint, { ...body, results: 100, page });
    out.push(...d.results); if (!d.more || page > 30) break;
  }
  return out;
}
const vndbImg = (c) => c.image?.url || "";

async function vndbCharactersFor(vnIds, mainOnly, progress) {
  const titles = {};
  for (let i = 0; i < vnIds.length; i += 50) {
    const part = vnIds.slice(i, i + 50);
    for (const v of await vndbAll("vn", { filters: ["or", ...part.map((id) => ["id", "=", id])], fields: "id,title" })) titles[v.id] = v.title;
  }
  let added = 0;
  for (let i = 0; i < vnIds.length; i += 15) {
    const part = vnIds.slice(i, i + 15);
    progress(i / vnIds.length, `Reading characters ${Math.min(i + 15, vnIds.length)} of ${vnIds.length} games…`);
    const chars = await vndbAll("character", { filters: ["or", ...part.map((id) => ["vn", "=", ["id", "=", id]])], fields: "id,name,original,image.url,vns.id,vns.role" });
    const items = [];
    for (const c of chars) {
      const link = (c.vns || []).find((v) => part.includes(v.id) && (!mainOnly || v.role === "main" || v.role === "primary"));
      if (!link) continue;
      items.push({ key: "vn:" + c.id, label: c.name, alt: c.original || "", game: titles[link.id] || link.id, img: vndbImg(c), imgHi: vndbImg(c) });
    }
    added += addItems(items);
  }
  return added;
}

async function importVndb(input, mainOnly, progress) {
  let ids = (input.match(/\bv\d+\b/gi) || []).map((s) => s.toLowerCase());
  if (!ids.length) {
    const name = input.trim(); if (!name) throw new Error("Enter VN ids or a username");
    progress(0, "Looking up VNDB user…");
    let u = /^u\d+$/i.test(name) ? name.toLowerCase() : null;
    if (!u) { const r = await vndb("user?q=" + encodeURIComponent(name), null, "GET"); u = r[name]?.id || Object.values(r).find(Boolean)?.id; }
    if (!u) throw new Error("VNDB user not found");
    progress(0, "Reading their list…");
    const list = await vndbAll("ulist", { user: u, fields: "id", filters: ["or", ["label", "=", 1], ["label", "=", 2], ["label", "=", 3], ["label", "=", 4]] });
    ids = list.map((x) => x.id);
    if (!ids.length) throw new Error("That list has no Playing / Finished / Stalled / Dropped games (or it's private)");
  }
  return { added: await vndbCharactersFor([...new Set(ids)], mainOnly, progress), games: ids.length };
}

// ---------- name search ----------
async function searchByName(q) {
  const [kg, vv, vc] = await Promise.allSettled([
    kl(`games?searchQuery=${encodeURIComponent(q)}&pageSize=30`),
    vndb("vn", { filters: ["search", "=", q], fields: "id,title", results: 15 }),
    vndb("character", { filters: ["search", "=", q], fields: "id,name,original,image.url,vns.id,vns.role,vns.title", results: 20 }),
  ]);
  const rows = [];
  if (kg.status === "fulfilled") for (const g of kg.value.data || []) rows.push({ kind: "KoiLog game", title: gameTitle(g), act: { type: "klgame", game: g } });
  if (vv.status === "fulfilled") for (const v of vv.value.results) rows.push({ kind: "VNDB game", title: v.title, act: { type: "vn", id: v.id } });
  if (vc.status === "fulfilled") for (const c of vc.value.results) rows.push({ kind: "VNDB character", title: `${c.name}${c.original ? " · " + c.original : ""}`, sub: c.vns?.[0]?.title || "", img: vndbImg(c), act: { type: "vnchar", c } });
  return rows;
}

// ---------- dialogs ----------
function openDlg(sel) { const d = $(sel); if (!d.open) d.showModal(); return d; }
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) e.target.closest("dialog").close();
  else if (e.target.tagName === "DIALOG") e.target.close();
});

let importing = false;
function setStatus(frac, msg) {
  $("#impStatus").hidden = false; $("#impBar").style.width = Math.round(frac * 100) + "%"; $("#impMsg").textContent = msg;
}
async function runImport(btn, job) {
  if (importing) return; importing = true; btn.disabled = true;
  try {
    const r = await job();
    $("#impStatus").hidden = false; $("#impBar").style.width = "100%";
    $("#impMsg").textContent = `Done: ${r.added} new character${r.added === 1 ? "" : "s"} from ${r.games} game${r.games === 1 ? "" : "s"}.`;
    toast(`Added ${r.added} characters`);
  } catch (err) { $("#impStatus").hidden = false; $("#impMsg").textContent = "⚠ " + err.message; toast(err.message, "error"); }
  finally { importing = false; btn.disabled = false; }
}

$("#btnImport").onclick = () => openDlg("#importDlg");
$$(".tabs [data-tab]").forEach((b) => (b.onclick = () => {
  $$(".tabs [data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
}));
$("#klGo").onclick = (e) => runImport(e.target, () => importKoilogUser($("#klUser").value, $("#klPlayed").checked, $("#klRank").checked, setStatus));
$("#klUser").onkeydown = (e) => e.key === "Enter" && $("#klGo").click();
$("#vnGo").onclick = (e) => runImport(e.target, () => importVndb($("#vnIn").value, $("#vnMain").checked, setStatus));
$("#vnIn").onkeydown = (e) => e.key === "Enter" && $("#vnGo").click();
$("#nmGo").onclick = async () => {
  const q = $("#nmIn").value.trim(); if (q.length < 2) return;
  $("#nmRes").innerHTML = `<p class="muted">Searching…</p>`;
  const rows = await searchByName(q);
  $("#nmRes").innerHTML = rows.map((r, i) => `<div class="res"><span class="kind">${esc(r.kind)}</span>
    ${r.img ? `<img src="${esc(imgSrc(r.img))}" alt="">` : ""}<span class="rt">${esc(r.title)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>
    <button class="ghost" data-res="${i}">${r.act.type === "vnchar" ? "Add" : "Add characters"}</button></div>`).join("") || `<p class="muted">No results.</p>`;
  $("#nmRes").onclick = (e) => {
    const b = e.target.closest("[data-res]"); if (!b) return;
    const a = rows[+b.dataset.res].act;
    runImport(b, async () => {
      if (a.type === "vnchar") { const c = a.c; return { added: addItems([{ key: "vn:" + c.id, label: c.name, alt: c.original || "", game: c.vns?.[0]?.title || "", img: vndbImg(c), imgHi: vndbImg(c) }]), games: 1 }; }
      if (a.type === "vn") return { added: await vndbCharactersFor([a.id], false, setStatus), games: 1 };
      const chars = await kl(`games/${a.game.id}/characters`);
      return { added: addItems(chars.map((c) => klCharItem(c, a.game))), games: 1 };
    });
  };
};
$("#nmIn").onkeydown = (e) => e.key === "Enter" && $("#nmGo").click();

// ---------- rank editor ----------
const allPresets = () => ({ ...TIER_PRESETS, ...state.customPresets });
function rainbow(i, n) { return `hsl(${Math.round((i / Math.max(1, n)) * 300)} 75% 68%)`; }
function hslToHex(h) {
  const c = document.createElement("canvas").getContext("2d"); c.fillStyle = h; return c.fillStyle; // browser normalises to #rrggbb
}
function applyRanks(list) {
  const fresh = makeTiers(list);
  state.tiers.forEach((t, i) => fresh[Math.min(i, fresh.length - 1)].keys.push(...t.keys));
  state.tiers = fresh; save(); render(); renderTierEditor();
}
function renderTierEditor() {
  const ps = allPresets();
  $("#tierPresets").innerHTML = Object.keys(ps).map((k) => `<button class="chip" data-preset="${esc(k)}">${esc(k)}</button>${state.customPresets[k] ? `<button class="chip x" data-delpreset="${esc(k)}" title="Delete preset" aria-label="Delete preset ${esc(k)}">✕</button>` : ""}`).join("");
  $("#tierRows").innerHTML = state.tiers.map((t, i) => `<div class="tier-edit" data-i="${i}">
    <input type="color" value="${esc(t.color)}" data-f="color" aria-label="Colour">
    <input value="${esc(t.name)}" data-f="name" maxlength="24" aria-label="Rank name">
    <span class="muted">${t.keys.length}</span>
    <button class="icon" data-act="up" ${i ? "" : "disabled"} aria-label="Move up">↑</button>
    <button class="icon" data-act="down" ${i < state.tiers.length - 1 ? "" : "disabled"} aria-label="Move down">↓</button>
    <button class="icon" data-act="del" aria-label="Delete rank">✕</button></div>`).join("");
  $("#uiNumbered").checked = !!state.ui.numbered;
}
$("#btnTiers").onclick = () => { renderTierEditor(); openDlg("#tiersDlg"); };
$("#tierAdd").onclick = () => { state.tiers.push({ id: newId(), name: "New", color: "#8a93b3", keys: [] }); save(); render(); renderTierEditor(); };
$("#tierSavePreset").onclick = () => {
  const name = (prompt("Name this preset:", "My ranks") || "").trim(); if (!name) return;
  state.customPresets[name] = state.tiers.map((t) => [t.name, t.color]); save(); renderTierEditor(); toast(`Saved preset "${name}"`);
};
$("#tierPasteGo").onclick = () => {
  const lines = $("#tierPaste").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
  if (!lines.length) return toast("Type at least one rank", "error");
  const list = lines.map((l, i) => {
    const m = /^(.*?)[\s,]*(#[0-9a-f]{6})?$/i.exec(l);
    return [(m[1] || l).trim().slice(0, 24) || "?", m[2] || hslToHex(rainbow(i, lines.length))];
  });
  applyRanks(list); $("#tierPaste").value = "";
};
$("#uiNumbered").onchange = (e) => { state.ui.numbered = e.target.checked; save(); render(); };
$("#tiersDlg").addEventListener("input", (e) => {
  const row = e.target.closest(".tier-edit"); if (!row || !e.target.dataset.f) return;
  state.tiers[+row.dataset.i][e.target.dataset.f] = e.target.value; save(); render();
});
$("#tiersDlg").addEventListener("click", (e) => {
  const d = e.target.closest("[data-delpreset]");
  if (d) { delete state.customPresets[d.dataset.delpreset]; save(); renderTierEditor(); return; }
  const p = e.target.closest("[data-preset]");
  if (p) return applyRanks(allPresets()[p.dataset.preset]);
  const b = e.target.closest("[data-act]"); if (!b) return;
  const i = +b.closest(".tier-edit").dataset.i, ts = state.tiers;
  if (b.dataset.act === "up" && i > 0) [ts[i - 1], ts[i]] = [ts[i], ts[i - 1]];
  else if (b.dataset.act === "down" && i < ts.length - 1) [ts[i + 1], ts[i]] = [ts[i], ts[i + 1]];
  else if (b.dataset.act === "del") { if (ts.length <= 1) return toast("Keep at least one rank", "error"); ts.splice(i, 1); }
  save(); render(); renderTierEditor();
});
// rename a rank right on the board
$("#board").addEventListener("dblclick", (e) => {
  const lab = e.target.closest("[data-rename]"); if (!lab) return;
  const t = state.tiers.find((x) => x.id === lab.dataset.rename), span = lab.firstElementChild;
  span.contentEditable = "true"; span.focus(); getSelection().selectAllChildren(span);
  const done = () => { span.contentEditable = "false"; t.name = span.textContent.trim().slice(0, 24) || t.name; save(); render(); };
  span.addEventListener("blur", done, { once: true });
  span.addEventListener("keydown", (k) => { if (k.key === "Enter") { k.preventDefault(); span.blur(); } });
});

// ---------- layout dialog and pool resizer ----------
function syncLayoutDialog() {
  $$("#layoutBody [data-ui]").forEach((el) => {
    const v = state.ui[el.dataset.ui];
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    const out = el.parentElement.querySelector("output"); if (out) out.textContent = v + (el.dataset.ui === "axisCard" ? " %" : " px");
  });
}
$("#btnLayout").onclick = () => { syncLayoutDialog(); openDlg("#layoutDlg"); };
$("#layoutBody").addEventListener("input", (e) => {
  const k = e.target.dataset.ui; if (!k) return;
  state.ui[k] = e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" ? +e.target.value : e.target.value;
  save(); applyUi(); syncLayoutDialog();
});
$("#layoutReset").onclick = () => { state.ui = { ...DEFAULT_UI }; save(); render(); syncLayoutDialog(); };
$("#resizer").addEventListener("pointerdown", (e) => {
  e.preventDefault(); const startX = e.clientX, startW = state.ui.poolW; $("#resizer").setPointerCapture(e.pointerId);
  const move = (m) => { state.ui.poolW = Math.max(220, Math.min(760, Math.round(startW - (m.clientX - startX)))); applyUi(); };
  const up = () => { $("#resizer").removeEventListener("pointermove", move); $("#resizer").removeEventListener("pointerup", up); save(); };
  $("#resizer").addEventListener("pointermove", move); $("#resizer").addEventListener("pointerup", up);
});

// ---------- axis chart ----------
const fmtTick = (v) => String(Math.round(v * 10) / 10);
function axisBoardHtml() {
  const a = state.axis, N = a.grid || 0, ratio = a.aspect === "wide" ? 66.67 : 100;
  const ticks = a.numbers && N ? Array.from({ length: N + 1 }, (_, i) => {
    const vx = a.nMin + (a.nMax - a.nMin) * i / N, vy = a.nMax - (a.nMax - a.nMin) * i / N, p = (i / N * 100).toFixed(2) + "%";
    return `<span class="tk tx" style="left:${p}">${fmtTick(vx)}</span>${i * 2 === N ? "" : `<span class="tk ty" style="top:${p}">${fmtTick(vy)}</span>`}`;
  }).join("") : "";
  const quad = ["tl", "tr", "bl", "br"].map((c, i) => (a.quad[i] ? `<span class="aq aq-${c}">${esc(a.quad[i])}</span>` : "")).join("");
  const cards = Object.entries(a.pos).filter(([k]) => state.items[k]).map(([k, p]) =>
    `<div class="apos" style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%">${cardHtml(k)}</div>`).join("");
  const ax = a.axisColor ? `;--ac:${esc(a.axisColor)}` : "", gc = a.gridColor ? `;--gc:${esc(a.gridColor)}` : "";
  return `<div class="axis-outer" style="${ax}${gc}">
    <div class="al al-top">${esc(a.yMax)}</div><div class="al al-bottom">${esc(a.yMin)}</div>
    <div class="al al-left">${esc(a.xMin)}</div><div class="al al-right">${esc(a.xMax)}</div>
    <div class="axis" id="axis" style="aspect-ratio:100/${ratio};--n:${N || 1}${N ? "" : ";background-image:none"}">
      <i class="aline ah"></i><i class="aline av"></i>${ticks}${quad}${cards}</div></div>`;
}

function renderAxisBar() {
  const bar = $("#axisBar"), a = state.axis; bar.hidden = state.mode !== "axis"; if (bar.hidden) return;
  const t = (f, lab, w = 110) => `<label>${lab} <input data-af="${f}" value="${esc(a[f])}" maxlength="30" style="width:${w}px"></label>`;
  bar.innerHTML = `${t("xMin", "Left")}${t("xMax", "Right")}${t("yMax", "Top")}${t("yMin", "Bottom")}
    <label>Grid <select data-af="grid">${[0, 4, 6, 8, 10, 12, 16, 20].map((n) => `<option value="${n}"${a.grid === n ? " selected" : ""}>${n ? n + "×" + n : "none"}</option>`).join("")}</select></label>
    <label>Shape <select data-af="aspect"><option value="square"${a.aspect === "square" ? " selected" : ""}>Square</option><option value="wide"${a.aspect === "wide" ? " selected" : ""}>Wide</option></select></label>
    <label class="inline"><input type="checkbox" data-af="numbers"${a.numbers ? " checked" : ""}> Numbers</label>
    <label>from <input type="number" data-af="nMin" value="${a.nMin}" style="width:56px"> to <input type="number" data-af="nMax" value="${a.nMax}" style="width:56px"></label>
    <label class="inline"><input type="checkbox" data-af="snap"${a.snap ? " checked" : ""}> Snap to grid</label>
    <label>Axes <input type="color" data-af="axisColor" value="${esc(a.axisColor || "#6b5b73")}"></label>
    <label>Grid <input type="color" data-af="gridColor" value="${esc(a.gridColor || "#a9c4e6")}"></label>
    <details><summary>Corner labels</summary><div class="row">${["Top left", "Top right", "Bottom left", "Bottom right"].map((n, i) => `<input data-q="${i}" placeholder="${n}" value="${esc(a.quad[i])}" maxlength="24" style="width:130px">`).join("")}</div></details>`;
}
$("#axisBar").addEventListener("input", (e) => {
  const t = e.target, a = state.axis;
  if (t.dataset.q !== undefined) a.quad[+t.dataset.q] = t.value;
  else if (t.dataset.af) {
    const f = t.dataset.af;
    a[f] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? 0 : +t.value) : f === "grid" ? +t.value : t.value;
  } else return;
  save(); render();
});

function axisPointAt(e) {
  const el = $("#axis"); if (!el) return null;
  const r = el.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
  let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; const N = state.axis.grid;
  if (state.axis.snap && N) { x = (Math.floor(x * N - 1e-9) + 0.5) / N; y = (Math.floor(y * N - 1e-9) + 0.5) / N; }
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}
// Left-right = personality, bottom-top = looks, from your KoiLog ratings (1 to 5 stars each), with a little spread so cards don't stack.
function autoPlotAxis(rated) {
  const a = state.axis; let n = 0, seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  Object.assign(a, { xMin: "Weak personality", xMax: "Great personality", yMin: "Plain design", yMax: "Gorgeous design", numbers: false });
  a.pos = {};
  for (const k of rated) {
    const sub = state.items[k].sub || []; if (sub.length !== 4 || !sub[0] || !sub[2]) continue;
    a.pos[k] = { x: Math.min(0.97, Math.max(0.03, 0.1 + (sub[2] - 1) / 4 * 0.8 + rnd() * 0.12)), y: Math.min(0.97, Math.max(0.03, 0.9 - (sub[0] - 1) / 4 * 0.8 + rnd() * 0.12)) }; n++;
  }
  renderVennBar.lastMode = null; return n;
}

// ---------- venn controls ----------
$("#modeSeg").onclick = (e) => {
  const b = e.target.closest("[data-mode]"); if (!b || b.dataset.mode === state.mode) return;
  state.mode = b.dataset.mode; selected = null; save(); render();
};
$("#vennBar").addEventListener("input", (e) => {
  const t = e.target, v = state.venn;
  if (t.id === "vSize") v.size = +t.value;
  else if (t.id === "vOver") v.overlap = +t.value;
  else if (t.dataset.vc !== undefined) v.circles[+t.dataset.vc][t.dataset.f] = t.value;
  else return;
  save(); render();
});
$("#vennBar").addEventListener("change", (e) => {
  if (e.target.id !== "vN") return;
  const v = state.venn, n = +e.target.value; v.n = n;
  for (const k of Object.keys(v.regions)) if (k.split("").some((c) => +c >= n)) delete v.regions[k]; // regions that used the dropped circle go back to the pool
  renderVennBar.lastMode = null; save(); render();
});

// ---------- toolbar ----------
$("#listName").oninput = (e) => { state.name = e.target.value; e.target.dataset.touched = "1"; save(); };
$("#poolSearch").oninput = render; $("#poolSort").onchange = render;

function autoRankTiers(rated) {
  const n = state.tiers.length;
  state.tiers.forEach((t) => (t.keys = []));
  const score = (it) => { const sb = (it.sub || []).filter(Boolean); return it.rating * 10 + sb.reduce((a, b) => a + b, 0) / Math.max(1, sb.length); };
  rated.sort((a, b) => score(state.items[b]) - score(state.items[a]));
  for (const k of rated) state.tiers[Math.round(((5 - state.items[k].rating) / 4) * (n - 1))].keys.push(k);
}
// Venn: circles become "Looks / Personality / Voice"; a character joins a circle when you gave that aspect 5 stars.
function autoFillVenn(rated) {
  const v = state.venn; v.n = 3; v.regions = {}; v.overlap = Math.max(v.overlap, 72);
  v.circles[0].name = "Looks (5★)"; v.circles[1].name = "Personality (5★)"; v.circles[2].name = "Voice (5★)";
  const idx = [0, 2, 3]; let n = 0;
  for (const k of rated) {
    const sub = state.items[k].sub || []; if (sub.length !== 4) continue;
    const key = idx.map((si, ci) => (sub[si] >= 5 ? ci : -1)).filter((c) => c >= 0).join("");
    if (key) { (v.regions[key] ||= []).push(k); n++; }
  }
  renderVennBar.lastMode = null; return n;
}
$("#btnAuto").onclick = () => {
  const rated = state.order.filter((k) => state.items[k]?.rating);
  if (!rated.length) return toast("No KoiLog character ratings loaded. Import a KoiLog user with ratings ticked.", "error");
  if (state.mode === "axis") { const n = autoPlotAxis(rated); save(); render(); return toast(n ? `Plotted ${n} characters by your ratings` : "No characters with looks and personality ratings (re-import to refresh)", n ? "" : "error"); }
  if (state.mode === "venn") { const n = autoFillVenn(rated); save(); render(); return toast(n ? `Placed ${n} characters by your ratings` : "None of your rated characters have a 5★ aspect (re-import to refresh)", n ? "" : "error"); }
  autoRankTiers(rated); save(); render(); toast(`Placed ${rated.length} characters by your rating`);
};
$("#btnReset").onclick = () => {
  if (state.mode === "venn") state.venn.regions = {}; else if (state.mode === "axis") state.axis.pos = {}; else state.tiers.forEach((t) => (t.keys = []));
  save(); render(); $("#btnReset").closest("details").open = false;
};
// Reset character pool: removes the unranked characters shown in the pool; anything already on the board stays.
function resetPool() {
  const here = placed(), keys = state.order.filter((k) => state.items[k] && !here.has(k));
  if (!keys.length) return toast("The pool is already empty");
  const elsewhere = new Set([...state.tiers.flatMap((t) => t.keys), ...Object.values(state.venn.regions).flat(), ...Object.keys(state.axis.pos)]);
  const other = keys.filter((k) => elsewhere.has(k)).length;
  if (!confirm(`Remove ${keys.length} unranked character${keys.length === 1 ? "" : "s"} from the pool?` + (other ? `\n${other} of them are placed in another view (tier list, Venn or axis chart) and will be removed from there too.` : "") + "\nCharacters already on this board stay.")) return;
  const gone = new Set(keys);
  state.tiers.forEach((t) => (t.keys = t.keys.filter((k) => !gone.has(k))));
  Object.values(state.venn.regions).forEach((a) => { for (let i = a.length - 1; i >= 0; i--) if (gone.has(a[i])) a.splice(i, 1); });
  keys.forEach((k) => { delete state.axis.pos[k]; delete state.items[k]; });
  state.order = state.order.filter((k) => !gone.has(k));
  selected = null; save(); render(); toast(`Removed ${keys.length} from the pool`);
}
$("#btnPoolReset").onclick = () => { resetPool(); $("#btnPoolReset").closest("details").open = false; };
$("#btnPoolReset2").onclick = resetPool;
$("#btnClear").onclick = () => {
  if (!confirm("Remove every character from this list? Ranks and circles are kept.")) return;
  state.tiers.forEach((t) => (t.keys = [])); state.venn.regions = {}; state.axis.pos = {}; state.items = {}; state.order = []; save(); render(); $("#btnClear").closest("details").open = false;
};
$("#btnSave").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: "application/json" }));
  a.download = (state.name.replace(/[^\w-]+/g, "-") || "tier-list") + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
$("#btnLoad").onclick = () => $("#fileIn").click();
$("#fileIn").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { if (!load(JSON.parse(await f.text()))) throw 0; save(); renderVennBar.lastMode = null; render(); toast("List opened"); } catch (err) { toast("That isn't a tier list file", "error"); }
  e.target.value = "";
};
$("#btnExport").onclick = () => openTierExport();
let resizeT; addEventListener("resize", () => { if (state.mode !== "venn") return; clearTimeout(resizeT); resizeT = setTimeout(render, 200); });

render();
