"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LABELS = {
  category: { otome: "Otome", bl: "BL", josei: "Josei-muke" },
  format: { pc: "PC", emulated: "Emulated", physical: "Physical" },
  status: { unplayed: "Unplayed", playing: "Playing", completed: "Completed", dropped: "Dropped" },
  platform: { pc: "PC", psp: "PSP", vita: "PS Vita", switch: "Switch", ps4: "PS4", other: "Other" },
  route: { none: "—", progress: "Playing", good: "Good end", bad: "Bad end" },
};
const THEMES = ["pastel", "noir"];

const state = {
  games: [],
  settings: { emulators: {} },
  filter: { q: "", category: "", format: "", status: "" },
  sort: "title",
  editing: null, // game being edited, or null when adding
};

// Pages opened from the side menu. Each page registers itself here: VIEWS.name = { render(host) }.
const VIEWS = { library: {} };
let currentView = "library";

// ---------- helpers ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 3000);
}

const year = (d) => (d || "").slice(0, 4);
const canLaunch = (g) => (g.format === "pc" && !!g.exePath) || (g.format === "emulated" && !!g.romPath);
const DIFF_NAMES = ["Beginner", "Easy", "Average", "Hard", "Expert", "Insane"];
const fmt = (n) => (+n || 0).toLocaleString();
const diffPill = (g) => g.jiten?.deckId
  ? `<span class="diff d${+g.jiten.difficulty || 0}" title="Jiten difficulty ${g.jiten.difficultyRaw} / 5${g.jiten.coverage != null ? ` · you know ${g.jiten.coverage}% of the text` : ""}">${esc(DIFF_NAMES[g.jiten.difficulty] ?? "?")} ${(+g.jiten.difficultyRaw).toFixed(1)}${g.jiten.coverage != null ? ` · ${Math.round(g.jiten.coverage)}%` : ""}</span>`
  : "";
const hoursOf = (g) => g.jiten.characterCount / (state.settings.readingSpeed || 14000);
const hoursText = (h) => h < 1 ? "<1" : h < 10 ? h.toFixed(1) : String(Math.round(h));
const readPct = (g) => g.jiten?.readPercent || 0;
let detailTab = "overview";
const cleared = (g) => (g.routes || []).filter((r) => r.state === "good" || r.state === "bad").length;

function coverHTML(g) {
  if (g.cover) return `<img class="cover" src="${esc(g.cover)}" alt="" loading="lazy">`;
  const ch = [...(g.originalTitle || g.title || "?").replace(/^Sample:\s*/, "")][0];
  return `<div class="cover placeholder cat-${esc(g.category)}"><span>${esc(ch)}</span></div>`;
}

function replaceGame(g) {
  const i = state.games.findIndex((x) => x.id === g.id);
  if (i >= 0) state.games[i] = g; else state.games.push(g);
}

async function saveGame(g) {
  const saved = await api("PUT", `/api/games/${encodeURIComponent(g.id)}`, g);
  replaceGame(saved);
  render();
  if (currentView !== "library") { // keep the open page in step with the edit, without jumping back to the top
    const y = scrollY;
    await VIEWS[currentView].render($("#viewHost"));
    scrollTo(0, y);
  }
  return saved;
}

async function launchGame(id) {
  try {
    const g = await api("POST", `/api/launch/${encodeURIComponent(id)}`);
    replaceGame(g);
    toast(`Starting ${g.title}…`);
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------- filters & grid ----------

function renderFilters() {
  const groups = [["category", "Category"], ["format", "Owned as"], ["status", "Status"]];
  $("#filters").innerHTML = groups.map(([key, label]) => {
    const chips = [["", "All", state.games.length],
      ...Object.entries(LABELS[key]).map(([v, l]) => [v, l, state.games.filter((g) => g[key] === v).length])];
    return `<div class="filter-group"><b>${label}</b>${chips.map(([v, l, n]) =>
      `<button class="chip" data-filter="${key}" data-value="${v}" aria-pressed="${state.filter[key] === v}">${l}<span class="n">${n}</span></button>`
    ).join("")}</div>`;
  }).join("");
}

function visibleGames() {
  const { q, category, format, status } = state.filter;
  const needle = q.trim().toLowerCase();
  const list = state.games.filter((g) =>
    (!category || g.category === category) &&
    (!format || g.format === format) &&
    (!status || g.status === status) &&
    (!needle || [g.title, g.originalTitle, g.brand, g.notes,
      ...(g.routes || []).flatMap((r) => [r.name, r.original, r.seiyuu])]
      .some((v) => (v || "").toLowerCase().includes(needle))));
  const sorters = {
    title: (a, b) => (a.title || "").localeCompare(b.title || ""),
    added: (a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""),
    played: (a, b) => (b.lastPlayed || "").localeCompare(a.lastPlayed || ""),
    released: (a, b) => (b.released || "").localeCompare(a.released || ""),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  };
  return list.sort(sorters[state.sort]);
}

function cardHTML(g) {
  const routes = g.routes || [];
  const segs = routes.map((r) => `<i class="${r.state === "progress" ? "progress-s" : esc(r.state)}"></i>`).join("");
  const meta = [g.brand, year(g.released), LABELS.platform[g.platform]].filter(Boolean).map(esc).join(" · ");
  return `
    <article class="card" tabindex="0" data-open="${esc(g.id)}">
      <div class="cover-wrap">
        ${coverHTML(g)}
        <span class="badge cat-${esc(g.category)}">${esc(LABELS.category[g.category] || "")}</span>
        <span class="fmt">${esc(LABELS.format[g.format] || "")}</span>
        ${canLaunch(g) ? `<button class="play" data-play="${esc(g.id)}" title="Launch" aria-label="Launch ${esc(g.title)}">▶</button>` : ""}
      </div>
      <div class="card-body">
        <h3>${esc(g.title)}${diffPill(g)}</h3>
        ${g.originalTitle ? `<p class="jp">${esc(g.originalTitle)}</p>` : ""}
        <p class="meta">${meta}</p>
        ${routes.length ? `<div class="progress" title="${cleared(g)}/${routes.length} routes cleared">${segs}</div>` : ""}
        <div class="status-line">
          <span class="pill ${esc(g.status)}">${esc(LABELS.status[g.status] || "")}</span>
          ${routes.length ? `<small>${cleared(g)}/${routes.length} routes</small>` : ""}
        </div>
      </div>
    </article>`;
}

function render() {
  renderFilters();
  const list = visibleGames();
  $("#grid").innerHTML = list.map(cardHTML).join("");
  $("#empty").hidden = list.length > 0;
  const routesTotal = state.games.reduce((n, g) => n + (g.routes || []).length, 0);
  const routesDone = state.games.reduce((n, g) => n + cleared(g), 0);
  $("#summary").textContent =
    `Showing ${list.length} of ${state.games.length} games · ${routesDone}/${routesTotal} routes cleared`;
}

// ---------- detail dialog ----------

function openDetail(id) {
  const g = state.games.find((x) => x.id === id);
  if (!g) return;
  const dlg = $("#detailDialog");
  const tags = [LABELS.category[g.category], LABELS.platform[g.platform], LABELS.format[g.format],
    g.language, g.brand, g.released].filter(Boolean);
  const stars = [1, 2, 3, 4, 5].map((n) =>
    `<button data-rate="${n}" class="${n <= (g.rating || 0) ? "on" : ""}" aria-label="${n} stars">★</button>`).join("");
  const routes = (g.routes || []).map((r, i) => `
    <div class="route">
      <div class="who"><b>${esc(r.name)}</b>${r.original ? `<span>${esc(r.original)}</span>` : ""}
        ${r.seiyuu ? `<small>CV: ${esc(r.seiyuu)}</small>` : ""}</div>
      <div class="seg">${Object.entries(LABELS.route).map(([s, l]) =>
        `<button class="${s}" data-route="${i}" data-state="${s}" aria-pressed="${(r.state || "none") === s}">${l}</button>`).join("")}</div>
    </div>`).join("");

  dlg.innerHTML = `
    <header class="sheet-head"><span></span><button class="icon" data-close aria-label="Close">✕</button></header>
    <div class="detail">
      <div><div class="cover-wrap">${coverHTML(g)}</div></div>
      <div>
        <h2>${esc(g.title)}</h2>
        ${g.originalTitle ? `<p class="jp">${esc(g.originalTitle)}</p>` : ""}
        <div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="detail-controls">
          <select id="detailStatus" aria-label="Status">${Object.entries(LABELS.status).map(([v, l]) =>
            `<option value="${v}" ${g.status === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          <span class="stars">${stars}</span>
        </div>
        <div class="tabs">${[["overview", "Overview"], ["log", "Log"], ["study", "Study"]].map(([k, l]) =>
          `<button data-tab="${k}" aria-pressed="${detailTab === k}">${l}</button>`).join("")}</div>
        ${detailTab === "study" ? `<div id="studyPane">${studyHTML(g)}</div>` : detailTab === "log" ? logHTML(g) : `
        ${g.notes ? `<div class="notes">${esc(g.notes)}</div>` : ""}
        ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
        <section class="routes">
          <h3>Routes ${g.routes?.length ? `<small>${cleared(g)}/${g.routes.length} cleared</small>` : ""}</h3>
          ${routes || `<p class="muted">No routes yet. Add love interests from Edit.</p>`}
        </section>`}
      </div>
    </div>
    <footer class="detail-actions">
      <button class="ghost danger spacer" data-delete>Delete</button>
      ${g.vndbId ? `<button class="ghost" data-href="https://vndb.org/${esc(g.vndbId)}">VNDB ↗</button>` : ""}
      ${g.itchUrl ? `<button class="ghost" data-href="${esc(g.itchUrl)}">itch.io ↗</button>` : ""}
      <button data-edit>Edit</button>
      ${canLaunch(g) ? `<button class="primary" data-play="${esc(g.id)}">▶ Launch</button>`
        : g.format === "physical" ? `<span class="physical-note">Physical copy · no launch</span>`
        : `<span class="physical-note">No game file linked yet · add it in Edit</span>`}
    </footer>`;

  dlg.onclick = async (e) => {
    const t = e.target.closest("button");
    if (e.target === dlg) return dlg.close(); // backdrop click
    if (!t) return;
    try {
      if (t.dataset.tab) {
        detailTab = t.dataset.tab;
        openDetail(g.id);
      } else if (t.dataset.jiten) {
        await studyAction(g, t);
      } else if (t.dataset.route !== undefined) {
        g.routes[+t.dataset.route].state = t.dataset.state;
        await saveGame(g);
        openDetail(g.id);
      } else if (t.dataset.rate) {
        g.rating = +t.dataset.rate === g.rating ? 0 : +t.dataset.rate;
        await saveGame(g);
        openDetail(g.id);
      } else if (/^https:\/\//.test(t.dataset.href || "")) {
        window.open(t.dataset.href, "_blank", "noopener");
      } else if (t.hasAttribute("data-edit")) {
        dlg.close();
        openEdit(g);
      } else if (t.hasAttribute("data-delete")) {
        if (!confirm(`Remove "${g.title}" from the library? (Game files are not touched.)`)) return;
        await api("DELETE", `/api/games/${encodeURIComponent(g.id)}`);
        state.games = state.games.filter((x) => x.id !== g.id);
        dlg.close();
        render();
        toast("Removed from library");
      }
    } catch (err) {
      toast(err.message, "error");
    }
  };
  $("#detailStatus", dlg).onchange = async (e) => {
    g.status = e.target.value;
    await saveGame(g).catch((err) => toast(err.message, "error"));
  };
  const range = $("#readPct", dlg);
  if (range) {
    range.oninput = () => { $("#readOut", dlg).textContent = readoutText(g, +range.value); };
    range.onchange = async () => {
      g.jiten.readPercent = +range.value;
      await saveGame(g).catch((err) => toast(err.message, "error"));
    };
  }
  bindLog(g, dlg);
  if (!dlg.open) dlg.showModal();
  if (detailTab === "study") loadStudy(g);
}

// ---------- playthrough log (dates, hours, notes, flavour) ----------

const FLAVOURS = [["spice", "🌶️ Spice"], ["fluff", "💗 Fluff"], ["angst", "💧 Angst"], ["comedy", "🍿 Comedy"]];

function logHTML(g) {
  const fl = g.flavour || {};
  return `
    <section class="log" id="logPane">
      <div class="log-grid">
        <label>Started <input type="date" data-log="startedOn" value="${esc(g.startedOn || "")}"></label>
        <label>Finished <input type="date" data-log="finishedOn" value="${esc(g.finishedOn || "")}"></label>
        <label>Hours played <input type="number" min="0" step="0.5" data-log="playHours" value="${esc(g.playHours ?? "")}"
          placeholder="${g.lengthMinutes ? "~" + Math.round(g.lengthMinutes / 60) + "h on VNDB" : ""}"></label>
      </div>
      <label>The good <textarea rows="3" data-log="good" placeholder="What worked for you">${esc(g.good || "")}</textarea></label>
      <label>The bad <textarea rows="3" data-log="bad" placeholder="What didn't">${esc(g.bad || "")}</textarea></label>
      <div class="flavours">${FLAVOURS.map(([k, l]) => `
        <label>${l} <input type="range" min="0" max="5" step="1" data-flavour="${k}" value="${+fl[k] || 0}">
          <output>${+fl[k] || 0}</output></label>`).join("")}</div>
    </section>`;
}

function bindLog(g, dlg) {
  const pane = $("#logPane", dlg);
  if (!pane) return;
  const save = async () => { await saveGame(g).catch((err) => toast(err.message, "error")); };
  $$("[data-log]", pane).forEach((el) => el.addEventListener("change", () => {
    const k = el.dataset.log;
    g[k] = k === "playHours" ? (el.value === "" ? null : Math.max(0, +el.value)) : el.value;
    save();
  }));
  $$("[data-flavour]", pane).forEach((el) => {
    el.addEventListener("input", () => { el.nextElementSibling.textContent = el.value; });
    el.addEventListener("change", () => { g.flavour = { ...(g.flavour || {}), [el.dataset.flavour]: +el.value }; save(); });
  });
}

// ---------- page: Diary ----------

const diaryUI = { q: "", status: "" };
const inDiary = (g) => g.shelf === "diary" || ["playing", "completed", "dropped"].includes(g.status);
const diaryDate = (g) => g.startedOn || g.finishedOn || (g.addedAt || "").slice(0, 10);

function diaryEntries() {
  const needle = diaryUI.q.trim().toLowerCase();
  return state.games
    .filter((g) => inDiary(g) && (!diaryUI.status || g.status === diaryUI.status) &&
      (!needle || [g.title, g.originalTitle, g.brand].some((s) => (s || "").toLowerCase().includes(needle))))
    .sort((a, b) => diaryDate(b).localeCompare(diaryDate(a)));
}

function diaryRowHTML(g) {
  const dates = g.startedOn || g.finishedOn ? `${esc(g.startedOn || "?")} → ${esc(g.finishedOn || "…")}` : "no dates yet";
  const hours = g.playHours != null && g.playHours !== "" ? `${g.playHours}h` : g.lengthMinutes ? `~${Math.round(g.lengthMinutes / 60)}h (VNDB)` : "";
  const fl = FLAVOURS.filter(([k]) => g.flavour && g.flavour[k]).map(([k, l]) => `${l.split(" ")[0]}${g.flavour[k]}`).join(" ");
  const note = g.good || g.bad;
  return `
    <article class="diary-row" tabindex="0" data-diary="${esc(g.id)}">
      <div class="mini-cover">${coverHTML(g)}</div>
      <div class="diary-main">
        <h3>${esc(g.title)}</h3>
        ${g.originalTitle ? `<p class="jp">${esc(g.originalTitle)}</p>` : ""}
        <p class="meta">${dates}${hours ? ` · ${esc(hours)}` : ""}${(g.routes || []).length ? ` · ${cleared(g)}/${g.routes.length} routes` : ""}${fl ? ` · ${fl}` : ""}</p>
        ${note ? `<p class="diary-note">${esc(note.length > 140 ? note.slice(0, 140) + "…" : note)}</p>` : ""}
      </div>
      <div class="diary-side"><span class="pill ${esc(g.status)}">${esc(LABELS.status[g.status] || "")}</span>
        <span class="stars-ro">${g.rating ? "★".repeat(g.rating) : "—"}</span></div>
    </article>`;
}

function renderDiary(host) {
  const list = diaryEntries();
  host.querySelector("#diaryList").innerHTML = list.length ? list.map(diaryRowHTML).join("")
    : `<p class="empty">Nothing in the diary yet. Games you set to Playing, Completed or Dropped (or that come from your VNDB list as Playing / Finished) show up here.</p>`;
  host.querySelector("#diaryCount").textContent = `${list.length} entries`;
  host.querySelectorAll("[data-dstatus]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dstatus === diaryUI.status)));
}

VIEWS.diary = {
  render(host) {
    host.innerHTML = `
      <h2 class="page-h">Diary</h2>
      <div class="filters page-filters">
        <div class="filter-group"><b>Status</b>
          <button class="chip" data-dstatus="" aria-pressed="true">All</button>
          ${["playing", "completed", "dropped"].map((k) => `<button class="chip" data-dstatus="${k}" aria-pressed="false">${LABELS.status[k]}</button>`).join("")}
        </div>
        <input id="diarySearch" type="search" placeholder="Search the diary…" value="${esc(diaryUI.q)}">
        <small id="diaryCount"></small>
      </div>
      <div id="diaryList" class="diary-list"></div>`;
    host.querySelector("#diarySearch").oninput = (e) => { diaryUI.q = e.target.value; renderDiary(host); };
    host.querySelectorAll("[data-dstatus]").forEach((b) => b.onclick = () => { diaryUI.status = b.dataset.dstatus; renderDiary(host); });
    const open = (el) => { const row = el.closest("[data-diary]"); if (row) { detailTab = "log"; openDetail(row.dataset.diary); } };
    host.querySelector("#diaryList").onclick = (e) => open(e.target);
    host.querySelector("#diaryList").onkeydown = (e) => { if (e.key === "Enter") open(e.target); };
    renderDiary(host);
  },
};

// ---------- Jiten study ----------

const JITEN_CONF = { link: "exact VNDB link", title: "same title", possible: "possible match" };
const jitenUrl = (id, page = "detail") => `https://jiten.moe/decks/media/${id}/${page}`;
const needsMatch = (g) => !g.jiten?.deckId && !g.jitenChecked && (g.originalTitle || g.vndbId);
const readoutText = (g, pct) => {
  const j = g.jiten;
  const left = Math.max(0, hoursOf(g) * (1 - pct / 100));
  return `${pct}% read · ${fmt(Math.round(j.characterCount * pct / 100))} of ${fmt(j.characterCount)} characters · ${pct >= 100 ? "finished" : `about ${hoursText(left)} h left`}`;
};

function deckNames(j) {
  return [j.title, j.romaji && j.romaji !== j.title ? j.romaji : "", j.english].filter(Boolean).map(esc).join(" · ");
}

function studyHTML(g) {
  const j = g.jiten;
  if (!j?.deckId) {
    return `<div class="study-empty">
      <p class="muted">This game isn't linked to <b>Jiten</b> yet. Jiten shows how hard a Japanese game is to read and which words it uses.</p>
      <div id="jitenResult"><p class="muted">Looking on Jiten…</p></div>
      <div class="paste"><input id="jitenPaste" placeholder="Or paste a jiten.moe link"><button data-jiten="paste">Use link</button></div>
    </div>`;
  }
  const stat = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
  return `
    <div class="jiten-name"><small>Matched on Jiten · ${deckNames(j)}</small></div>
    <div class="stats">
      ${stat("Difficulty", `${esc(DIFF_NAMES[j.difficulty] ?? "?")} ${(+j.difficultyRaw).toFixed(1)}`)}
      ${stat("Characters", fmt(j.characterCount))}
      ${stat("Unique words", fmt(j.uniqueWordCount))}
      ${stat("Unique kanji", fmt(j.uniqueKanjiCount))}
      ${stat("Dialogue", `${j.dialoguePercentage}%`)}
      ${stat("Reading time", `~${hoursText(hoursOf(g))} h`)}
      ${j.coverage != null ? stat("You know", `${j.coverage}% of the text`) + stat("Unique words known", `${j.uniqueCoverage}%`) : ""}
    </div>
    ${j.coverage == null ? `<p class="muted cov-hint">${state.settings.jitenKeySet ? "Press Refresh to load how much of this you know." : "Add your Jiten API key in Settings to see how much of this you already know."}</p>` : ""}
    <div class="read-box">
      <label for="readPct">Your progress</label>
      <input id="readPct" type="range" min="0" max="100" step="1" value="${readPct(g)}">
      <small id="readOut">${readoutText(g, readPct(g))}</small>
    </div>
    <h4>Most frequent words</h4>
    <div id="jitenVocab" class="vocab"><small class="muted">Loading…</small></div>
    <h4>Words to learn first</h4>
    ${state.settings.jitenKeySet ? `
    <div class="learn-tools">
      <select id="learnCount" aria-label="How many words">${[25, 50, 100, 200].map((n) => `<option ${n === 50 ? "selected" : ""}>${n}</option>`).join("")}</select>
      <label class="inline"><input type="checkbox" id="learnNames" checked> Hide names</label>
      <button data-jiten="learn">Show words I don't know</button>
    </div>
    <div id="learnOut"></div>` : `<p class="muted cov-hint">Add your Jiten API key in Settings to list the most common words in this game that you don't know yet.</p>`}
    <div class="study-actions">
      <button data-jiten="popup" data-page="detail">Open on Jiten ↗</button>
      <button data-jiten="popup" data-page="vocabulary?sortBy=deckFreq">Full word list ↗</button>
      <button class="ghost" data-jiten="refresh" title="Re-fetch stats and your known-word coverage">Refresh</button>
      <button class="ghost danger" data-jiten="unlink">Unlink</button>
    </div>`;
}

function candidateRow(c) {
  return `<div class="cand"><div><b>${esc(c.title || c.romaji)}</b><small>${esc([c.romaji, c.english].filter((x) => x && x !== c.title).join(" · "))}</small></div>
    <span class="diff d${+c.difficulty || 0}">${esc(DIFF_NAMES[c.difficulty] ?? "?")} ${(+c.difficultyRaw).toFixed(1)}</span>
    <button data-jiten="use" data-deck="${c.deckId}">Use</button>
    <button class="ghost" data-jiten="popup" data-deck="${c.deckId}" data-page="detail">View ↗</button></div>`;
}

async function linkDeck(g, deck) {
  const keep = g.jiten?.deckId === deck.deckId ? g.jiten.readPercent : 0;
  const old = g.jiten?.deckId === deck.deckId ? g.jiten : {};
  g.jiten = { coverage: old.coverage, uniqueCoverage: old.uniqueCoverage, coverageAt: old.coverageAt, ...deck, readPercent: keep || 0 };
  if (g.jiten.coverage == null) { delete g.jiten.coverage; delete g.jiten.uniqueCoverage; delete g.jiten.coverageAt; }
  delete g.jitenChecked;
  await saveGame(g);
}

function findOnJiten(g) {
  const q = new URLSearchParams({ vndb: g.vndbId || "", title: g.originalTitle || "", alt: g.title || "" });
  return api("GET", `/api/jiten/match?${q}`);
}

async function loadStudy(g) {
  if (!$("#studyPane")) return;
  try {
    if (g.jiten?.deckId) {
      const words = await api("GET", `/api/jiten/vocab/${g.jiten.deckId}`);
      const box = $("#jitenVocab");
      if (box) box.innerHTML = words.slice(0, 14).map((w) =>
        `<span class="chip-word" title="${esc(w.meaning)} · frequency rank ${fmt(w.rank)}">${esc(w.word)} <small>×${fmt(w.count)}</small></span>`).join("")
        || `<small class="muted">No word data yet.</small>`;
      return;
    }
    const res = await findOnJiten(g);
    if (detailTab !== "study" || !$("#jitenResult")) return;
    if (res.deck) {
      await linkDeck(g, res.deck);
      toast(`Linked to Jiten (${JITEN_CONF[res.confidence]})`);
      return openDetail(g.id);
    }
    $("#jitenResult").innerHTML = res.candidates.length
      ? `<p class="muted">No exact match. Is it one of these?</p>${res.candidates.map(candidateRow).join("")}`
      : `<p class="muted">Nothing found on Jiten for this title. It may not be listed, or have no Japanese text.</p>`;
  } catch (e) {
    const box = $("#jitenResult") || $("#jitenVocab");
    if (box) box.innerHTML = `<small class="error">${esc(e.message)}</small>`;
  }
}

let learned = null; // last "words to learn" list, for copy / download

function learnTSV(list) {
  return list.map((w) => [w.word, [w.reading !== w.word ? w.reading : "", w.meaning].filter(Boolean).join(" — ")].join("\t")).join("\n");
}

const LAPIS_COLUMNS = ["Expression", "ExpressionFurigana", "ExpressionReading", "ExpressionAudio", "SelectionText",
  "MainDefinition", "DefinitionPicture", "Sentence", "SentenceFurigana", "SentenceAudio", "Picture", "Glossary", "Hint",
  "IsWordAndSentenceCard", "IsClickCard", "IsSentenceCard", "IsAudioCard", "PitchPosition", "PitchCategories",
  "Frequency", "FreqSort", "MiscInfo"];

// Pitch category from the downstep position and the number of morae in the reading
function pitchCategory(pos, reading) {
  const morae = [...reading].filter((c, i, a) => i === 0 || !"ゃゅょゎぁぃぅぇぉャュョヮァィゥェォ".includes(c)).length;
  return pos === 0 ? "heiban" : pos === 1 ? "atamadaka" : pos === morae ? "odaka" : "nakadaka";
}

function tsvField(v) {
  const s = String(v ?? "").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
  return s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

// Anki text import in the user's Lapis layout. Sentence, audio and pictures stay empty: Yomitan fills those when mining.
function lapisFile(g, words) {
  const cfg = state.settings.ankiExport || {};
  const tags = [...String(cfg.tags || "yomitan").split(/\s+/), (g.title || "game").replace(/\s+/g, "_")].filter(Boolean).join(" ");
  const rows = words.map((w) => {
    const first = w.senses[0];
    const main = first ? first.meanings.slice(0, 3).join("; ") : w.meaning;
    const gloss = w.senses.length
      ? `<ol>${w.senses.map((s) => `<li>${s.pos.length ? `<i>${esc(s.pos.join(", "))}</i> ` : ""}${esc(s.meanings.join("; "))}</li>`).join("")}</ol>`
      : "";
    const pitch = w.pitch.length ? w.pitch[0] : "";
    const cats = w.pitch.length ? [...new Set(w.pitch.map((p) => pitchCategory(p, w.reading)))].join(", ") : "";
    const f = { Expression: w.word, ExpressionFurigana: w.furigana, ExpressionReading: w.reading, MainDefinition: esc(main),
      Glossary: gloss, Hint: [w.furigana, first?.pos[0]].filter(Boolean).join(" "), PitchPosition: pitch,
      PitchCategories: cats, Frequency: w.rank ?? "", FreqSort: w.rank ?? "" };
    return [...LAPIS_COLUMNS.map((c) => tsvField(f[c] ?? "")), tsvField(tags)].join("\t");
  });
  return ["#separator:tab", "#html:true", `#notetype:${cfg.noteType || "Lapis"}`, `#deck:${cfg.deck || "MiningGroups::MINING"}`,
    `#columns:${[...LAPIS_COLUMNS, "Tags"].join("\t")}`, `#tags column:${LAPIS_COLUMNS.length + 1}`, ...rows].join("\n");
}

function renderLearn(g, res) {
  learned = { id: g.id, words: res.words };
  const j = g.jiten;
  let cum = 0;
  const rows = res.words.map((w, i) => {
    cum += w.count;
    return `<tr><td class="lw">${esc(w.word)}</td><td>${w.reading !== w.word ? esc(w.reading) : ""}</td><td>${esc(w.meaning)}</td>
      <td class="num">×${fmt(w.count)}</td><td class="num">+${(cum / j.wordCount * 100).toFixed(1)}%</td></tr>`;
  }).join("");
  const gain = cum / j.wordCount * 100;
  $("#learnOut").innerHTML = res.words.length ? `
    <p class="learn-sum">Learn these ${res.words.length} and you'd go from <b>${j.coverage ?? "?"}%</b> to about
      <b>${j.coverage != null ? Math.min(100, j.coverage + gain).toFixed(1) : "?"}%</b> known.
      <small>(${fmt(res.unknownTotal)} words in this game are still unknown to you)</small></p>
    <div class="learn-scroll"><table class="learn"><tbody>${rows}</tbody></table></div>
    <div class="study-actions">
      <button class="ghost" data-jiten="copy">Copy list</button>
      <button class="ghost" data-jiten="tsv" title="Tab-separated Anki import in your Lapis layout">Download for Anki (Lapis)</button>
    </div>` : `<p class="muted">Nothing to show. You may already know everything frequent here.</p>`;
}

async function studyAction(g, t) {
  const act = t.dataset.jiten;
  if (act === "learn") {
    const out = $("#learnOut");
    out.innerHTML = `<p class="muted">Loading from Jiten…</p>`;
    const q = new URLSearchParams({ count: $("#learnCount").value, names: $("#learnNames").checked ? "hide" : "show" });
    return renderLearn(g, await api("GET", `/api/jiten/learn/${g.jiten.deckId}?${q}`));
  }
  if (act === "copy" && learned?.id === g.id) {
    try { await navigator.clipboard.writeText(learnTSV(learned.words)); toast("List copied"); }
    catch (e) { toast("Couldn't copy. Use the download instead.", "error"); }
    return;
  }
  if (act === "tsv" && learned?.id === g.id) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lapisFile(g, learned.words)], { type: "text/plain;charset=utf-8" }));
    a.download = `anki-lapis-${(g.title || "game").replace(/[^\w-]+/g, "_")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  if (act === "popup") {
    const id = +(t.dataset.deck || g.jiten?.deckId);
    window.open(jitenUrl(id, t.dataset.page || "detail"), "jiten", "popup=yes,width=560,height=900");
  } else if (act === "use") {
    await linkDeck(g, await api("GET", `/api/jiten/deck/${+t.dataset.deck}`));
    openDetail(g.id);
  } else if (act === "paste") {
    const m = /jiten\.moe\/decks\/media\/(\d+)/.exec($("#jitenPaste").value);
    if (!m) return toast("Paste a link like jiten.moe/decks/media/130461/detail", "error");
    await linkDeck(g, await api("GET", `/api/jiten/deck/${m[1]}`));
    openDetail(g.id);
  } else if (act === "refresh") {
    await linkDeck(g, await api("GET", `/api/jiten/deck/${g.jiten.deckId}`));
    toast("Updated from Jiten");
    openDetail(g.id);
  } else if (act === "unlink") {
    if (!confirm("Unlink this game from Jiten? Your progress on it will be cleared.")) return;
    delete g.jiten;
    g.jitenChecked = new Date().toISOString();
    await saveGame(g);
    openDetail(g.id);
  }
}

// ---------- study dashboard ----------

const study = { sort: "difficulty", show: "unfinished", run: 0, busy: false, pickMode: "easy", pickLen: "any" };

// Rule of thumb: ~90%+ of the text known reads comfortably, 80-90% is a stretch, below that is a slog.
function fitBand(g) {
  const c = g.jiten.coverage;
  if (c != null) return c >= 90 ? ["easy", "Comfortable"] : c >= 80 ? ["mid", "A stretch"] : ["hard", "Challenging"];
  const d = g.jiten.difficulty;
  return d <= 1 ? ["easy", "Comfortable"] : d === 2 ? ["mid", "A stretch"] : ["hard", "Challenging"];
}

function pickList(linked) {
  const open = linked.filter((g) => readPct(g) < 100 && g.status !== "completed" && g.status !== "dropped");
  const resuming = open.filter((g) => readPct(g) > 0 || g.status === "playing");
  const lenOk = (g) => {
    const h = hoursOf(g);
    return study.pickLen === "any" || (study.pickLen === "short" ? h < 20 : study.pickLen === "medium" ? h >= 20 && h < 50 : h >= 50);
  };
  const score = (g) => {
    const c = g.jiten.coverage ?? (100 - g.jiten.difficultyRaw * 12);
    return study.pickMode === "easy" ? -c : Math.abs(c - 85);
  };
  const fresh = open.filter((g) => !resuming.includes(g) && lenOk(g)).sort((a, b) => score(a) - score(b)).slice(0, 3);
  return { resuming, fresh };
}

function pickCard(g) {
  const [cls, label] = fitBand(g);
  const known = g.jiten.coverage != null ? `${Math.round(g.jiten.coverage)}% known` : "known % not loaded";
  return `<div class="pick" data-study-open="${esc(g.id)}" tabindex="0">
    <div class="thumb-wrap">${coverHTML(g)}</div>
    <div class="study-main"><b>${esc(g.title)}</b>
      <small><span class="fit ${cls}">${label}</span> · ${known} · ~${hoursText(hoursOf(g))} h${readPct(g) ? ` · ${readPct(g)}% read` : ""}</small></div>
    ${diffPill(g)}</div>`;
}

function studyRows() {
  const rows = state.games.filter((g) => g.jiten?.deckId)
    .filter((g) => study.show === "all" || (study.show === "unfinished" ? readPct(g) < 100 : readPct(g) === 0));
  const by = {
    difficulty: (a, b) => a.jiten.difficultyRaw - b.jiten.difficultyRaw,
    hardest: (a, b) => b.jiten.difficultyRaw - a.jiten.difficultyRaw,
    length: (a, b) => hoursOf(a) - hoursOf(b),
    progress: (a, b) => readPct(b) - readPct(a),
    coverage: (a, b) => (b.jiten.coverage ?? -1) - (a.jiten.coverage ?? -1),
  };
  return rows.sort(by[study.sort]);
}

function renderStudy() {
  const linked = state.games.filter((g) => g.jiten?.deckId);
  const pending = state.games.filter(needsMatch).length;
  const charsRead = linked.reduce((n, g) => n + g.jiten.characterCount * readPct(g) / 100, 0);
  const hoursLeft = linked.reduce((n, g) => n + hoursOf(g) * (1 - readPct(g) / 100), 0);
  const picks = pickList(linked);
  const tile = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
  const withCov = linked.filter((g) => g.jiten.coverage != null);
  const avgCov = withCov.length ? Math.round(withCov.reduce((n, g) => n + g.jiten.coverage, 0) / withCov.length) : null;
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("");
  const rows = studyRows();
  $("#studyBody").innerHTML = `
    <div class="stats">
      ${tile("Linked to Jiten", `${linked.length} / ${state.games.length}`)}
      ${tile("Characters read", fmt(Math.round(charsRead)))}
      ${tile("Reading time left", `~${fmt(Math.round(hoursLeft))} h`)}
      ${avgCov != null ? tile("Average known", `${avgCov}%`) : ""}
    </div>
    ${linked.length ? `<section class="picker">
      <div class="picker-head"><h3>What to read next</h3>
        <label>Mood <select id="pickMode">${opts([["easy", "Easy read"], ["challenge", "Challenge me"]], study.pickMode)}</select></label>
        <label>Length <select id="pickLen">${opts([["any", "Any"], ["short", "Under 20 h"], ["medium", "20–50 h"], ["long", "50 h+"]], study.pickLen)}</select></label></div>
      ${picks.resuming.length ? `<h4>Keep going</h4>${picks.resuming.map(pickCard).join("")}` : ""}
      <h4>${study.pickMode === "easy" ? "Most comfortable" : "Best stretch (around 85% known)"}</h4>
      ${picks.fresh.map(pickCard).join("") || `<p class="muted">${study.pickLen === "any" ? "Nothing left to suggest. Everything linked is finished, dropped or already in progress." : "Nothing unread fits that length. Try another."}</p>`}
      <small class="muted">${linked.some((g) => g.jiten.coverage != null) ? "Rule of thumb: 90%+ known reads comfortably, 80–90% is a stretch, below 80% is a slog." : "Add a Jiten key in Settings for personal known-word fit. For now this uses Jiten's difficulty."}</small>
    </section>` : ""}
    <div class="study-tools">
      <button id="matchAllBtn" ${study.busy ? "disabled" : ""}>${study.busy ? "Matching…" : `Match ${pending} unlinked game${pending === 1 ? "" : "s"}`}</button>
      ${state.settings.jitenKeySet && linked.length ? `<button id="covAllBtn" ${study.busy ? "disabled" : ""}>Update known %</button>` : ""}
      <span id="matchAllNote" class="muted"></span>
      <label>Show <select id="studyShow">${opts([["unfinished", "Unfinished"], ["unstarted", "Not started"], ["all", "All"]], study.show)}</select></label>
      <label>Sort <select id="studySort">${opts([["difficulty", "Easiest first"], ["hardest", "Hardest first"], ["length", "Shortest first"], ["progress", "Most progress"], ["coverage", "Most known"]], study.sort)}</select></label>
    </div>
    <div class="study-list">${rows.map((g) => `
      <div class="study-row" data-study-open="${esc(g.id)}" tabindex="0">
        <div class="thumb-wrap">${coverHTML(g)}</div>
        <div class="study-main"><b>${esc(g.title)}</b>${g.originalTitle ? `<small>${esc(g.originalTitle)}</small>` : ""}
          <div class="bar" title="${readPct(g)}% read"><i style="width:${readPct(g)}%"></i></div></div>
        ${diffPill(g)}
        <small class="hrs">~${hoursText(hoursOf(g))} h<br>${readPct(g)}% read</small>
      </div>`).join("") || `<p class="muted empty-note">${linked.length ? "No games match this filter." : "Nothing linked yet. Use the match button above, or open a game's Study tab."}</p>`}
    </div>`;
}

async function matchAll() {
  const todo = state.games.filter(needsMatch);
  if (!todo.length) return toast("Nothing left to match");
  const run = ++study.run;
  study.busy = true;
  renderStudy();
  let linked = 0, review = 0, i = 0;
  for (const g of todo) {
    if (run !== study.run) break;
    const note = $("#matchAllNote");
    if (note) note.textContent = `${++i} / ${todo.length}…`;
    try {
      const res = await findOnJiten(g);
      if (res.deck) { await linkDeck(g, res.deck); linked++; }
      else { g.jitenChecked = new Date().toISOString(); if (res.candidates.length) review++; await saveGame(g); }
    } catch (e) {
      toast(`${g.title}: ${e.message}`, "error");
    }
    await wait(300);
  }
  if (run === study.run) {
    study.busy = false;
    renderStudy();
    toast(`Linked ${linked}${review ? ` · ${review} need a look (open their Study tab)` : ""}`);
  }
}

async function updateCoverage() {
  const todo = state.games.filter((g) => g.jiten?.deckId);
  const run = ++study.run;
  study.busy = true;
  renderStudy();
  let i = 0;
  for (const g of todo) {
    if (run !== study.run) break;
    const note = $("#matchAllNote");
    if (note) note.textContent = `${++i} / ${todo.length}…`;
    try {
      await linkDeck(g, await api("GET", `/api/jiten/deck/${g.jiten.deckId}`));
    } catch (e) {
      toast(e.message, "error");
      break;
    }
    await wait(250);
  }
  if (run === study.run) {
    study.busy = false;
    renderStudy();
    toast("Known % updated");
  }
}

function openStudy() {
  renderStudy();
  const dlg = $("#studyDialog");
  if (!dlg.open) dlg.showModal();
}

$("#studyBtn").onclick = openStudy;
$("#studyDialog").addEventListener("close", () => { study.run++; study.busy = false; });
$("#studyDialog").addEventListener("click", (e) => {
  if (e.target.closest("#matchAllBtn")) return matchAll();
  if (e.target.closest("#covAllBtn")) return updateCoverage();
  const row = e.target.closest("[data-study-open]");
  if (row) {
    e.preventDefault();
    $("#studyDialog").close();
    detailTab = "study";
    openDetail(row.dataset.studyOpen);
  }
});
$("#studyDialog").addEventListener("change", (e) => {
  if (e.target.id === "pickMode") study.pickMode = e.target.value;
  else if (e.target.id === "pickLen") study.pickLen = e.target.value;
  else if (e.target.id === "studyShow") study.show = e.target.value;
  else if (e.target.id === "studySort") study.sort = e.target.value;
  else return;
  renderStudy();
});

// ---------- add / edit dialog ----------

const form = $("#editForm");

const routeRowHTML = (r = {}) => `
  <div class="route-row" data-state="${esc(r.state || "none")}">
    <input data-k="name" placeholder="Name" value="${esc(r.name)}">
    <input data-k="original" placeholder="日本語" value="${esc(r.original)}">
    <input data-k="seiyuu" placeholder="Seiyuu" value="${esc(r.seiyuu)}">
    <button type="button" class="icon" data-remove-route aria-label="Remove">✕</button>
  </div>`;

function renderRoutesEdit(routes) {
  $("#routesEdit").innerHTML = routes.map(routeRowHTML).join("") ||
    `<p class="muted">None yet. VNDB fills these in, or add them by hand.</p>`;
}

function readRoutesEdit() {
  return $$(".route-row", form).map((row) => ({
    name: $('[data-k="name"]', row).value.trim(),
    original: $('[data-k="original"]', row).value.trim(),
    seiyuu: $('[data-k="seiyuu"]', row).value.trim(),
    state: row.dataset.state || "none",
  })).filter((r) => r.name);
}

function syncFormatFields() {
  const fmt = form.elements.format.value;
  $$("[data-for-format]", form).forEach((el) => { el.hidden = el.dataset.forFormat !== fmt; });
}

function fillForm(g) {
  for (const name of ["title", "originalTitle", "category", "platform", "brand", "released", "exePath",
    "emulator", "romPath", "language", "status", "cover", "notes", "description"]) {
    if (form.elements[name]) form.elements[name].value = g[name] ?? "";
  }
  form.elements.format.value = g.format || "pc";
  if (!form.elements.category.value) form.elements.category.value = "otome";
  if (!form.elements.platform.value) form.elements.platform.value = "pc";
  if (!form.elements.status.value) form.elements.status.value = "unplayed";
  if (!form.elements.emulator.value) form.elements.emulator.selectedIndex = 0;
  renderRoutesEdit(g.routes || []);
  syncFormatFields();
}

function openEdit(g) {
  state.editing = g || null;
  $("#editTitle").textContent = g ? "Edit game" : "Add game";
  $("#emulatorSelect").innerHTML = Object.entries(state.settings.emulators)
    .map(([k, e]) => `<option value="${esc(k)}">${esc(e.name)}</option>`).join("");
  form.reset();
  form.dataset.vndbId = g?.vndbId || "";
  form.dataset.coverNsfw = "";
  form.dataset.releaseId = g?.releaseId || "";
  form.dataset.bundleWith = "";
  pendingRelease = null;
  $("#vndbResults").innerHTML = "";
  $("#vndbQuery").value = "";
  fillForm(g || {});
  $("#editDialog").showModal();
  (g ? form.elements.title : $("#vndbQuery")).focus();
}

async function vndbSearch() {
  const q = $("#vndbQuery").value.trim();
  if (!q) return;
  const box = $("#vndbResults");
  box.innerHTML = `<p class="muted">Searching VNDB…</p>`;
  try {
    const hits = await api("GET", `/api/vndb/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = hits.length ? hits.map((h) => `
      <button type="button" class="vndb-hit" data-vid="${esc(h.id)}">
        ${h.image ? `<img src="${esc(h.image)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
        <span><b>${esc(h.title)}</b>
          <small>${esc([h.alttitle, year(h.released), h.developers.join(", "), h.platforms.join("/")].filter(Boolean).join(" · "))}</small>
        </span>
      </button>`).join("") : `<p class="muted">No matches. Try the Japanese or romaji title.</p>`;
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

async function applyVndb(vid) {
  const box = $("#vndbResults");
  box.innerHTML = `<p class="muted">Loading details…</p>`;
  try {
    const d = await api("GET", `/api/vndb/vn/${encodeURIComponent(vid)}`);
    const current = readCurrentForm();
    // Keep route progress for characters already in the list
    const oldStates = Object.fromEntries((current.routes || []).map((r) => [r.name, r.state]));
    const platform = d.platforms.includes(current.platform) ? current.platform
      : (d.platforms.find((p) => LABELS.platform[p]) || current.platform);
    fillForm({
      ...current,
      title: d.title, originalTitle: d.originalTitle, released: d.released, brand: d.brand,
      cover: d.cover, description: d.description, platform,
      category: d.category || current.category,
      routes: d.routes.length
        ? d.routes.map((r) => ({ ...r, state: oldStates[r.name] || "none" }))
        : current.routes,
    });
    form.dataset.vndbId = d.vndbId;
    form.dataset.coverNsfw = d.coverNsfw ? "1" : "";
    form.dataset.releaseId = "";
    form.dataset.bundleWith = "";
    box.innerHTML = "";
    toast(`Filled from VNDB · ${d.routes.length} characters found`);
    lastVn = d;
    await offerReleases(d);
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

// ---- which release? (bundles and split volumes) ----
let pendingRelease = null; // { d, rel } while the picker is showing
let lastVn = null;         // the VN last picked in the form, so changing Platform can re-check its releases

async function offerReleases(d) {
  const box = $("#vndbResults");
  const platform = form.elements.platform.value;
  pendingRelease = null;
  try {
    const rel = await api("GET", `/api/vndb/releases?${new URLSearchParams({ vn: d.vndbId, platform, title: form.elements.title.value })}`);
    if (!rel.choose) return;
    pendingRelease = { d, rel };
    if (rel.suggested) pickRelease(rel.suggested); else showReleasePicker("");
  } catch (e) { /* the form is already filled; a failed release lookup shouldn't get in the way */ }
}

function showReleasePicker(selected) {
  const { d, rel } = pendingRelease;
  const g = rel.groups.find((x) => x.id === selected);
  const others = g && g.vns.length > 1 ? g.vns.filter((v) => v.id !== d.vndbId && v.title).map((v) => v.title) : [];
  $("#vndbResults").innerHTML = relCardsHTML(rel, d.title, selected, "addrel", "data-addrel",
    `Which ${LABELS.platform[form.elements.platform.value] || ""} release do you have?`) +
    (others.length ? `<p class="muted">Saving also adds: <b>${esc(others.join(", "))}</b> (same game file).</p>` : "");
}

function pickRelease(id) {
  const { d, rel } = pendingRelease;
  const g = rel.groups.find((x) => x.id === id);
  if (!g) return;
  form.dataset.releaseId = g.id;
  form.dataset.bundleWith = g.vns.length > 1 ? JSON.stringify(g.vns.map((v) => v.id).filter((v) => v !== d.vndbId)) : "";
  const volume = g.rtype === "partial" && g.vns.length === 1;
  form.elements.title.value = volume ? g.name : d.title;
  form.elements.originalTitle.value = (volume && g.original) || d.originalTitle || "";
  form.elements.cover.value = (volume && g.fullImage) || d.cover || "";
  showReleasePicker(id);
}

$("#vndbResults").addEventListener("change", (e) => {
  if (e.target.dataset.addrel && pendingRelease) pickRelease(e.target.value);
});
form.elements.platform.addEventListener("change", () => {
  if (lastVn && form.dataset.vndbId === lastVn.vndbId) offerReleases(lastVn);
});

function readCurrentForm() {
  const f = form.elements;
  const g = { ...(state.editing || {}) };
  for (const name of ["title", "originalTitle", "category", "platform", "brand", "released",
    "language", "status", "cover", "notes", "description"]) {
    g[name] = f[name].value.trim();
  }
  g.format = f.format.value;
  g.exePath = g.format === "pc" ? f.exePath.value.trim() : "";
  g.emulator = g.format === "emulated" ? f.emulator.value : "";
  g.romPath = g.format === "emulated" ? f.romPath.value.trim() : "";
  g.routes = readRoutesEdit();
  g.vndbId = form.dataset.vndbId || g.vndbId || "";
  if (form.dataset.releaseId) g.releaseId = form.dataset.releaseId;
  if (form.dataset.coverNsfw) g.coverNsfw = true;
  g.rating = g.rating || 0;
  delete g.sample;
  return g;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = readCurrentForm();
  if (!g.title) return toast("A title is needed", "error");
  $("#saveBtn").disabled = true;
  try {
    const bundle = form.dataset.bundleWith ? JSON.parse(form.dataset.bundleWith) : [];
    if (bundle.length) g.bundleWith = bundle;
    const saved = state.editing
      ? await api("PUT", `/api/games/${encodeURIComponent(g.id)}`, g)
      : await api("POST", "/api/games", g);
    replaceGame(saved);
    // A bundle release (base game + fandisc on one disc/cartridge): add the other games too, sharing the file
    const extra = [];
    for (const vid of bundle) {
      if (state.games.some((x) => x.vndbId === vid && x.releaseId === g.releaseId)) continue;
      const d = await api("GET", `/api/vndb/vn/${encodeURIComponent(vid)}`);
      const { id, addedAt, routes, rating, lastPlayed, jiten, ...shared } = saved;
      const more = await api("POST", "/api/games", {
        ...shared, title: d.title, originalTitle: d.originalTitle, released: d.released, brand: d.brand || saved.brand,
        cover: d.cover, description: d.description, routes: d.routes, vndbId: d.vndbId, rating: 0,
        bundleWith: [saved.vndbId, ...bundle.filter((x) => x !== vid)],
      });
      replaceGame(more);
      extra.push(more.title);
    }
    render();
    $("#editDialog").close();
    toast(state.editing ? "Saved" : `Added ${saved.title}${extra.length ? ` + ${extra.join(", ")}` : ""}`);
    openDetail(saved.id);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    $("#saveBtn").disabled = false;
  }
});

$("#vndbSearchBtn").onclick = vndbSearch;
$("#vndbQuery").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); vndbSearch(); }
});
$("#vndbResults").addEventListener("click", (e) => {
  const hit = e.target.closest("[data-vid]");
  if (hit) applyVndb(hit.dataset.vid);
});
$("#addRouteBtn").onclick = () => {
  $("#routesEdit > p")?.remove();
  $("#routesEdit").insertAdjacentHTML("beforeend", routeRowHTML());
  $$('.route-row [data-k="name"]', form).pop().focus();
};
$("#routesEdit").addEventListener("click", (e) => {
  if (e.target.closest("[data-remove-route]")) e.target.closest(".route-row").remove();
});
$$('input[name="format"]', form).forEach((r) => r.addEventListener("change", syncFormatFields));

// ---------- settings dialog ----------

const FOLDER_HINTS = {
  ppsspp: "PSP game folders to scan (ISO / CSO / CHD / EBOOT.PBP), one per line",
  vita3k: "Vita3K's installed-apps folder, e.g. %APPDATA%\\Vita3K\\Vita3K\\ux0\\app",
  switch: "Switch game folders to scan (NSP / XCI), one per line",
};

function openSettings() {
  $("#emulatorRows").innerHTML = Object.entries(state.settings.emulators).map(([k, e]) => `
    <div class="emu-row" data-emu="${esc(k)}">
      <b>${esc(e.name)}</b>
      <div class="row">
        <input data-k="path" placeholder="C:\\Emulators\\…\\emulator.exe" value="${esc(e.path)}">
        <input data-k="args" placeholder="{rom}" value="${esc(e.args)}" title="Arguments">
      </div>
      <textarea data-k="folders" rows="2" placeholder="${esc(FOLDER_HINTS[k] || "Game folders to scan, one per line")}">${esc((e.folders || []).join("\n"))}</textarea>
      ${k === "switch" ? `<label class="dlc-label">DLC / UPDATES
        <textarea data-k="dlcFolders" rows="2" placeholder="Switch DLC and update folders (NSP / XCI), one per line">${esc((e.dlcFolders || []).join("\n"))}</textarea></label>` : ""}
    </div>`).join("");
  $("#readingSpeed").value = state.settings.readingSpeed || 14000;
  $("#jitenKey").value = "";
  $("#jitenKeyClear").checked = false;
  $("#jitenKeyState").textContent = state.settings.jitenKeySet ? "A key is saved. Paste a new one to replace it." : "No key saved.";
  $("#jitenKeyClearWrap").hidden = !state.settings.jitenKeySet;
  const anki = state.settings.ankiExport || {};
  $("#ankiNote").value = anki.noteType || "";
  $("#ankiDeck").value = anki.deck || "";
  $("#ankiTags").value = anki.tags || "";
  $("#resetNote").textContent = "";
  $("#itchKey").value = "";
  $("#itchKeyClear").checked = false;
  $("#itchKeyState").textContent = state.settings.itchKeySet
    ? "A key is saved. Paste a new one to replace it." : "No key saved yet.";
  $("#itchKeyClearWrap").hidden = !state.settings.itchKeySet;
  $("#vndbToken").value = "";
  $("#vndbTokenClear").checked = false;
  $("#vndbTokenState").textContent = state.settings.vndbTokenSet
    ? `Connected${state.settings.vndbUsername ? " as " + state.settings.vndbUsername : ""}. Paste a new token to replace it.`
    : "Not connected.";
  $("#vndbTokenClearWrap").hidden = !state.settings.vndbTokenSet;
  $("#vndbSyncBtn").disabled = $("#charsStartBtn").disabled = !state.settings.vndbTokenSet;
  refreshSummary();
  $("#settingsDialog").showModal();
}

// ---------- VNDB list + characters ----------

let summaryTimer = null;

async function refreshSummary() {
  clearTimeout(summaryTimer);
  try {
    const s = await api("GET", "/api/library/summary");
    const j = s.job || {};
    $("#vndbSummary").textContent =
      `${s.games} games (${s.withVndb} on VNDB, ${s.diary} in the diary) · ${s.characters} characters · ${s.staff} voice actors · ` +
      `characters fetched for ${s.withCharacters}/${s.withVndb} games` +
      (j.running ? ` — fetching ${j.done}/${j.total}…` : j.error ? ` — stopped: ${j.error}` : j.message ? ` — ${j.message}` : "");
    $("#charsStopBtn").hidden = !j.running;
    $("#charsStartBtn").hidden = !!j.running;
    if (j.running) summaryTimer = setTimeout(refreshSummary, 3000);
    else if (j.message === "Done") { state.games = await api("GET", "/api/games"); render(); }
  } catch (err) {
    $("#vndbSummary").textContent = err.message;
  }
}

$("#vndbSyncBtn").addEventListener("click", async () => {
  const btn = $("#vndbSyncBtn");
  btn.disabled = true;
  btn.textContent = "Syncing…";
  try {
    const r = await api("POST", "/api/vndb/sync-list", {});
    state.games = await api("GET", "/api/games");
    render();
    toast(`VNDB list: ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} blacklisted skipped` : ""}`);
    refreshSummary();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = !state.settings.vndbTokenSet;
    btn.textContent = "Sync my VNDB list";
  }
});

// Two clicks to confirm: the first button press arms it and spells out what will go
function resetPlan(mode) {
  const gone = mode === "all" ? state.games
    : state.games.filter((g) => g.source === "vndb-list" && !g.romPath && !g.exePath);
  const kept = state.games.length - gone.length;
  return { n: gone.length, text: mode === "all"
    ? `This deletes all ${gone.length} games, their covers and fetched characters. Settings are kept.`
    : `This deletes ${gone.length} game${gone.length === 1 ? "" : "s"} added by the VNDB list sync. ${kept} other game${kept === 1 ? "" : "s"} (added by hand, from itch.io or folders, or linked to a file) stay.` };
}

for (const [id, mode, label] of [["#resetVndbBtn", "vndb", "Remove VNDB list imports…"], ["#resetAllBtn", "all", "Reset whole library…"]]) {
  $(id).addEventListener("click", async (e) => {
    const btn = e.currentTarget, note = $("#resetNote");
    const plan = resetPlan(mode);
    if (!plan.n) { note.textContent = "Nothing to remove."; return; }
    if (btn.dataset.armed !== "1") {
      document.querySelectorAll("#resetVndbBtn, #resetAllBtn").forEach((b) => { b.dataset.armed = ""; });
      $("#resetVndbBtn").textContent = "Remove VNDB list imports…";
      $("#resetAllBtn").textContent = "Reset whole library…";
      btn.dataset.armed = "1";
      btn.textContent = `Click again to delete ${plan.n}`;
      note.textContent = plan.text;
      return;
    }
    btn.disabled = true;
    try {
      const r = await api("POST", "/api/library/reset", { mode });
      state.games = await api("GET", "/api/games");
      render();
      refreshSummary();
      note.textContent = `Removed ${r.removed} game${r.removed === 1 ? "" : "s"}.${r.backup ? ` Backup: data/backups/${r.backup}` : ""}`;
    } catch (err) {
      note.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.dataset.armed = "";
      btn.textContent = label;
    }
  });
}

$("#charsStartBtn").addEventListener("click", async () => {
  try {
    await api("POST", "/api/characters/start", {});
    refreshSummary();
  } catch (err) {
    toast(err.message, "error");
  }
});

$("#charsStopBtn").addEventListener("click", async () => {
  await api("POST", "/api/characters/stop", {});
  refreshSummary();
});

$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const emulators = {};
  $$(".emu-row[data-emu]").forEach((row) => {
    const k = row.dataset.emu;
    emulators[k] = {
      ...state.settings.emulators[k],
      path: $('[data-k="path"]', row).value.trim().replace(/^"|"$/g, ""),
      args: $('[data-k="args"]', row).value.trim() || "{rom}",
      folders: $('[data-k="folders"]', row).value.split("\n")
        .map((f) => f.trim().replace(/^"|"$/g, "")).filter(Boolean),
    };
    const dlc = $('[data-k="dlcFolders"]', row);
    if (dlc) emulators[k].dlcFolders = dlc.value.split("\n").map((f) => f.trim().replace(/^"|"$/g, "")).filter(Boolean);
  });
  try {
    state.settings = await api("PUT", "/api/settings", {
      emulators,
      readingSpeed: $("#readingSpeed").value.trim(),
      ankiExport: { noteType: $("#ankiNote").value, deck: $("#ankiDeck").value, tags: $("#ankiTags").value },
      jitenApiKey: $("#jitenKey").value.trim(),
      clearJitenKey: $("#jitenKeyClear").checked,
      itchApiKey: $("#itchKey").value.trim(),
      clearItchKey: $("#itchKeyClear").checked,
      vndbToken: $("#vndbToken").value.trim(),
      clearVndbToken: $("#vndbTokenClear").checked,
    });
    $("#settingsDialog").close();
    toast("Settings saved");
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------- itch.io import ----------

const CONFIDENCE = { release: "matching release", serial: "exact serial", link: "exact store link", title: "same title", possible: "possible match", none: "no match", error: "lookup failed" };
const itch = { source: "itch", items: [], errors: [], selected: new Set(), q: "", type: "game", showImported: false, rows: [], busy: false, run: 0 };
const thumb = (src) => src ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<span class="noimg"></span>`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startImport(source, title, loading) {
  Object.assign(itch, { source, items: [], errors: [], q: "", type: source === "itch" ? "game" : "all", showImported: false });
  itch.selected.clear();
  itch.run++;
  $("#importTitle").textContent = title;
  $("#itchBody").innerHTML = `<p class="muted">${esc(loading)}</p>`;
  $("#itchFoot").innerHTML = "";
  if (!$("#itchDialog").open) $("#itchDialog").showModal();
}

async function openScan() {
  const hasFolders = Object.values(state.settings.emulators).some((e) => (e.folders || []).length);
  if (!hasFolders) {
    startImport("scan", "Scan game folders", "");
    $("#itchBody").innerHTML = `<p>Add your game folders for each emulator in <b>Settings</b> first.</p>`;
    $("#itchFoot").innerHTML = `<button class="primary" id="scanToSettings">Open Settings</button>`;
    $("#scanToSettings").onclick = () => { $("#itchDialog").close(); openSettings(); };
    return;
  }
  startImport("scan", "Scan game folders", "Scanning folders…");
  try {
    const res = await api("GET", "/api/scan");
    itch.errors = res.errors;
    itch.items = res.items.map((it) => ({
      ...it, id: it.key, cover: "", url: "",
      classification: LABELS.platform[it.platform] || it.platform,
      developer: it.serial,
    }));
    renderItchPick();
  } catch (e) {
    $("#itchBody").innerHTML = `<p>${esc(e.message)}</p>`;
  }
}

async function openItch() {
  const dlg = $("#itchDialog");
  if (!state.settings.itchKeySet) {
    startImport("itch", "Import from itch.io", "");
    $("#itchBody").innerHTML = `<p>Add your itch.io API key in <b>Settings</b> first.</p>`;
    $("#itchFoot").innerHTML = `<button class="primary" id="itchToSettings">Open Settings</button>`;
    $("#itchToSettings").onclick = () => { dlg.close(); openSettings(); };
    return;
  }
  startImport("itch", "Import from itch.io", "Loading your itch.io library…");
  try {
    itch.items = (await api("GET", "/api/itch/owned")).map((it) => ({ ...it, id: String(it.itchGameId) }));
    renderItchPick();
  } catch (e) {
    $("#itchBody").innerHTML = `<p>${esc(e.message)}</p>`;
  }
}

function itchVisible() {
  const needle = itch.q.trim().toLowerCase();
  return itch.items.filter((it) =>
    (itch.type === "all" || it.classification === itch.type) &&
    (itch.showImported || !it.imported) &&
    (!needle || `${it.title} ${it.developer}`.toLowerCase().includes(needle)));
}

function renderItchPick() {
  const types = [...new Set(itch.items.map((it) => it.classification))].sort();
  $("#itchBody").innerHTML = `
    <div class="itch-tools">
      <input type="search" id="itchQ" placeholder="Search ${itch.items.length} items…" value="${esc(itch.q)}">
      <select id="itchType">
        <option value="all">${itch.source === "scan" ? "All platforms" : "All types"}</option>
        ${types.map((t) => `<option value="${esc(t)}" ${t === itch.type ? "selected" : ""}>${esc(t.replace("_", " "))}</option>`).join("")}
      </select>
      <label class="inline"><input type="checkbox" id="itchShowImported" ${itch.showImported ? "checked" : ""}> Show already imported</label>
      <button type="button" class="ghost" id="itchAll">Tick all shown</button>
      <button type="button" class="ghost" id="itchNone">Clear</button>
    </div>
    ${itch.errors.map((e) => `<p class="muted">⚠ ${esc(e)}</p>`).join("")}
    <div class="itch-list" id="itchList"></div>`;
  if (!types.includes(itch.type)) $("#itchType").value = "all";
  itch.type = $("#itchType").value;
  renderItchList();

  $("#itchQ").oninput = (e) => { itch.q = e.target.value; renderItchList(); };
  $("#itchType").onchange = (e) => { itch.type = e.target.value; renderItchList(); };
  $("#itchShowImported").onchange = (e) => { itch.showImported = e.target.checked; renderItchList(); };
  $("#itchAll").onclick = () => { itchVisible().filter((it) => !it.imported).forEach((it) => itch.selected.add(it.id)); renderItchList(); };
  $("#itchNone").onclick = () => { itch.selected.clear(); renderItchList(); };
  $("#itchList").onchange = (e) => {
    const id = e.target.dataset.itch;
    if (e.target.checked) itch.selected.add(id); else itch.selected.delete(id);
    renderItchPickFoot();
  };
}

function renderItchList() {
  const list = itchVisible();
  $("#itchList").innerHTML = list.map((it) => `
    <label class="itch-row ${it.imported ? "done" : ""}" title="${esc(it.location || it.url || "")}">
      <input type="checkbox" data-itch="${esc(it.id)}" ${itch.selected.has(it.id) ? "checked" : ""} ${it.imported ? "disabled" : ""}>
      ${thumb(it.cover)}
      <span><b>${esc(it.title)}</b>
        <small>${esc([it.developer, it.classification.replace("_", " "),
          itch.source === "itch" ? (it.purchased ? "purchased" : "bundle / claim") : "…\\" + it.location.split(/[\\/]/).slice(-2).join("\\"),
          it.imported ? "already in library" : ""].filter(Boolean).join(" · "))}</small></span>
    </label>`).join("") || `<p class="muted">Nothing matches.</p>`;
  renderItchPickFoot();
}

function renderItchPickFoot() {
  const n = itch.selected.size;
  $("#itchFoot").innerHTML = `
    <span class="foot-note">${n} selected</span>
    <button type="button" class="ghost" data-close>Cancel</button>
    <button type="button" class="primary" id="itchNext" ${n ? "" : "disabled"}>Match ${n} on VNDB →</button>`;
  $("#itchNext").onclick = startItchMatch;
}

function categorySelect(i, value) {
  return `<select data-cat="${i}" aria-label="Category">
    <option value="" ${value ? "" : "selected"}>Category…</option>
    ${Object.entries(LABELS.category).map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}
  </select>`;
}

/** Releases to choose between: one card per product, with its cover, so a bundle or a volume can be told apart by sight. */
function relCardsHTML(rel, vnTitle, selected, radioName, dataAttr, heading) {
  const kind = (g) => g.vns.length > 1
    ? `Bundle: ${[vnTitle, ...g.vns.filter((x) => x.title).map((x) => x.title)].join(" + ")}`
    : g.rtype === "partial" ? "One volume of a split game" : "Full game";
  return `<div class="rel-picker" role="radiogroup" aria-label="${esc(heading)}">
    <small>${esc(heading)}${selected ? "" : " <b>Pick one.</b>"}</small>
    ${rel.groups.map((g) => `
      <label class="rel-opt ${selected === g.id ? "on" : ""}">
        <input type="radio" name="${radioName}" ${dataAttr}="${esc(g.id)}" value="${esc(g.id)}" ${selected === g.id ? "checked" : ""}>
        ${thumb(g.image)}
        <span><b>${esc(g.name)}</b>
          <small>${esc([g.released, g.langs.join("/"), kind(g)].filter(Boolean).join(" · "))}</small></span>
      </label>`).join("")}
  </div>`;
}

function releasePicker(row) {
  const rel = row.match.release;
  if (!rel || !rel.choose) return "";
  return relCardsHTML(rel, row.match.vn.title, row.releaseId, `rel-${row.i}`, `data-rel="${row.i}" data-relid`, "Which release is this file?");
}

function matchCell(row) {
  if (!row.match) return `<span class="muted">Looking up…</span>`;
  const m = row.match;
  if (!m.vn) return `<span class="conf ${m.confidence}">${CONFIDENCE[m.confidence]}</span>`;
  const v = m.vn;
  return `<label><input type="checkbox" data-use="${row.i}" ${row.use ? "checked" : ""}>
    <span><b>${esc(v.title)}</b> <span class="conf ${m.confidence}">${CONFIDENCE[m.confidence]}</span>
      <small>${esc([v.alttitle, year(v.released), v.developers.join(", ")].filter(Boolean).join(" · "))}</small></span></label>
    ${releasePicker(row)}`;
}

function renderMatchRow(row) {
  return `<div class="match-row" id="match-${row.i}">
    ${thumb(row.item.cover)}
    <span><b>${esc(row.item.title)}</b><small>${esc(row.item.developer)}</small></span>
    <span class="match-cell">${matchCell(row)}</span>
    ${categorySelect(row.i, row.category)}
  </div>`;
}

async function startItchMatch() {
  itch.rows = itch.items.filter((it) => itch.selected.has(it.id))
    .map((item, i) => ({ i, item, match: null, use: false, category: "" }));
  $("#itchBody").innerHTML = `
    <p class="muted">Ticked matches fill in Japanese title, brand, routes and seiyuu from VNDB. Untick a wrong one to import the ${itch.source === "scan" ? "file's own title" : "itch.io details"} only.</p>
    <div class="itch-list" id="matchList">${itch.rows.map(renderMatchRow).join("")}</div>`;
  $("#matchList").onchange = (e) => {
    const t = e.target;
    if (t.dataset.use) itch.rows[+t.dataset.use].use = t.checked;
    if (t.dataset.cat) itch.rows[+t.dataset.cat].category = t.value;
    if (t.dataset.rel) {
      const row = itch.rows[+t.dataset.rel];
      row.releaseId = t.value;
      $(`#match-${row.i}`).outerHTML = renderMatchRow(row);
    }
  };
  renderItchMatchFoot();

  itch.busy = true;
  const run = ++itch.run; // a newer run (or Back) stops this one
  for (const row of itch.rows) {
    try {
      const q = new URLSearchParams({ title: row.item.title, url: row.item.url || "", serial: row.item.serial || "",
        platform: row.item.platform || (itch.source === "itch" ? "pc" : "") });
      row.match = await api("GET", `/api/vndb/match?${q}`);
    } catch (e) {
      row.match = { confidence: "error" };
    }
    const el = $(`#match-${row.i}`);
    if (run !== itch.run || !el || !$("#itchDialog").open) return;
    row.use = ["serial", "link", "title", "release"].includes(row.match.confidence);
    row.releaseId = row.match.release?.suggested || "";
    row.category = row.category || (row.use ? row.match.category : "") || "";
    el.outerHTML = renderMatchRow(row);
    renderItchMatchFoot();
    await wait(250); // stay well inside VNDB's rate limit
  }
  itch.busy = false;
  renderItchMatchFoot();
}

function renderItchMatchFoot(progress) {
  const done = itch.rows.filter((r) => r.match).length;
  const note = progress || (itch.busy ? `Matching ${done}/${itch.rows.length}…` : `${itch.rows.length} to import`);
  $("#itchFoot").innerHTML = `
    <span class="foot-note">${esc(note)}</span>
    <button type="button" class="ghost" id="itchBack" ${progress ? "disabled" : ""}>← Back</button>
    <button type="button" class="primary" id="itchImport" ${itch.busy || progress ? "disabled" : ""}>Import ${itch.rows.length}</button>`;
  $("#itchBack").onclick = () => { itch.busy = false; itch.run++; renderItchPick(); };
  $("#itchImport").onclick = importItchRows;
}

async function importItchRows() {
  const missing = itch.rows.filter((r) => !r.category);
  if (missing.length) {
    toast(`Pick a category for ${missing.length} game${missing.length > 1 ? "s" : ""} first`, "error");
    $(`#match-${missing[0].i} select`).focus();
    return;
  }
  const unpicked = itch.rows.filter((r) => r.use && r.match?.release?.choose && !r.releaseId);
  if (unpicked.length) {
    toast(`Pick which release ${unpicked.length > 1 ? `${unpicked.length} files are` : `"${unpicked[0].item.title}" is`} first`, "error");
    $(`#match-${unpicked[0].i}`).scrollIntoView({ block: "center" });
    return;
  }
  let added = 0;
  for (const row of itch.rows) {
    renderItchMatchFoot(`Importing ${added + 1}/${itch.rows.length}…`);
    const it = row.item;
    try {
      // A bundle release (base game + fandisc on one cartridge) becomes one entry per game, all pointing at the same file.
      // A volume of a split game gets the release's own name and cover so volumes can be told apart.
      const rel = row.use ? row.match?.release?.groups.find((g) => g.id === row.releaseId) : null;
      const vids = rel && rel.vns.length > 1 ? rel.vns.map((v) => v.id) : row.use && row.match?.vn ? [row.match.vn.id] : [null];
      const where = itch.source === "scan"
        ? { platform: it.platform, format: "emulated", emulator: it.emulator, romPath: it.romPath, serial: it.serial, source: "scan" }
        : { platform: "pc", format: "pc", exePath: "", itchGameId: it.itchGameId, itchUrl: it.url, source: "itch" };
      for (const vid of vids) {
        let game = { title: it.title, brand: it.developer, cover: it.cover };
        if (vid) {
          const d = await api("GET", `/api/vndb/vn/${encodeURIComponent(vid)}`);
          game = {
            title: d.title, originalTitle: d.originalTitle, released: d.released,
            brand: d.brand || it.developer, cover: d.cover || it.cover,
            description: d.description, routes: d.routes, vndbId: d.vndbId,
          };
          if (rel && rel.rtype === "partial" && vids.length === 1) {
            game.title = rel.name;
            game.originalTitle = rel.original || game.originalTitle;
            game.cover = rel.fullImage || game.cover;
          }
          if (rel) { game.releaseId = rel.id; if (vids.length > 1) game.bundleWith = vids.filter((x) => x !== vid); }
        }
        const saved = await api("POST", "/api/games", {
          ...game, ...where, category: row.category, status: "unplayed", rating: 0, routes: game.routes || [],
        });
        replaceGame(saved);
        added++;
      }
      it.imported = true;
    } catch (e) {
      toast(`${it.title}: ${e.message}`, "error");
    }
  }
  itch.selected.clear();
  $("#itchDialog").close();
  render();
  toast(`Imported ${added} game${added === 1 ? "" : "s"}${itch.source === "itch" ? " from itch.io" : ""}`);
}

// ---------- check my library: game folders vs. games imported from VNDB ----------

const check = { rows: [], busy: false, run: 0 };

const CHECK_NOTE = {
  link: "Link to your list entry",
  have: "Your list entry already has a file",
  dupe: "Another file already matched this entry",
  off: "Not on your VNDB list",
  weak: "Unsure match",
  none: "No VNDB match",
  error: "Lookup failed",
};

async function openCheck() {
  const hasFolders = Object.values(state.settings.emulators).some((e) => (e.folders || []).length);
  startImport("check", "Check my library", hasFolders ? "Scanning folders…" : "");
  if (!hasFolders) {
    $("#itchBody").innerHTML = `<p>Add your game folders for each emulator in <b>Settings</b> first.</p>`;
    $("#itchFoot").innerHTML = `<button class="primary" id="scanToSettings">Open Settings</button>`;
    $("#scanToSettings").onclick = () => { $("#itchDialog").close(); openSettings(); };
    return;
  }
  const run = check.run = itch.run;
  try {
    const res = await api("GET", "/api/scan");
    const files = res.items.filter((it) => !it.imported);
    const entries = (vid) => state.games.filter((g) => g.vndbId === vid);
    check.rows = files.map((item, i) => ({ i, item, match: null, kind: "", game: null, use: false }));
    $("#itchBody").innerHTML = `
      <p class="muted">Looks up each file in your folders on VNDB. A file that matches a game already on your VNDB list is linked to that entry, so it launches from the library without making a duplicate.</p>
      ${res.errors.map((e) => `<p class="muted">⚠ ${esc(e)}</p>`).join("")}
      <div id="checkSum" class="muted"></div>
      <div class="itch-list" id="checkList">${check.rows.map(checkRowHTML).join("") || `<p class="muted">Every file in your folders is already in the library.</p>`}</div>`;
    $("#checkList").onchange = (e) => {
      if (e.target.dataset.check) check.rows[+e.target.dataset.check].use = e.target.checked;
      checkFoot();
    };
    check.busy = true;
    checkFoot();
    const claimed = new Set();
    for (const row of check.rows) {
      try {
        const it = row.item;
        row.match = await api("GET", `/api/vndb/match?${new URLSearchParams({ title: it.title, url: "", serial: it.serial || "", platform: it.platform })}`);
      } catch (e) {
        row.match = { confidence: "error" };
      }
      if (run !== itch.run || !$("#itchDialog").open) return;
      const m = row.match, vid = m.vn?.id;
      // A bundle (base game + fandisc on one cartridge) covers every VN in the chosen release
      const rel = m.release?.groups.find((g) => g.id === m.release.suggested);
      const vids = rel && rel.vns.length > 1 ? rel.vns.map((v) => v.id) : vid ? [vid] : [];
      const sure = ["serial", "link", "title", "release"].includes(m.confidence);
      const listed = vids.flatMap(entries);
      if (!vid) row.kind = m.confidence === "error" ? "error" : "none";
      else if (!listed.length) row.kind = "off";
      else if (listed.every((g) => g.romPath)) row.kind = "have";
      else if (vids.some((v) => claimed.has(v))) row.kind = "dupe";
      else row.kind = sure ? "link" : "weak";
      row.games = listed.filter((g) => !g.romPath);
      if (row.kind === "link" || row.kind === "weak") vids.forEach((v) => claimed.add(v));
      row.use = row.kind === "link";
      $(`#chk-${row.i}`).outerHTML = checkRowHTML(row);
      checkFoot();
      await wait(250); // stay well inside VNDB's rate limit
    }
    check.busy = false;
    checkFoot();
  } catch (e) {
    $("#itchBody").innerHTML = `<p>${esc(e.message)}</p>`;
  }
}

function checkRowHTML(row) {
  const m = row.match, linkable = row.kind === "link" || row.kind === "weak";
  const result = !m ? `<span class="muted">Looking up…</span>`
    : `<span class="conf ${esc(m.confidence)}">${esc(CHECK_NOTE[row.kind])}</span>
       ${m.vn ? `<small>${esc([m.vn.title, year(m.vn.released)].filter(Boolean).join(" · "))}</small>` : ""}
       ${linkable ? `<small>→ ${esc(row.games.map((g) => g.title).join(" + "))}</small>` : ""}`;
  return `<label class="itch-row check-row ${row.kind === "have" || row.kind === "dupe" ? "done" : ""}" id="chk-${row.i}" title="${esc(row.item.location)}">
    <input type="checkbox" data-check="${row.i}" ${row.use ? "checked" : ""} ${linkable ? "" : "disabled"}>
    <span class="noimg"></span>
    <span><b>${esc(row.item.title)}</b><small>${esc([LABELS.platform[row.item.platform] || row.item.platform, row.item.serial].filter(Boolean).join(" · "))}</small></span>
    <span class="check-result">${result}</span>
  </label>`;
}

function checkFoot(progress) {
  const done = check.rows.filter((r) => r.match).length, n = check.rows.filter((r) => r.use).length;
  const count = (k) => check.rows.filter((r) => r.kind === k).length;
  $("#checkSum") && ($("#checkSum").textContent = check.rows.length
    ? `${count("link") + count("weak")} match your VNDB list · ${count("have") + count("dupe")} already linked · ${count("off")} not on your list · ${count("none") + count("error")} unmatched`
    : "");
  $("#itchFoot").innerHTML = `
    <span class="foot-note">${esc(progress || (check.busy ? `Checking ${done}/${check.rows.length}…` : `${check.rows.length} file${check.rows.length === 1 ? "" : "s"} checked`))}</span>
    <button type="button" class="ghost" data-close>Close</button>
    <button type="button" class="primary" id="checkApply" ${n && !progress ? "" : "disabled"}>Link ${n}</button>`;
  $("#checkApply").onclick = applyCheck;
}

async function applyCheck() {
  const todo = check.rows.filter((r) => r.use);
  let linked = 0;
  for (const row of todo) {
    checkFoot(`Linking ${linked + 1}/${todo.length}…`);
    const it = row.item;
    for (const g of row.games) {
      try {
        const cur = state.games.find((x) => x.id === g.id);
        await saveGame({ ...cur, format: "emulated", platform: it.platform, emulator: it.emulator, romPath: it.romPath, serial: it.serial });
        linked++;
      } catch (e) {
        toast(`${g.title}: ${e.message}`, "error");
      }
    }
    row.use = false;
    row.kind = "have";
    $(`#chk-${row.i}`).outerHTML = checkRowHTML(row);
  }
  checkFoot();
  toast(`Linked ${linked} game${linked === 1 ? "" : "s"} to your folders`);
}

// ---------- Switch DLC / updates ----------

async function openDlc() {
  startImport("dlc", "Switch DLC & updates", "Reading your DLC / update folders…");
  $("#itchFoot").innerHTML = `<button type="button" class="ghost" data-close>Close</button>`;
  if (!(state.settings.emulators.switch?.dlcFolders || []).length) {
    $("#itchBody").innerHTML = `<p>Add your <b>DLC / UPDATES</b> folders under the Switch emulator in <b>Settings</b> first.</p>`;
    $("#itchFoot").innerHTML = `<button class="primary" id="dlcToSettings">Open Settings</button>`;
    $("#dlcToSettings").onclick = () => { $("#itchDialog").close(); openSettings(); };
    return;
  }
  try {
    renderDlc(await api("GET", "/api/dlc/check"));
  } catch (e) {
    $("#itchBody").innerHTML = `<p>${esc(e.message)}</p>`;
  }
}

function renderDlc(r) {
  const ver = (f) => f.version != null ? `v${f.version}` : "version unknown";
  const dlcN = r.matched.reduce((n, m) => n + m.dlc.length, 0);
  const updN = r.matched.filter((m) => m.updates.length).length;
  const row = (title, sub, extra = "") => `<div class="dlc-row"><b>${esc(title)}</b>${sub ? `<small>${sub}</small>` : ""}${extra}</div>`;
  const section = (head, note, rows, open = true) => rows.length ? `<details class="dlc-sec" ${open ? "open" : ""}>
    <summary>${esc(head)} <span class="muted">(${rows.length})</span></summary>${note ? `<p class="muted">${note}</p>` : ""}${rows.join("")}</details>` : "";
  $("#itchBody").innerHTML = `
    <p class="muted">Matched ${fmt(r.files)} files by title ID against your ${fmt(r.games)} Switch games. ${updN} game${updN === 1 ? " has" : "s have"} an update and ${dlcN} DLC file${dlcN === 1 ? " is" : "s are"} matched.</p>
    ${r.errors.map((e) => `<p class="muted">⚠ ${esc(e)}</p>`).join("")}
    ${section("Games with updates or DLC", "", r.matched.map((m) => {
      const up = m.updates[0];
      const parts = [up ? `Update ${ver(up)}${m.updates.length > 1 ? ` (+${m.updates.length - 1} older)` : ""}` : "No update",
        m.dlc.length ? `${m.dlc.length} DLC` : "No DLC"];
      return row(m.title, esc(parts.join(" · ")), m.dlc.length ? `<small class="dlc-list">${m.dlc.map((f) => esc(f.file)).join("<br>")}</small>` : "");
    }))}
    ${section("Files with no matching game", "These belong to a game that isn't in your library, or isn't linked to its file yet.",
      r.orphans.map((f) => row(f.file, esc(`${f.kind === "base" ? "base game" : f.kind} · belongs to ${f.baseId}`))))}
    ${section("Owned games with no update or DLC files", "", r.lacking.map((t) => row(t, "")), false)}
    ${section("Games I couldn't read a title ID for", "The game's file name has no [title ID], so it can't be matched.", r.noId.map((t) => row(t, "")), false)}
    ${section("Files with no title ID", "Rename them to include the [16-character ID] so they can be matched.", r.untagged.map((t) => row(t, "")), false)}
    ${r.files || r.untagged.length || r.errors.length ? "" : `<p class="muted">No Switch files found in your DLC / update folders.</p>`}`;
}

// ---------- global wiring ----------

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (e) {}
}

// ---------- side menu + page switching ----------

function showView(name) {
  const v = VIEWS[name];
  if (!v) return;
  currentView = name;
  const library = name === "library";
  $$("[data-view-of='library']").forEach((el) => { el.hidden = !library; });
  $("#viewHost").hidden = library;
  $("#search").hidden = $("#sort").hidden = !library;
  $("#viewHost").dataset.view = name;
  if (!library) { $("#viewHost").innerHTML = ""; v.render($("#viewHost")); }
  $$(".nav-item[data-view]").forEach((b) => {
    if (b.dataset.view === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (narrowScreen()) setMenu(false);
}

const narrowScreen = () => matchMedia("(max-width: 999px)").matches;

function setMenu(open) {
  document.body.classList.toggle("menu-open", open);
  $("#menuBtn").setAttribute("aria-expanded", String(open));
  $("#menuScrim").hidden = !(open && narrowScreen());
  try { localStorage.setItem("menuOpen", open ? "1" : "0"); } catch (e) {}
}

$("#menuBtn").onclick = () => setMenu(!document.body.classList.contains("menu-open"));
$("#menuClose").onclick = () => setMenu(false);
$("#menuScrim").onclick = () => setMenu(false);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && narrowScreen() && document.body.classList.contains("menu-open")
      && !document.querySelector("dialog[open]")) setMenu(false);
});
$$(".nav-item[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
// Tool buttons (study, itch.io, scan, settings, theme) open dialogs: on a phone the menu should get out of the way
$$(".nav-item:not([data-view])").forEach((b) => b.addEventListener("click", () => { if (narrowScreen()) setMenu(false); }));
matchMedia("(max-width: 999px)").addEventListener("change", () => setMenu(document.body.classList.contains("menu-open")));
try {
  // Wide screens start with the menu pinned open unless it was closed last time; phones start closed
  setMenu(!narrowScreen() && localStorage.getItem("menuOpen") !== "0");
} catch (e) { setMenu(false); }
showView("library");

// ---------- page: Voice Actors & LIs ----------

const people = { chars: null, staff: null, loading: null };
const vaUI = { q: "", category: "", faces: true };

function loadPeople() {
  // characters.json / staff.json fill in once "Fetch characters & voice actors" has run; before that we use each game's routes
  people.loading ||= Promise.all([api("GET", "/api/characters"), api("GET", "/api/staff")])
    .then(([c, s]) => { people.chars = c; people.staff = s; })
    .catch(() => { people.chars = {}; people.staff = {}; });
  return people.loading;
}

/** The love interests of a game with their voice actor: fetched VNDB characters if we have them, else the saved routes. */
function castOf(g) {
  if (g.charsFetchedAt && g.charIds && g.charIds.length) {
    const out = [];
    for (const id of g.charIds) {
      const c = people.chars[id];
      const role = c && c.vns.find((x) => x.id === g.vndbId);
      if (!c || !role || role.role !== "primary") continue;
      const va = (c.va || []).find((x) => x.vn === g.vndbId);
      const s = va && people.staff[va.staff];
      out.push({ name: c.name, original: c.original, image: c.image, nsfw: c.imageNsfw,
                 vaId: s ? s.id : "", vaName: s ? s.name : "", vaOriginal: s ? s.original : "" });
    }
    if (out.length) return out;
  }
  return (g.routes || []).filter((r) => r.seiyuu).map((r) => ({
    name: r.name, original: r.original, image: "", vaId: "", vaName: "", vaOriginal: r.seiyuu }));
}

function vaGroups() {
  const groups = new Map();
  const needle = vaUI.q.trim().toLowerCase();
  for (const g of state.games) {
    if (vaUI.category && g.category !== vaUI.category) continue;
    for (const c of castOf(g)) {
      const key = c.vaOriginal || c.vaName;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, name: c.vaName, original: c.vaOriginal, roles: [] });
      const grp = groups.get(key);
      grp.name ||= c.vaName;
      grp.roles.push({ ...c, game: g });
    }
  }
  return [...groups.values()]
    .filter((v) => !needle || [v.name, v.original].some((s) => (s || "").toLowerCase().includes(needle)))
    .sort((a, b) => b.roles.length - a.roles.length || (a.original || a.name).localeCompare(b.original || b.name));
}

function roleHTML(r) {
  const label = `${r.name}${r.original ? " · " + r.original : ""} — ${r.game.title}`;
  const letter = esc((r.name || "?")[0]);
  const face = vaUI.faces && (r.image || r.game.cover)
    ? `<img src="${esc(r.image || r.game.cover)}" alt="" loading="lazy" data-letter="${letter}">` : `<span class="face-txt">${letter}</span>`;
  return `<button type="button" class="role" data-open="${esc(r.game.id)}" title="${esc(label)}">${face}<span>${esc(r.name)}</span></button>`;
}

function renderVAs(host) {
  const groups = vaGroups();
  const cats = Object.entries(LABELS.category);
  host.querySelector("#vaList").innerHTML = groups.length ? groups.map((v) => `
    <article class="va-row">
      <header><b>${esc(v.name || v.original)}</b>${v.name && v.original ? `<small>${esc(v.original)}</small>` : ""}
        <small>${v.roles.length} role${v.roles.length === 1 ? "" : "s"}</small></header>
      <div class="roles">${v.roles.map(roleHTML).join("")}</div>
    </article>`).join("") : `<p class="empty">No voice actors yet. Add games from VNDB (with routes), or fetch characters in Settings.</p>`;
  host.querySelector("#vaCount").textContent = `${groups.length} voice actors`;
  host.querySelectorAll("[data-vacat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vacat === vaUI.category)));
}

// ---------- love interests: scores + tier lists ----------
// A love interest is a route of a game. Its score (0-10) and tier live on the route, a game's tier on the game,
// so they're saved with the game and need no separate store.

const TIERS = ["S", "A", "B", "C", "D", "F"];
const TIER_COLOURS = { S: "#c4578a", A: "#c99a3c", B: "#6f9a6f", C: "#8a93b3", D: "#9a8f87", F: "#6d6670" };
const tierUI = { category: "", size: +(() => { try { return localStorage.getItem("tierSize"); } catch (e) { return 0; } })() || 84 };
const liUI = { q: "", category: "", sort: "score", unratedOnly: false };

function allLIs() {
  const out = [];
  for (const g of state.games) {
    (g.routes || []).forEach((r, i) => {
      const c = r.charId && people.chars ? people.chars[r.charId] : null;
      out.push({ key: `${g.id}|${i}`, g, r, name: r.name, original: r.original, va: r.seiyuu,
                 image: (c && c.image) || "", score: r.score, tier: r.tier || "" });
    });
  }
  return out;
}

const portraitHTML = (img, fallback, cls = "") => img
  ? `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy" data-letter="${esc((fallback || "?")[0])}">`
  : `<span class="face-txt ${cls}">${esc((fallback || "?")[0])}</span>`;

/** Shared tier board. items: [{key, tier, img, label, sub}]. Drag a card onto a row, or click it for a menu. */
function renderTierBoard(host, items, { setTier, open }) {
  const card = (it) => `<div class="tier-card" draggable="true" data-key="${esc(it.key)}" title="${esc(it.label)}${it.sub ? " — " + esc(it.sub) : ""}">
      ${portraitHTML(it.img, it.label)}</div>`;
  const rows = [...TIERS, ""].map((t) => `
    <div class="tier-row" data-tier="${t}">
      <div class="tier-label" style="background:${t ? TIER_COLOURS[t] : "var(--surface-2)"};${t ? "" : "color:var(--muted)"}">${t || "Unranked"}</div>
      <div class="tier-items">${items.filter((it) => it.tier === t).map(card).join("")}</div>
    </div>`).join("");
  host.innerHTML = `<div class="tier-board" style="--sz:${tierUI.size}px">${rows}</div>`;
  const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
  const board = host.querySelector(".tier-board");
  let dragKey = null;
  board.ondragstart = (e) => { const c = e.target.closest(".tier-card"); if (c) { dragKey = c.dataset.key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragKey); } };
  board.ondragover = (e) => { const r = e.target.closest(".tier-row"); if (r && dragKey) { e.preventDefault(); r.classList.add("over"); } };
  board.ondragleave = (e) => e.target.closest(".tier-row")?.classList.remove("over");
  board.ondrop = (e) => {
    const r = e.target.closest(".tier-row");
    if (!r || !dragKey) return;
    e.preventDefault();
    const key = dragKey; dragKey = null;
    if (byKey[key] && byKey[key].tier !== r.dataset.tier) setTier(byKey[key], r.dataset.tier);
  };
  board.ondragend = () => { dragKey = null; board.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); };
  board.onclick = (e) => {
    const c = e.target.closest(".tier-card");
    if (!c) return;
    const it = byKey[c.dataset.key];
    const pop = document.createElement("div");
    pop.className = "tier-pop";
    pop.innerHTML = `<b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}
      <div class="tier-pop-btns">${[...TIERS, ""].map((t) => `<button type="button" data-t="${t}" ${it.tier === t ? "aria-pressed=true" : ""}
        style="${t ? `background:${TIER_COLOURS[t]};color:#fff` : ""}">${t || "—"}</button>`).join("")}</div>
      <button type="button" class="ghost" data-open>Open game</button>`;
    document.body.append(pop);
    const rect = c.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = `${Math.min(rect.bottom + 6, innerHeight - pop.offsetHeight - 8)}px`;
    const close = () => { pop.remove(); document.removeEventListener("pointerdown", away, true); };
    const away = (ev) => { if (!pop.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener("pointerdown", away, true));
    pop.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      close();
      if (b.hasAttribute("data-open")) open(it); else setTier(it, b.dataset.t);
    };
  };
}

function tierControls(host, onChange) {
  host.insertAdjacentHTML("beforeend", `
    <div class="filters page-filters">
      <div class="filter-group"><b>Category</b>
        <button class="chip" data-tcat="" aria-pressed="${!tierUI.category}">All</button>
        ${Object.entries(LABELS.category).map(([k, l]) => `<button class="chip" data-tcat="${k}" aria-pressed="${tierUI.category === k}">${l}</button>`).join("")}
      </div>
      <label class="inline">size <input type="range" id="tierSize" min="48" max="140" step="4" value="${tierUI.size}"> <output>${tierUI.size}px</output></label>
      <small>Drag a card onto a tier, or click it for a menu.</small>
    </div>`);
  host.querySelectorAll("[data-tcat]").forEach((b) => b.onclick = () => { tierUI.category = b.dataset.tcat; onChange(); });
  const size = host.querySelector("#tierSize");
  size.oninput = () => { tierUI.size = +size.value; size.nextElementSibling.textContent = `${size.value}px`;
    host.querySelector(".tier-board")?.style.setProperty("--sz", `${size.value}px`);
    try { localStorage.setItem("tierSize", size.value); } catch (e) {} };
}

function tierPage(title, empty, build) {
  return {
    async render(host) {
      host.innerHTML = `<h2 class="page-h">${esc(title)}</h2>`;
      await loadPeople();
      if (currentView !== host.dataset.view) return;
      const draw = () => {
        host.querySelectorAll(".filters, #tierBoardHost, .empty").forEach((x) => x.remove());
        tierControls(host, () => { VIEWS[host.dataset.view].render(host); });
        const board = document.createElement("div");
        board.id = "tierBoardHost";
        host.append(board);
        const items = build();
        if (!items.length) { board.innerHTML = `<p class="empty">${esc(empty)}</p>`; return; }
        renderTierBoard(board, items.items || items, items.handlers || {});
      };
      draw();
    },
  };
}

VIEWS.litiers = tierPage("LI Tier List", "No love interests yet. Sync your VNDB list and fetch characters in Settings, or add routes to a game.", () => {
  const list = allLIs().filter((l) => !tierUI.category || l.g.category === tierUI.category);
  const items = list.map((l) => ({ key: l.key, tier: l.tier, img: l.image || l.g.cover, label: l.name, sub: l.g.title }));
  const byKey = Object.fromEntries(list.map((l) => [l.key, l]));
  items.handlers = {
    setTier: (it, tier) => { const l = byKey[it.key]; l.r.tier = tier; return saveGame(l.g).catch((e) => toast(e.message, "error")); },
    open: (it) => { detailTab = "overview"; openDetail(byKey[it.key].g.id); },
  };
  return items;
});

VIEWS.gametiers = tierPage("Game Tier List", "No games yet.", () => {
  const list = state.games.filter((g) => (!tierUI.category || g.category === tierUI.category) && (inDiary(g) || g.tier));
  const items = list.map((g) => ({ key: g.id, tier: g.tier || "", img: g.cover, label: g.title, sub: LABELS.status[g.status] || "" }));
  const byKey = Object.fromEntries(list.map((g) => [g.id, g]));
  items.handlers = {
    setTier: (it, tier) => { const g = byKey[it.key]; g.tier = tier; return saveGame(g).catch((e) => toast(e.message, "error")); },
    open: (it) => { detailTab = "overview"; openDetail(it.key); },
  };
  return items;
});

function liCardHTML(l) {
  return `<article class="li-card" data-key="${esc(l.key)}">
    <button type="button" class="li-face" data-opengame="${esc(l.g.id)}" title="Open ${esc(l.g.title)}">${portraitHTML(l.image || l.g.cover, l.name)}</button>
    <div class="li-body">
      <b>${esc(l.name)}</b>${l.original ? `<small>${esc(l.original)}</small>` : ""}
      <small>${esc(l.g.title)}${l.va ? ` · CV ${esc(l.va)}` : ""}</small>
      <div class="li-edit">
        <label>score <input type="number" min="0" max="10" step="0.5" data-score="${esc(l.key)}" value="${l.score ?? ""}" placeholder="–"></label>
        <label>tier <select data-litier="${esc(l.key)}"><option value="">–</option>${TIERS.map((t) => `<option ${l.tier === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
    </div>
  </article>`;
}

function renderLIs(host) {
  const needle = liUI.q.trim().toLowerCase();
  let list = allLIs().filter((l) => (!liUI.category || l.g.category === liUI.category) &&
    (!liUI.unratedOnly || l.score == null) &&
    (!needle || [l.name, l.original, l.va, l.g.title].some((s) => (s || "").toLowerCase().includes(needle))));
  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    game: (a, b) => a.g.title.localeCompare(b.g.title),
  };
  list.sort(sorters[liUI.sort]);
  host.querySelector("#liList").innerHTML = list.length ? list.map(liCardHTML).join("") : `<p class="empty">No love interests match.</p>`;
  host.querySelector("#liCount").textContent = `${list.length} love interests`;
  host.querySelectorAll("[data-lcat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lcat === liUI.category)));
}

VIEWS.lis = {
  async render(host) {
    host.innerHTML = `
      <h2 class="page-h">Love Interests</h2>
      <div class="filters page-filters">
        <div class="filter-group"><b>Category</b>
          <button class="chip" data-lcat="" aria-pressed="true">All</button>
          ${Object.entries(LABELS.category).map(([k, l]) => `<button class="chip" data-lcat="${k}" aria-pressed="false">${l}</button>`).join("")}
        </div>
        <input id="liSearch" type="search" placeholder="Name, voice actor or game…" value="${esc(liUI.q)}">
        <label class="inline">sort <select id="liSort"><option value="score">Score</option><option value="name">Name</option><option value="game">Game</option></select></label>
        <label class="inline"><input type="checkbox" id="liUnrated" ${liUI.unratedOnly ? "checked" : ""}> unrated only</label>
        <small id="liCount"></small>
      </div>
      <div id="liList" class="li-grid"><p class="empty">Loading…</p></div>`;
    host.querySelector("#liSort").value = liUI.sort;
    host.querySelector("#liSearch").oninput = (e) => { liUI.q = e.target.value; renderLIs(host); };
    host.querySelector("#liSort").onchange = (e) => { liUI.sort = e.target.value; renderLIs(host); };
    host.querySelector("#liUnrated").onchange = (e) => { liUI.unratedOnly = e.target.checked; renderLIs(host); };
    host.querySelectorAll("[data-lcat]").forEach((b) => b.onclick = () => { liUI.category = b.dataset.lcat; renderLIs(host); });
    const route = (key) => { const [gid, i] = key.split("|"); const g = state.games.find((x) => x.id === gid); return g && { g, r: g.routes[+i] }; };
    const list = host.querySelector("#liList");
    list.onchange = (e) => {
      const t = e.target;
      const key = t.dataset.score || t.dataset.litier;
      const hit = key && route(key);
      if (!hit) return;
      if (t.dataset.score) hit.r.score = t.value === "" ? null : Math.min(10, Math.max(0, +t.value));
      else hit.r.tier = t.value;
      saveGame(hit.g).catch((err) => toast(err.message, "error"));
    };
    list.onclick = (e) => {
      const b = e.target.closest("[data-opengame]");
      if (b) { detailTab = "overview"; openDetail(b.dataset.opengame); }
    };
    await loadPeople();
    if (currentView === "lis") renderLIs(host);
  },
};

// A missing image (cover not downloaded yet) falls back to the character's initial
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName === "IMG" && img.dataset.letter) img.replaceWith(Object.assign(document.createElement("span"),
    { className: "face-txt", textContent: img.dataset.letter }));
}, true);

VIEWS.vas = {
  async render(host) {
    host.innerHTML = `
      <h2 class="page-h">Voice Actors &amp; Love Interests</h2>
      <div class="filters page-filters">
        <div class="filter-group"><b>Category</b>
          <button class="chip" data-vacat="" aria-pressed="true">All</button>
          ${Object.entries(LABELS.category).map(([k, l]) => `<button class="chip" data-vacat="${k}" aria-pressed="false">${l}</button>`).join("")}
        </div>
        <input id="vaSearch" type="search" placeholder="Search voice actor (romaji or JP)…" value="${esc(vaUI.q)}">
        <label class="inline"><input type="checkbox" id="vaFaces" ${vaUI.faces ? "checked" : ""}> show faces</label>
        <small id="vaCount"></small>
      </div>
      <div id="vaList" class="va-list"><p class="empty">Loading…</p></div>`;
    host.querySelector("#vaSearch").oninput = (e) => { vaUI.q = e.target.value; renderVAs(host); };
    host.querySelector("#vaFaces").onchange = (e) => { vaUI.faces = e.target.checked; renderVAs(host); };
    host.querySelectorAll("[data-vacat]").forEach((b) => b.onclick = () => { vaUI.category = b.dataset.vacat; renderVAs(host); });
    await loadPeople();
    if (currentView === "vas") renderVAs(host);
  },
};

$("#themeBtn").onclick = () => {
  const cur = document.documentElement.dataset.theme;
  setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
};
$("#addBtn").onclick = () => openEdit(null);
$("#settingsBtn").onclick = openSettings;
$("#itchBtn").onclick = openItch;
$("#scanBtn").onclick = openScan;
$("#checkBtn").onclick = openCheck;
$("#dlcBtn").onclick = openDlc;
$("#search").addEventListener("input", (e) => { state.filter.q = e.target.value; render(); });
$("#sort").onchange = (e) => { state.sort = e.target.value; render(); };

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-filter]");
  if (!chip) return;
  state.filter[chip.dataset.filter] = chip.dataset.value;
  render();
});

document.addEventListener("click", (e) => {
  const play = e.target.closest("[data-play]");
  if (play) { e.stopPropagation(); return launchGame(play.dataset.play); }
  if (e.target.closest("[data-close]")) return e.target.closest("dialog").close();
  const card = e.target.closest("[data-open]");
  if (card) { detailTab = "overview"; openDetail(card.dataset.open); }
}, true);

$("#grid").addEventListener("keydown", (e) => {
  const card = e.target.closest("[data-open]");
  if (card && e.key === "Enter" && e.target === card) { detailTab = "overview"; openDetail(card.dataset.open); }
});

$$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

(async function init() {
  try {
    [state.games, state.settings] = await Promise.all([api("GET", "/api/games"), api("GET", "/api/settings")]);
  } catch (e) {
    toast("Couldn't reach the library server. Start it with start-library.bat.", "error");
  }
  render();
  if (currentView !== "library") VIEWS[currentView].render($("#viewHost"));
})();
