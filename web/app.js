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
        <div class="tabs">${[["overview", "Overview"], ["study", "Study"]].map(([k, l]) =>
          `<button data-tab="${k}" aria-pressed="${detailTab === k}">${l}</button>`).join("")}</div>
        ${detailTab === "study" ? `<div id="studyPane">${studyHTML(g)}</div>` : `
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
  if (!dlg.open) dlg.showModal();
  if (detailTab === "study") loadStudy(g);
}

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
    box.innerHTML = "";
    toast(`Filled from VNDB · ${d.routes.length} characters found`);
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

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
    const saved = state.editing
      ? await api("PUT", `/api/games/${encodeURIComponent(g.id)}`, g)
      : await api("POST", "/api/games", g);
    replaceGame(saved);
    render();
    $("#editDialog").close();
    toast(state.editing ? "Saved" : `Added ${saved.title}`);
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
  $("#itchKey").value = "";
  $("#itchKeyClear").checked = false;
  $("#itchKeyState").textContent = state.settings.itchKeySet
    ? "A key is saved. Paste a new one to replace it." : "No key saved yet.";
  $("#itchKeyClearWrap").hidden = !state.settings.itchKeySet;
  $("#settingsDialog").showModal();
}

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
    });
    $("#settingsDialog").close();
    toast("Settings saved");
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---------- itch.io import ----------

const CONFIDENCE = { serial: "exact serial", link: "exact store link", title: "same title", possible: "possible match", none: "no match", error: "lookup failed" };
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

function matchCell(row) {
  if (!row.match) return `<span class="muted">Looking up…</span>`;
  const m = row.match;
  if (!m.vn) return `<span class="conf ${m.confidence}">${CONFIDENCE[m.confidence]}</span>`;
  const v = m.vn;
  return `<label><input type="checkbox" data-use="${row.i}" ${row.use ? "checked" : ""}>
    <span><b>${esc(v.title)}</b> <span class="conf ${m.confidence}">${CONFIDENCE[m.confidence]}</span>
      <small>${esc([v.alttitle, year(v.released), v.developers.join(", ")].filter(Boolean).join(" · "))}</small></span></label>`;
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
  };
  renderItchMatchFoot();

  itch.busy = true;
  const run = ++itch.run; // a newer run (or Back) stops this one
  for (const row of itch.rows) {
    try {
      const q = new URLSearchParams({ title: row.item.title, url: row.item.url || "", serial: row.item.serial || "" });
      row.match = await api("GET", `/api/vndb/match?${q}`);
    } catch (e) {
      row.match = { confidence: "error" };
    }
    const el = $(`#match-${row.i}`);
    if (run !== itch.run || !el || !$("#itchDialog").open) return;
    row.use = ["serial", "link", "title"].includes(row.match.confidence);
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
  let added = 0;
  for (const row of itch.rows) {
    renderItchMatchFoot(`Importing ${added + 1}/${itch.rows.length}…`);
    const it = row.item;
    let game = { title: it.title, brand: it.developer, cover: it.cover };
    try {
      if (row.use && row.match?.vn) {
        const d = await api("GET", `/api/vndb/vn/${encodeURIComponent(row.match.vn.id)}`);
        game = {
          title: d.title, originalTitle: d.originalTitle, released: d.released,
          brand: d.brand || it.developer, cover: d.cover || it.cover,
          description: d.description, routes: d.routes, vndbId: d.vndbId,
        };
      }
      const where = itch.source === "scan"
        ? { platform: it.platform, format: "emulated", emulator: it.emulator, romPath: it.romPath, serial: it.serial, source: "scan" }
        : { platform: "pc", format: "pc", exePath: "", itchGameId: it.itchGameId, itchUrl: it.url, source: "itch" };
      const saved = await api("POST", "/api/games", {
        ...game, ...where, category: row.category, status: "unplayed", rating: 0, routes: game.routes || [],
      });
      replaceGame(saved);
      it.imported = true;
      added++;
    } catch (e) {
      toast(`${it.title}: ${e.message}`, "error");
    }
  }
  itch.selected.clear();
  $("#itchDialog").close();
  render();
  toast(`Imported ${added} game${added === 1 ? "" : "s"}${itch.source === "itch" ? " from itch.io" : ""}`);
}

// ---------- global wiring ----------

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (e) {}
}

$("#themeBtn").onclick = () => {
  const cur = document.documentElement.dataset.theme;
  setTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
};
$("#addBtn").onclick = () => openEdit(null);
$("#settingsBtn").onclick = openSettings;
$("#itchBtn").onclick = openItch;
$("#scanBtn").onclick = openScan;
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
})();
