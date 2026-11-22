"use strict";
// Export a tier list as a picture. Draws onto a canvas in one of a few templates; the dialog shows a live preview.
// Uses helpers from app.js ($, $$, esc, toast, inkFor). Images come through /api/img so the canvas isn't tainted.

const EXPORT_OPTS_KEY = "tierExport";

/** Each template is data plus a few painters, so adding another is mostly picking colours. */
const EXPORT_TEMPLATES = {
  pastel: {
    name: "Pastel", blurb: "soft blush, rounded cards",
    labelW: 132, rowPad: 14, rowGap: 14, radius: 20, cardRadius: 10, pad: 56,
    title: { font: '600 {s}px "Cormorant Garamond", Georgia, serif', color: "#c4578a", align: "center", size: 78, ornament: "✦" },
    sub: { color: "#8d7584" }, names: { color: "#8d7584" }, footer: { color: "#b49aa9" },
    rowFill: "#ffffff", rowStroke: "#eedde7", rowShadow: "rgba(150,80,120,.14)", labelStyle: "block",
    cardStroke: "#ffffff", cardShadow: "rgba(150,80,120,.28)", emptyColor: "#d9c7d1",
    bg(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#fbf5f8"); g.addColorStop(1, "#ece4fa");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (const [x, y, r, c] of [[0.08, 0.02, 0.5, "#f6dbe8"], [0.98, 0.05, 0.42, "#dcd2f7"], [0.5, 1.02, 0.5, "#f6dbe8"]]) {
        const rg = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r * 0.7);
        rg.addColorStop(0, c + "cc"); rg.addColorStop(1, c + "00");
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
    },
  },
  noir: {
    name: "Noir gold", blurb: "dark plum with gold trim",
    labelW: 132, rowPad: 14, rowGap: 12, radius: 14, cardRadius: 6, pad: 56,
    title: { font: '600 {s}px "Cormorant Garamond", Georgia, serif', color: "#d6b06a", align: "center", size: 78, ornament: "◆" },
    sub: { color: "#a8939f" }, names: { color: "#b9a5ae" }, footer: { color: "#7d6a76" },
    rowFill: "#1d1622", rowStroke: "#3b2d42", rowShadow: "rgba(0,0,0,.5)", labelStyle: "block",
    cardStroke: "#d6b06a88", cardShadow: "rgba(0,0,0,.6)", emptyColor: "#3b2d42",
    bg(ctx, W, H) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#241830"); g.addColorStop(1, "#0e0a11");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const rg = ctx.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, W * 0.8);
      rg.addColorStop(0, "#5a2a4a88"); rg.addColorStop(1, "#5a2a4a00");
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#d6b06a"; ctx.lineWidth = 3; ctx.strokeRect(18, 18, W - 36, H - 36);
      ctx.strokeStyle = "#d6b06a55"; ctx.lineWidth = 1; ctx.strokeRect(28, 28, W - 56, H - 56);
    },
  },
  classic: {
    name: "Classic", blurb: "the familiar tier-maker look",
    labelW: 120, rowPad: 8, rowGap: 3, radius: 0, cardRadius: 0, pad: 36,
    title: { font: '700 {s}px "Segoe UI", Arial, sans-serif', color: "#ffffff", align: "left", size: 46, ornament: "" },
    sub: { color: "#b0b0b0" }, names: { color: "#d0d0d0" }, footer: { color: "#777777" },
    rowFill: "#2b2b2b", rowStroke: "", rowShadow: "", labelStyle: "full",
    cardStroke: "", cardShadow: "", emptyColor: "#444444",
    bg(ctx, W, H) { ctx.fillStyle = "#141414"; ctx.fillRect(0, 0, W, H); },
  },
  minimal: {
    name: "Minimal", blurb: "clean white, thin lines",
    labelW: 110, rowPad: 12, rowGap: 0, radius: 0, cardRadius: 4, pad: 56,
    title: { font: '600 {s}px "Cormorant Garamond", Georgia, serif', color: "#222222", align: "left", size: 64, ornament: "" },
    sub: { color: "#888888" }, names: { color: "#666666" }, footer: { color: "#aaaaaa" },
    rowFill: "", rowStroke: "#e3e3e3", rowShadow: "", labelStyle: "rule",
    cardStroke: "#e3e3e3", cardShadow: "", emptyColor: "#dddddd",
    bg(ctx, W, H) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); },
  },
};

const exportSizes = { card: { s: 84, m: 108, l: 140 }, width: [1200, 1600, 2000] };
const imageCache = new Map(); // url -> Promise<HTMLImageElement|null>

function loadExportImage(url) {
  if (!url) return Promise.resolve(null);
  if (!imageCache.has(url)) {
    const src = url.startsWith("/") ? url : `/api/img?u=${encodeURIComponent(url)}`;
    imageCache.set(url, new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    }));
  }
  return imageCache.get(url);
}

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/** Draw an image cropped to fill w x h, keeping the top (faces) in view. */
function drawCover(ctx, img, x, y, w, h, r, T, letter) {
  ctx.save();
  if (T.cardShadow) { ctx.shadowColor = T.cardShadow; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4; ctx.fillStyle = "#000"; rr(ctx, x, y, w, h, r); ctx.fill(); }
  ctx.restore();
  ctx.save();
  rr(ctx, x, y, w, h, r); ctx.clip();
  if (img) {
    const tr = w / h, ar = img.width / img.height;
    let sw, sh, sx = 0;
    if (ar > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; } else { sw = img.width; sh = sw / tr; }
    ctx.drawImage(img, sx, 0, sw, sh, x, y, w, h);
  } else {
    ctx.fillStyle = T.emptyColor; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#fff"; ctx.font = `600 ${Math.round(w * 0.4)}px "Segoe UI", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(letter || "?", x + w / 2, y + h / 2);
  }
  ctx.restore();
  if (T.cardStroke) { ctx.save(); ctx.strokeStyle = T.cardStroke; ctx.lineWidth = 2; rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore(); }
}

/** Lay out and draw the whole picture. opts: {template, title, subtitle, footer, card, width, names, unranked, hideEmpty}. */
async function renderTierImage(canvas, opts, list, items) {
  const T = EXPORT_TEMPLATES[opts.template] || EXPORT_TEMPLATES.pastel;
  try { await document.fonts.load('600 40px "Cormorant Garamond"'); } catch (e) { /* falls back to Georgia */ }

  const rows = list.tiers.map((t) => ({ ...t, items: items.filter((it) => it.tier === t.id) }));
  if (opts.unranked) rows.push({ id: "", name: "Unranked", color: "#8a93b3", items: items.filter((it) => !it.tier) });
  const shown = rows.filter((r) => r.items.length || !opts.hideEmpty);

  const W = opts.width, cardW = exportSizes.card[opts.card] || 108, cardH = Math.round(cardW * 1.5), gap = 10;
  const nameH = opts.names ? 30 : 0;
  const innerW = W - T.pad * 2 - T.labelW - T.rowPad * 2;
  const per = Math.max(1, Math.floor((innerW + gap) / (cardW + gap)));
  const cellH = cardH + nameH;
  const rowH = (n) => Math.max(1, Math.ceil(n / per)) * cellH + (Math.max(1, Math.ceil(n / per)) - 1) * gap + T.rowPad * 2;

  const titleH = opts.title ? T.title.size + 36 : 8;
  const subH = opts.subtitle ? 40 : 0;
  const footH = opts.footer ? 50 : 24;
  const top = T.pad + titleH + subH;
  const H = Math.round(top + shown.reduce((s, r) => s + rowH(r.items.length) + T.rowGap, 0) + footH + T.pad * 0.5);

  const scale = Math.min(1, 15000 / H); // browsers refuse enormous canvases
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  T.bg(ctx, W, H);

  // title
  ctx.textBaseline = "alphabetic";
  if (opts.title) {
    ctx.font = T.title.font.replace("{s}", T.title.size);
    ctx.fillStyle = T.title.color;
    const cx = T.title.align === "center" ? W / 2 : T.pad;
    ctx.textAlign = T.title.align;
    const y = T.pad + T.title.size * 0.8;
    ctx.fillText(opts.title, cx, y);
    if (T.title.ornament && T.title.align === "center") {
      const w = ctx.measureText(opts.title).width;
      ctx.font = `${Math.round(T.title.size * 0.5)}px "Segoe UI Symbol", sans-serif`;
      ctx.fillText(T.title.ornament, W / 2 - w / 2 - 44, y - T.title.size * 0.18);
      ctx.fillText(T.title.ornament, W / 2 + w / 2 + 44, y - T.title.size * 0.18);
    }
  }
  if (opts.subtitle) {
    ctx.font = '400 22px "Segoe UI", sans-serif'; ctx.fillStyle = T.sub.color;
    ctx.textAlign = T.title.align === "center" ? "center" : "left";
    ctx.fillText(opts.subtitle, T.title.align === "center" ? W / 2 : T.pad, T.pad + titleH + 14);
  }

  // load every picture before drawing the rows
  const imgs = new Map();
  const all = shown.flatMap((r) => r.items);
  for (let i = 0; i < all.length; i += 12) {
    await Promise.all(all.slice(i, i + 12).map(async (it) => imgs.set(it.key, await loadExportImage(it.img))));
  }

  // rows
  let y = top;
  const x0 = T.pad, rowW = W - T.pad * 2;
  for (const row of shown) {
    const h = rowH(row.items.length);
    ctx.save();
    if (T.rowFill) {
      if (T.rowShadow) { ctx.shadowColor = T.rowShadow; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6; }
      ctx.fillStyle = T.rowFill; rr(ctx, x0, y, rowW, h, T.radius); ctx.fill();
    }
    ctx.restore();
    if (T.rowStroke) {
      ctx.save(); ctx.strokeStyle = T.rowStroke; ctx.lineWidth = 1.5;
      if (T.labelStyle === "rule") { ctx.beginPath(); ctx.moveTo(x0, y + h); ctx.lineTo(x0 + rowW, y + h); ctx.stroke(); }
      else { rr(ctx, x0, y, rowW, h, T.radius); ctx.stroke(); }
      ctx.restore();
    }

    // label
    const ink = inkFor(row.color);
    ctx.save();
    if (T.labelStyle === "full") {            // classic: colour block the full height of the row
      ctx.fillStyle = row.color; ctx.fillRect(x0, y, T.labelW, h);
    } else if (T.labelStyle === "block") {    // rounded block inside the row
      ctx.fillStyle = row.color; rr(ctx, x0 + 8, y + 8, T.labelW - 8, h - 16, Math.max(8, T.radius - 6)); ctx.fill();
    } else {                                  // minimal: coloured letters and a short rule
      ctx.fillStyle = row.color; ctx.fillRect(x0, y + 12, 5, h - 24);
    }
    ctx.restore();
    const lcx = x0 + (T.labelStyle === "rule" ? 22 + (T.labelW - 22) / 2 : T.labelStyle === "block" ? 8 + (T.labelW - 8) / 2 : T.labelW / 2);
    const label = row.name;
    const fs = label.length > 9 ? 17 : label.length > 4 ? 26 : label.length > 2 ? 40 : 56;
    ctx.fillStyle = T.labelStyle === "rule" ? row.color : ink;
    ctx.font = `700 ${fs}px ${T.title.font.includes("Cormorant") ? '"Cormorant Garamond", Georgia, serif' : '"Segoe UI", Arial, sans-serif'}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const maxLabelW = T.labelW - 28;
    if (ctx.measureText(label).width > maxLabelW && label.includes(" ")) { // wrap long names onto lines
      const words = label.split(" "); const lines = []; let cur = "";
      for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (ctx.measureText(next).width > maxLabelW && cur) { lines.push(cur); cur = w; } else cur = next; }
      lines.push(cur);
      const lh = fs * 1.15;
      lines.slice(0, 4).forEach((ln, i, a) => ctx.fillText(fitText(ctx, ln, maxLabelW), lcx, y + h / 2 + (i - (a.length - 1) / 2) * lh));
    } else ctx.fillText(fitText(ctx, label, maxLabelW), lcx, y + h / 2);

    // cards
    const ax = x0 + T.labelW + T.rowPad + (T.labelStyle === "block" ? 6 : 0);
    row.items.forEach((it, i) => {
      const cx = ax + (i % per) * (cardW + gap), cy = y + T.rowPad + Math.floor(i / per) * (cellH + gap);
      drawCover(ctx, imgs.get(it.key), cx, cy, cardW, cardH, T.cardRadius, T, (it.label || "?")[0]);
      if (opts.names) {
        ctx.font = '500 13px "Segoe UI", "Yu Gothic UI", sans-serif'; ctx.fillStyle = T.names.color;
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillText(fitText(ctx, it.label || "", cardW + 6), cx + cardW / 2, cy + cardH + 20);
      }
    });
    y += h + T.rowGap;
  }

  if (opts.footer) {
    ctx.font = '400 17px "Segoe UI", sans-serif'; ctx.fillStyle = T.footer.color;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(opts.footer, W / 2, H - T.pad * 0.5 - 6);
  }
  return { w: W, h: H, scale, count: all.length, missing: all.filter((it) => it.img && !imgs.get(it.key)).length };
}

function openTierExport(list, items) {
  let dlg = $("#exportDialog");
  if (!dlg) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="exportDialog" class="sheet wide">
        <header class="sheet-head"><h2>Export tier list as an image</h2><button type="button" class="icon" data-close aria-label="Close">✕</button></header>
        <div class="export-body">
          <div class="export-opts">
            <div><b class="side-h">Template</b><div id="exTemplates" class="ex-templates"></div></div>
            <label>Title <input id="exTitle" maxlength="80"></label>
            <label>Subtitle <input id="exSub" maxlength="100" placeholder="optional"></label>
            <label>Footer <input id="exFoot" maxlength="100" placeholder="optional, e.g. your name"></label>
            <div class="row"><label>Card size <select id="exCard"><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select></label>
              <label>Width <select id="exWidth">${exportSizes.width.map((w) => `<option value="${w}">${w}px</option>`).join("")}</select></label></div>
            <label class="inline"><input type="checkbox" id="exNames"> Show names under cards</label>
            <label class="inline"><input type="checkbox" id="exHide"> Hide empty tiers</label>
            <label class="inline"><input type="checkbox" id="exUnranked"> Include the Unranked row</label>
            <small id="exInfo" class="muted"></small>
          </div>
          <div class="export-preview"><canvas id="exCanvas"></canvas><p id="exBusy" class="muted">Drawing…</p></div>
        </div>
        <footer class="sheet-foot">
          <button type="button" class="ghost" data-close>Close</button>
          <button type="button" class="ghost" id="exCopy">Copy image</button>
          <button type="button" class="primary" id="exSave">Download PNG</button>
        </footer>
      </dialog>`);
    dlg = $("#exportDialog");
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(EXPORT_OPTS_KEY)) || {}; } catch (e) {}
  const o = { template: "pastel", title: list.name, subtitle: "", footer: "", card: "m", width: 1600, names: false, hideEmpty: true,
              unranked: false, ...saved, title: list.name }; // the title always starts as this list's name
  const set = () => {
    $("#exTemplates", dlg).innerHTML = Object.entries(EXPORT_TEMPLATES).map(([k, t]) =>
      `<button type="button" class="chip ex-t" data-tpl="${k}" aria-pressed="${o.template === k}"><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small></button>`).join("");
    $("#exTitle", dlg).value = o.title; $("#exSub", dlg).value = o.subtitle; $("#exFoot", dlg).value = o.footer;
    $("#exCard", dlg).value = o.card; $("#exWidth", dlg).value = String(o.width);
    $("#exNames", dlg).checked = o.names; $("#exHide", dlg).checked = o.hideEmpty; $("#exUnranked", dlg).checked = o.unranked;
  };
  set();

  let run = 0, timer = null;
  const draw = async () => {
    const mine = ++run;
    $("#exBusy", dlg).hidden = false;
    const info = await renderTierImage($("#exCanvas", dlg), o, list, items);
    if (mine !== run) return;
    $("#exBusy", dlg).hidden = true;
    $("#exInfo", dlg).textContent = `${info.w}×${Math.round(info.h)} px · ${info.count} cards${info.scale < 1 ? " · scaled down to fit the browser's size limit" : ""}`
      + (info.missing ? ` · ⚠ ${info.missing} picture${info.missing === 1 ? "" : "s"} couldn't load. If most are missing, close the library window and start it again (start-library.bat) so the new image route is running.` : "");
    try { localStorage.setItem(EXPORT_OPTS_KEY, JSON.stringify({ ...o, title: "" })); } catch (e) {}
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(draw, 200); };

  const read = () => {
    o.title = $("#exTitle", dlg).value; o.subtitle = $("#exSub", dlg).value; o.footer = $("#exFoot", dlg).value;
    o.card = $("#exCard", dlg).value; o.width = +$("#exWidth", dlg).value;
    o.names = $("#exNames", dlg).checked; o.hideEmpty = $("#exHide", dlg).checked; o.unranked = $("#exUnranked", dlg).checked;
    soon();
  };
  dlg.oninput = read; dlg.onchange = read;
  dlg.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tpl]");
    if (t) { o.template = t.dataset.tpl; $$("[data-tpl]", dlg).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); soon(); }
  });
  $("#exSave", dlg).onclick = () => $("#exCanvas", dlg).toBlob((blob) => {
    if (!blob) return toast("Couldn't make the image (is it too large?)", "error");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(o.title || list.name).replace(/[^\w぀-ヿ一-鿿-]+/g, "-").replace(/^-|-$/g, "") || "tier-list"}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
  $("#exCopy", dlg).hidden = !(navigator.clipboard && window.ClipboardItem);
  $("#exCopy", dlg).onclick = () => $("#exCanvas", dlg).toBlob(async (blob) => {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Image copied"); }
    catch (e) { toast("Couldn't copy: use Download instead", "error"); }
  }, "image/png");

  dlg.showModal();
  draw();
}
