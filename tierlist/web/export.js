"use strict";
// Export the tier list as a picture: 8 styles, auto-height widths and fixed frames (social, wallpaper, print).
// Uses helpers from app.js ($, $$, esc, toast, inkFor, imgSrc, state).

const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = '"Segoe UI", "Yu Gothic UI", Arial, sans-serif';
const stars = (() => { // deterministic sprinkle so the preview doesn't flicker
  let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647);
})();

const EXPORT_STYLES = {
  pastel: {
    name: "Pastel", blurb: "soft blush, rounded cards", swatch: ["#fbf5f8", "#c4578a", "#ece4fa"],
    labelW: 132, rowPad: 14, rowGap: 14, radius: 20, cardRadius: 10, pad: 56, labelStyle: "block",
    titleFont: `600 {s}px ${SERIF}`, labelFont: SERIF, title: "#c4578a", titleAlign: "center", titleSize: 78, ornament: "✦",
    sub: "#8d7584", names: "#8d7584", footer: "#b49aa9", rowFill: "#ffffff", rowStroke: "#eedde7", rowShadow: "rgba(150,80,120,.14)",
    cardStroke: "#ffffff", cardShadow: "rgba(150,80,120,.28)", empty: "#d9c7d1",
    bg(c, W, H) {
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#fbf5f8"); g.addColorStop(1, "#ece4fa"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[0.08, 0.02, 0.5, "#f6dbe8"], [0.98, 0.05, 0.42, "#dcd2f7"], [0.5, 1.02, 0.5, "#f6dbe8"]]) {
        const rg = c.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r * 0.7); rg.addColorStop(0, col + "cc"); rg.addColorStop(1, col + "00"); c.fillStyle = rg; c.fillRect(0, 0, W, H);
      }
    },
  },
  noir: {
    name: "Noir gold", blurb: "dark plum with gold trim", swatch: ["#241830", "#d6b06a", "#0e0a11"],
    labelW: 132, rowPad: 14, rowGap: 12, radius: 14, cardRadius: 6, pad: 56, labelStyle: "block",
    titleFont: `600 {s}px ${SERIF}`, labelFont: SERIF, title: "#d6b06a", titleAlign: "center", titleSize: 78, ornament: "◆",
    sub: "#a8939f", names: "#b9a5ae", footer: "#7d6a76", rowFill: "#1d1622", rowStroke: "#3b2d42", rowShadow: "rgba(0,0,0,.5)",
    cardStroke: "#d6b06a88", cardShadow: "rgba(0,0,0,.6)", empty: "#3b2d42",
    bg(c, W, H, k) {
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#241830"); g.addColorStop(1, "#0e0a11"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      const rg = c.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, W * 0.8); rg.addColorStop(0, "#5a2a4a88"); rg.addColorStop(1, "#5a2a4a00"); c.fillStyle = rg; c.fillRect(0, 0, W, H);
      c.strokeStyle = "#d6b06a"; c.lineWidth = 3 * k; c.strokeRect(18 * k, 18 * k, W - 36 * k, H - 36 * k);
      c.strokeStyle = "#d6b06a55"; c.lineWidth = k; c.strokeRect(28 * k, 28 * k, W - 56 * k, H - 56 * k);
    },
  },
  classic: {
    name: "Classic", blurb: "the familiar tier-maker look", swatch: ["#141414", "#ffffff", "#ff7f7f"],
    labelW: 120, rowPad: 8, rowGap: 3, radius: 0, cardRadius: 0, pad: 36, labelStyle: "full",
    titleFont: `700 {s}px ${SANS}`, labelFont: SANS, title: "#ffffff", titleAlign: "left", titleSize: 46, ornament: "",
    sub: "#b0b0b0", names: "#d0d0d0", footer: "#777777", rowFill: "#2b2b2b", rowStroke: "", rowShadow: "", cardStroke: "", cardShadow: "", empty: "#444444",
    bg(c, W, H) { c.fillStyle = "#141414"; c.fillRect(0, 0, W, H); },
  },
  minimal: {
    name: "Minimal", blurb: "clean white, thin lines", swatch: ["#ffffff", "#222222", "#e3e3e3"],
    labelW: 110, rowPad: 12, rowGap: 0, radius: 0, cardRadius: 4, pad: 56, labelStyle: "rule",
    titleFont: `600 {s}px ${SERIF}`, labelFont: SERIF, title: "#222222", titleAlign: "left", titleSize: 64, ornament: "",
    sub: "#888888", names: "#666666", footer: "#aaaaaa", rowFill: "", rowStroke: "#e3e3e3", rowShadow: "", cardStroke: "#e3e3e3", cardShadow: "", empty: "#dddddd",
    bg(c, W, H) { c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H); },
  },
  neon: {
    name: "Neon", blurb: "dark glass, glowing edges", swatch: ["#0a0d1f", "#22e0ff", "#ff3dcb"],
    labelW: 130, rowPad: 14, rowGap: 14, radius: 12, cardRadius: 8, pad: 52, labelStyle: "outline",
    titleFont: `700 {s}px "Orbitron", ${SANS}`, labelFont: `"Orbitron", ${SANS}`, title: "#22e0ff", titleAlign: "center", titleSize: 62, ornament: "",
    glow: "#22e0ff", sub: "#9aa6d8", names: "#b8c2f0", footer: "#6f7bb0", rowFill: "rgba(20,26,60,.72)", rowStroke: "tier", rowLine: 2, rowGlow: 14,
    cardStroke: "#ffffff33", cardShadow: "rgba(0,0,0,.6)", empty: "#26305f",
    bg(c, W, H) {
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#0a0d1f"); g.addColorStop(1, "#1a0a30"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (const [x, y, col] of [[0.1, 0.1, "#22e0ff"], [0.95, 0.9, "#ff3dcb"]]) {
        const rg = c.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * 0.5); rg.addColorStop(0, col + "33"); rg.addColorStop(1, col + "00"); c.fillStyle = rg; c.fillRect(0, 0, W, H);
      }
      c.strokeStyle = "#ffffff08"; c.lineWidth = 1;
      for (let x = 0; x < W; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      for (let y = 0; y < H; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    },
  },
  washi: {
    name: "Washi", blurb: "warm paper, vermilion ink", swatch: ["#f6eddc", "#b8322a", "#2b2118"],
    labelW: 128, rowPad: 14, rowGap: 10, radius: 4, cardRadius: 3, pad: 56, labelStyle: "full",
    titleFont: `700 {s}px ${SERIF}`, labelFont: SERIF, title: "#b8322a", titleAlign: "center", titleSize: 74, ornament: "❀",
    sub: "#7b6a55", names: "#4a3b2a", footer: "#9a8a72", rowFill: "#fbf5e8", rowStroke: "#d8c8a6", rowShadow: "rgba(90,60,20,.12)",
    cardStroke: "#fbf5e8", cardShadow: "rgba(70,40,10,.3)", empty: "#d8c8a6",
    bg(c, W, H, k) {
      c.fillStyle = "#f2e7d0"; c.fillRect(0, 0, W, H);
      const rnd = (() => { let s = 11; return () => ((s = (s * 48271) % 2147483647) / 2147483647); })();
      for (let i = 0; i < Math.min(5000, W * H / 900); i++) { c.fillStyle = `rgba(120,90,40,${0.02 + rnd() * 0.04})`; c.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2 * k, 1 + rnd() * 2 * k); }
      c.strokeStyle = "#b8322a"; c.lineWidth = 4 * k; c.strokeRect(20 * k, 20 * k, W - 40 * k, H - 40 * k);
      c.strokeStyle = "#b8322a88"; c.lineWidth = k; c.strokeRect(30 * k, 30 * k, W - 60 * k, H - 60 * k);
    },
  },
  midnight: {
    name: "Midnight", blurb: "starry blue, frosted rows", swatch: ["#0b1030", "#9fb4ff", "#3a2a78"],
    labelW: 128, rowPad: 14, rowGap: 12, radius: 18, cardRadius: 9, pad: 54, labelStyle: "block",
    titleFont: `600 {s}px ${SERIF}`, labelFont: SERIF, title: "#dfe6ff", titleAlign: "center", titleSize: 76, ornament: "✧",
    sub: "#9fb0e6", names: "#c9d3ff", footer: "#7482b8", rowFill: "rgba(255,255,255,.07)", rowStroke: "rgba(190,205,255,.28)", rowShadow: "",
    cardStroke: "rgba(255,255,255,.55)", cardShadow: "rgba(0,0,10,.55)", empty: "#2c3670",
    bg(c, W, H) {
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0b1030"); g.addColorStop(0.6, "#1b1c58"); g.addColorStop(1, "#3a2a78"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      const n = Math.min(420, Math.round(W * H / 5000));
      for (let i = 0; i < n; i++) { const x = stars() * W, y = stars() * H, r = 0.4 + stars() * 1.6; c.fillStyle = `rgba(255,255,255,${0.25 + stars() * 0.7})`; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
      const m = c.createRadialGradient(W * 0.88, H * 0.06, 0, W * 0.88, H * 0.06, W * 0.3); m.addColorStop(0, "#9fb4ff55"); m.addColorStop(1, "#9fb4ff00"); c.fillStyle = m; c.fillRect(0, 0, W, H);
    },
  },
  arcade: {
    name: "Arcade", blurb: "pixel font, hard shadows", swatch: ["#120f1f", "#ffe14d", "#ff4d6d"],
    labelW: 140, rowPad: 12, rowGap: 14, radius: 0, cardRadius: 0, pad: 44, labelStyle: "stamp",
    titleFont: `400 {s}px "Press Start 2P", "Courier New", monospace`, labelFont: `"Press Start 2P", "Courier New", monospace`, title: "#ffe14d", titleAlign: "left", titleSize: 38, ornament: "",
    hardShadow: "#000000", sub: "#8ee6ff", names: "#f1f1f1", footer: "#8a86a8", rowFill: "#241d3b", rowStroke: "#ffffff", rowLine: 4,
    cardStroke: "#000000", cardShadow: "", empty: "#3a3160", mono: true,
    bg(c, W, H, k) {
      c.fillStyle = "#120f1f"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ffffff0a"; const s = 8 * k;
      for (let y = 0; y < H; y += s * 2) c.fillRect(0, y, W, s);
      c.fillStyle = "#ff4d6d"; c.fillRect(0, 0, W, 10 * k); c.fillStyle = "#ffe14d"; c.fillRect(0, 10 * k, W, 5 * k);
    },
  },
};

// card widths at base scale; the "fit" frames pick their own
const CARD_SIZES = { 60: "Tiny", 78: "Small", 100: "Medium", 130: "Large", 170: "Extra large", 220: "Huge" };
const EXPORT_SIZES = [
  ["auto:1000", "Auto height · 1000 px wide"], ["auto:1200", "Auto height · 1200 px wide"], ["auto:1600", "Auto height · 1600 px wide"],
  ["auto:2000", "Auto height · 2000 px wide"], ["auto:2560", "Auto height · 2560 px wide"], ["auto:3200", "Auto height · 3200 px wide"],
  ["fix:1080x1080", "Square · 1080×1080 (Instagram post)"], ["fix:1080x1350", "Portrait · 1080×1350 (Instagram 4:5)"],
  ["fix:1080x1920", "Story / Reel · 1080×1920"], ["fix:1600x900", "Landscape · 1600×900 (X / Twitter)"],
  ["fix:1280x720", "Landscape · 1280×720 (Discord, YouTube)"], ["fix:1920x1080", "Full HD · 1920×1080"],
  ["fix:2560x1440", "QHD wallpaper · 2560×1440"], ["fix:3840x2160", "4K wallpaper · 3840×2160"],
  ["fix:1170x2532", "Phone wallpaper · 1170×2532"], ["fix:2480x3508", "A4 print · 2480×3508 (300 dpi)"],
  ["fix:3508x2480", "A4 landscape · 3508×2480 (300 dpi)"],
];
const EXPORT_KEY = "tierlistStudio.export";
const imgCache = new Map();

function loadImg(url) {
  if (!url) return Promise.resolve(null);
  if (!imgCache.has(url)) imgCache.set(url, new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = imgSrc(url); }));
  return imgCache.get(url);
}
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function fit(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  let s = text; while (s.length > 1 && c.measureText(s + "…").width > maxW) s = s.slice(0, -1); return s + "…";
}
function wrap2(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return [text, ""];
  const w = text.split(" "); let l1 = w[0], i = 1;
  while (i < w.length && c.measureText(l1 + " " + w[i]).width <= maxW) l1 += " " + w[i++];
  return [l1, w.slice(i).join(" ")];
}


function headerMetrics(T, o, k) {
  // titleScale / subScale / headGap are percentages from the export dialog (100 = the style's default)
  const pad = T.pad * k, titleSize = T.titleSize * k * (+o.titleScale || 100) / 100;
  const g = Math.max(0, (o.headGap ?? 100)) / 100, subFont = 22 * k * (+o.subScale || 100) / 100;
  const titleH = o.title ? titleSize + 36 * k * g : 8 * k * g;
  const subH = o.subtitle ? subFont * 0.64 + subFont * 1.15 * g : 0, footH = o.footer ? 50 * k : 24 * k;
  return { pad, titleSize, titleH, subH, subFont, footH, top: pad + titleH + subH };
}
function drawHeader(c, T, o, W, k, m) {
  const { pad, titleSize, titleH } = m, align = T.titleAlign;
  c.textBaseline = "alphabetic";
  if (o.title) {
    const maxTitleW = W - pad * 2 - (T.ornament ? 160 * k : 0); let ts = titleSize;
    c.font = T.titleFont.replace("{s}", Math.round(ts)); c.fillStyle = T.title; c.textAlign = align;
    while (c.measureText(o.title).width > maxTitleW && ts > 14 * k) { ts *= 0.95; c.font = T.titleFont.replace("{s}", Math.round(ts)); } // shrink to fit instead of cutting the title off
    if (T.glow) { c.shadowColor = T.glow; c.shadowBlur = 18 * k; }
    const y = pad + titleSize * 0.8, tx = align === "center" ? W / 2 : pad;
    c.fillText(fit(c, o.title, maxTitleW), tx, y);
    c.shadowBlur = 0;
    if (T.ornament && align === "center") {
      const tw = Math.min(c.measureText(o.title).width, maxTitleW);
      c.font = `${Math.round(titleSize * 0.5)}px "Segoe UI Symbol", sans-serif`;
      c.fillText(T.ornament, W / 2 - tw / 2 - 44 * k, y - titleSize * 0.18); c.fillText(T.ornament, W / 2 + tw / 2 + 44 * k, y - titleSize * 0.18);
    }
  }
  if (o.subtitle) {
    const sf = Math.round(m.subFont * (T.mono ? 0.64 : 1));
    c.font = T.mono ? `400 ${sf}px ${T.labelFont}` : `400 ${sf}px ${SANS}`; c.fillStyle = T.sub; c.textAlign = align === "center" ? "center" : "left";
    c.fillText(fit(c, o.subtitle, W - pad * 2), align === "center" ? W / 2 : pad, pad + titleH + m.subFont * 0.64);
  }
}
function drawFooter(c, T, o, W, H, k, m) {
  if (!o.footer) return;
  c.font = T.mono ? `400 ${Math.round(11 * k)}px ${T.labelFont}` : `400 ${Math.round(17 * k)}px ${SANS}`; c.fillStyle = T.footer; c.textAlign = "center"; c.textBaseline = "alphabetic";
  c.fillText(fit(c, o.footer, W - m.pad * 2), W / 2, H - m.pad * 0.4 - 6 * k);
}
function drawBadge(c, x, y, cw, n, k) {
  const r = Math.max(8 * k, cw * 0.13);
  c.save(); c.fillStyle = "rgba(0,0,0,.72)"; c.beginPath(); c.arc(x + r + 3 * k, y + r + 3 * k, r, 0, 7); c.fill();
  c.fillStyle = "#fff"; c.font = `700 ${Math.round(r * 1.1)}px ${SANS}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n), x + r + 3 * k, y + r + 3.5 * k); c.restore();
}
function frameOf(o) {
  const [mode, dim] = o.size.split(":"); const fixed = mode === "fix"; const [fw, fh] = fixed ? dim.split("x").map(Number) : [+dim, 0];
  const k = fixed ? Math.min(1.8, Math.max(0.5, Math.min(fw, fh) / 1200)) : Math.min(1.5, Math.max(0.65, fw / 1600));
  return { fixed, W: fw, fh, k };
}
async function loadFonts() {
  try { await Promise.all(["600 40px 'Cormorant Garamond'", "700 20px Orbitron", "20px 'Press Start 2P'"].map((f) => document.fonts.load(f))); } catch (e) { /* system fonts */ }
}

async function renderImage(canvas, o) { return state.mode === "venn" ? renderVennImage(canvas, o) : state.mode === "axis" ? renderAxisImage(canvas, o) : renderTierImage(canvas, o); }

function wrapLines(c, text, maxW, maxLines = 3) {
  const words = String(text).split(/\s+/), lines = []; let cur = "";
  for (const w of words) { const nx = cur ? cur + " " + w : w; if (c.measureText(nx).width > maxW && cur) { lines.push(cur); cur = w; } else cur = nx; }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines).map((l) => fit(c, l, maxW));
}
function arrowHead(c, x, y, dx, dy, s) {
  c.beginPath(); c.moveTo(x + dx * s, y + dy * s); c.lineTo(x - dy * s * 0.55, y + dx * s * 0.55); c.lineTo(x + dy * s * 0.55, y - dx * s * 0.55); c.closePath(); c.fill();
}

async function renderAxisImage(canvas, o) {
  const T = EXPORT_STYLES[o.style] || EXPORT_STYLES.pastel, { fixed, W, fh, k } = frameOf(o);
  await loadFonts();
  const a = state.axis, m = headerMetrics(T, o, k), bottom = m.footH + m.pad * 0.4, ratio = a.aspect === "wide" ? 2 / 3 : 1;
  const mx = 118 * k, my = 46 * k, availW = W - m.pad * 2 - mx * 2;
  let plotW, plotH, px, py, H;
  if (fixed) {
    H = fh; const availH = H - m.top - bottom - my * 2; plotW = Math.min(availW, availH / ratio); plotH = plotW * ratio;
    px = W / 2 - plotW / 2; py = m.top + my + (availH - plotH) / 2;
  } else { plotW = availW; plotH = plotW * ratio; H = Math.round(m.top + my * 2 + plotH + bottom); px = m.pad + mx; py = m.top + my; }
  const pxScale = Math.min(+o.scale || 1, Math.sqrt(90e6 / (W * H)), 16000 / H, 16000 / W);
  canvas.width = Math.round(W * pxScale); canvas.height = Math.round(H * pxScale);
  const c = canvas.getContext("2d"); c.setTransform(pxScale, 0, 0, pxScale, 0, 0);
  T.bg(c, W, H, k); drawHeader(c, T, o, W, k, m);

  const dark = ["noir", "neon", "midnight", "arcade", "classic"].includes(o.style);
  const axisCol = a.axisColor || T.title, gridCol = a.gridColor || (dark ? "#ffffff" : T.names), N = a.grid || 0;
  // plot panel and grid
  c.save();
  if (T.rowFill) { c.fillStyle = T.rowFill; rr(c, px, py, plotW, plotH, T.radius * k * 0.5); c.fill(); }
  c.restore();
  if (N) {
    c.save(); c.globalAlpha = a.gridColor ? 0.9 : 0.22; c.strokeStyle = gridCol; c.lineWidth = Math.max(1, 1.3 * k);
    for (let i = 1; i < N; i++) {
      const gx = px + plotW * i / N, gy = py + plotH * i / N;
      c.beginPath(); c.moveTo(gx, py); c.lineTo(gx, py + plotH); c.moveTo(px, gy); c.lineTo(px + plotW, gy); c.stroke();
    }
    c.restore();
  }
  c.save(); c.globalAlpha = a.gridColor ? 1 : 0.5; c.strokeStyle = gridCol; c.lineWidth = 2 * k; rr(c, px, py, plotW, plotH, T.radius * k * 0.5); c.stroke(); c.restore();

  // axes with arrowheads
  const cx = px + plotW / 2, cy = py + plotH / 2, ah = 11 * k;
  c.save(); c.strokeStyle = axisCol; c.fillStyle = axisCol; c.lineWidth = 3.5 * k; if (T.glow) { c.shadowColor = axisCol; c.shadowBlur = 10 * k; }
  c.beginPath(); c.moveTo(px - ah, cy); c.lineTo(px + plotW + ah, cy); c.moveTo(cx, py - ah); c.lineTo(cx, py + plotH + ah); c.stroke();
  arrowHead(c, px - ah, cy, -1, 0, ah * 1.2); arrowHead(c, px + plotW + ah, cy, 1, 0, ah * 1.2);
  arrowHead(c, cx, py - ah, 0, -1, ah * 1.2); arrowHead(c, cx, py + plotH + ah, 0, 1, ah * 1.2);
  c.restore();

  // end labels
  const lf = Math.round(24 * k * (T.mono ? 0.5 : 1)); c.font = `700 ${lf}px ${T.labelFont}`; c.fillStyle = axisCol;
  const side = (txt, x, align) => { c.textAlign = align; c.textBaseline = "middle"; const ls = wrapLines(c, txt, mx - 26 * k); ls.forEach((l, i) => c.fillText(l, x, cy + (i - (ls.length - 1) / 2) * lf * 1.15)); };
  side(a.xMin, px - ah * 2.6, "right"); side(a.xMax, px + plotW + ah * 2.6, "left");
  c.textAlign = "center"; c.textBaseline = "bottom"; c.fillText(fit(c, a.yMax, plotW), cx, py - ah * 2.4);
  c.textBaseline = "top"; c.fillText(fit(c, a.yMin, plotW), cx, py + plotH + ah * 2.4);

  // numbers on the axes
  if (a.numbers && N) {
    c.save(); c.globalAlpha = 0.75; c.fillStyle = T.names; c.font = `500 ${Math.round(12 * k)}px ${SANS}`;
    for (let i = 0; i <= N; i++) {
      const vx = a.nMin + (a.nMax - a.nMin) * i / N, vy = a.nMax - (a.nMax - a.nMin) * i / N;
      c.textAlign = "center"; c.textBaseline = "top"; c.fillText(String(Math.round(vx * 10) / 10), px + plotW * i / N, cy + 7 * k);
      if (i * 2 !== N) { c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(String(Math.round(vy * 10) / 10), cx + 8 * k, py + plotH * i / N); }
    }
    c.restore();
  }
  // corner labels
  c.save(); c.fillStyle = T.sub; c.font = `italic 600 ${Math.round(17 * k)}px ${SANS}`; c.textBaseline = "alphabetic";
  const qm = 12 * k, qw = plotW / 2 - qm * 2;
  c.textAlign = "left"; if (a.quad[0]) c.fillText(fit(c, a.quad[0], qw), px + qm, py + qm + 15 * k); if (a.quad[2]) c.fillText(fit(c, a.quad[2], qw), px + qm, py + plotH - qm);
  c.textAlign = "right"; if (a.quad[1]) c.fillText(fit(c, a.quad[1], qw), px + plotW - qm, py + qm + 15 * k); if (a.quad[3]) c.fillText(fit(c, a.quad[3], qw), px + plotW - qm, py + plotH - qm);
  c.restore();

  // characters
  const items = Object.entries(a.pos).filter(([key]) => state.items[key]).map(([key, p]) => ({ key, p, ...state.items[key] }));
  const imgs = new Map();
  for (let i = 0; i < items.length; i += 16) await Promise.all(items.slice(i, i + 16).map(async (it) => imgs.set(it.key, await loadImg(it.imgHi || it.img))));
  const cw = plotW * (state.ui.axisCard || 7) / 100, ch = cw * 1.25, namesN = +o.names;
  for (const it of items) {
    const x = px + it.p.x * plotW - cw / 2, y = py + it.p.y * plotH - ch / 2;
    drawCard(c, imgs.get(it.key), x, y, cw, ch, T.cardRadius * k, T, it.label, k);
    if (namesN) {
      const fs = Math.max(9 * k, Math.min(22 * k, cw * 0.17));
      c.save(); c.font = `600 ${Math.round(fs)}px ${T.mono ? T.labelFont : SANS}`; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.lineJoin = "round";
      c.lineWidth = 3.5 * k; c.strokeStyle = dark ? "rgba(0,0,0,.7)" : "rgba(255,255,255,.9)"; c.fillStyle = dark ? "#fff" : "#2a2230";
      const t = fit(c, it.label, cw * 1.9); c.strokeText(t, x + cw / 2, y + ch + fs + 2 * k); c.fillText(t, x + cw / 2, y + ch + fs + 2 * k); c.restore();
    }
  }
  drawFooter(c, T, o, W, H, k, m);
  return { w: W, h: H, px: [canvas.width, canvas.height], cards: items.length, card: Math.round(cw), missing: items.filter((it) => (it.imgHi || it.img) && !imgs.get(it.key)).length };
}


async function renderVennImage(canvas, o) {
  const T = EXPORT_STYLES[o.style] || EXPORT_STYLES.pastel, { fixed, W, fh, k } = frameOf(o);
  await loadFonts();
  const v = state.venn, g = vennGeom(v), m = headerMetrics(T, o, k), bottom = m.footH + m.pad * 0.4, availW = W - m.pad * 2;
  let u, H, ox, oy;
  if (fixed) { H = fh; const availH = H - m.top - bottom; u = Math.min(availW / 100, availH / g.vh); ox = m.pad + (availW - 100 * u) / 2; oy = m.top + (availH - g.vh * u) / 2; }
  else { u = availW / 100; H = Math.round(m.top + g.vh * u + bottom); ox = m.pad; oy = m.top; }
  const pxScale = Math.min(+o.scale || 1, Math.sqrt(90e6 / (W * H)), 16000 / H, 16000 / W);
  canvas.width = Math.round(W * pxScale); canvas.height = Math.round(H * pxScale);
  const c = canvas.getContext("2d"); c.setTransform(pxScale, 0, 0, pxScale, 0, 0);
  T.bg(c, W, H, k); drawHeader(c, T, o, W, k, m);

  // circles
  const dark = ["noir", "neon", "midnight", "arcade", "classic"].includes(o.style);
  g.circles.slice(0, v.n).forEach((ci, i) => {
    const col = v.circles[i].color;
    c.save(); c.globalAlpha = dark ? 0.28 : 0.32; c.fillStyle = col; c.beginPath(); c.arc(ox + ci.cx * u, oy + ci.cy * u, ci.r * u, 0, 7); c.fill(); c.restore();
    c.save(); c.strokeStyle = col; c.lineWidth = 3.5 * k; if (T.glow) { c.shadowColor = col; c.shadowBlur = 14 * k; } c.beginPath(); c.arc(ox + ci.cx * u, oy + ci.cy * u, ci.r * u, 0, 7); c.stroke(); c.restore();
  });
  g.labels.slice(0, v.n).forEach((l, i) => {
    const x = ox + l.x * u, y = oy + l.y * u;
    c.font = `700 ${Math.round(26 * k * (T.mono ? 0.55 : 1))}px ${T.labelFont}`; c.fillStyle = v.circles[i].color;
    c.textAlign = l.ax > 0 ? "left" : l.ax < 0 ? "right" : "center"; c.textBaseline = l.ay < 0 ? "bottom" : l.ay > 0 ? "top" : "middle";
    const room = l.ax > 0 ? W - x - 8 * k : l.ax < 0 ? x - 8 * k : Math.min(x, W - x) * 2 - 16 * k;
    c.fillText(fit(c, v.circles[i].name, Math.max(40 * k, room)), x, y);
  });

  // cards: one shared size, as large as every region allows
  const regs = Object.entries(g.regions).map(([key, r]) => ({ key, r, items: (v.regions[key] || []).map((x) => ({ key: x, ...state.items[x] })).filter((it) => it.label) })).filter((q) => q.items.length);
  const all = regs.flatMap((q) => q.items), namesN = +o.names, gap = 6 * k, ratio = 1.25;
  const cellH = (cw) => cw * ratio + (namesN ? Math.max(9 * k, Math.min(24 * k, cw * 0.14)) * 1.3 + 4 * k : 0);
  const cap = Math.max(14 * k, +o.card * k);
  for (const q of regs) q.cw = fitCard(q.items.length, q.r.w * u * 0.86, q.r.h * u * 0.86, cap, 14 * k, gap, ratio, (w) => (namesN ? Math.max(9 * k, Math.min(24 * k, w * 0.14)) * 1.3 + 4 * k : 0));
  const cw0 = Math.min(...regs.map((q) => q.cw));
  const imgs = new Map();
  for (let i = 0; i < all.length; i += 16) await Promise.all(all.slice(i, i + 16).map(async (it) => imgs.set(it.key, await loadImg(it.imgHi || it.img))));
  for (const q of regs) {
    const cw = q.cw, nameFs = Math.max(9 * k, Math.min(24 * k, cw * 0.14)), ch = cw * ratio;
    const bw = q.r.w * u * 0.86, per = Math.max(1, Math.floor((bw + gap) / (cw + gap))), rows = Math.ceil(q.items.length / per);
    const cx = ox + q.r.cx * u, top = oy + q.r.cy * u - (rows * cellH(cw) + (rows - 1) * gap) / 2;
    q.items.forEach((it, i) => {
      const row = Math.floor(i / per), inRow = Math.min(per, q.items.length - row * per), col = i % per;
      const x = cx - (inRow * cw + (inRow - 1) * gap) / 2 + col * (cw + gap), y = top + row * (cellH(cw) + gap);
      drawCard(c, imgs.get(it.key), x, y, cw, ch, T.cardRadius * k, T, it.label, k);
      if (namesN) {
        c.font = `500 ${Math.round(nameFs)}px ${T.mono ? T.labelFont : SANS}`; c.fillStyle = T.names; c.textAlign = "center"; c.textBaseline = "alphabetic";
        c.fillText(fit(c, it.label, cw + gap), x + cw / 2, y + ch + nameFs + 2 * k);
      }
    });
  }
  drawFooter(c, T, o, W, H, k, m);
  return { w: W, h: H, px: [canvas.width, canvas.height], cards: all.length, card: Math.round(cw0), missing: all.filter((it) => (it.imgHi || it.img) && !imgs.get(it.key)).length };
}

/** o: {style,title,subtitle,footer,size,card,names,hideEmpty,pool,scale} */
async function renderTierImage(canvas, o) {
  const T = EXPORT_STYLES[o.style] || EXPORT_STYLES.pastel;
  const [mode, dim] = o.size.split(":");
  const fixed = mode === "fix"; const [fw, fh] = fixed ? dim.split("x").map(Number) : [+dim, 0];
  const W = fw;
  const k = fixed ? Math.min(1.8, Math.max(0.5, Math.min(fw, fh) / 1200)) : Math.min(1.5, Math.max(0.65, W / 1600));
  try { await Promise.all(["600 40px 'Cormorant Garamond'", "700 20px Orbitron", "20px 'Press Start 2P'"].map((f) => document.fonts.load(f))); } catch (e) { /* fall back to system fonts */ }

  const rows = state.tiers.map((t) => ({ name: t.name, color: t.color, items: t.keys.map((x) => ({ key: x, ...state.items[x] })).filter((i) => i.label) }));
  if (o.pool) { const inT = new Set(state.tiers.flatMap((t) => t.keys)); rows.push({ name: "Unranked", color: "#8a93b3", items: state.order.filter((x) => !inT.has(x) && state.items[x]).map((x) => ({ key: x, ...state.items[x] })) }); }
  const shown = rows.filter((r) => r.items.length || !o.hideEmpty);
  const total = shown.reduce((s, r) => s + r.items.length, 0);

  const pad = T.pad * k, labelW = T.labelW * k, rowPad = T.rowPad * k, rowGap = T.rowGap * k, gap = 10 * k;
  const hm = headerMetrics(T, o, k), footH = hm.footH, top = hm.top;
  const innerW = W - pad * 2 - labelW - rowPad * 2;
  const ratio = 1.25;
  const namesN = +o.names;
  const plan = (cardW) => {
    const nameFs = Math.max(10 * k, Math.min(30 * k, cardW * 0.14));
    const nameH = namesN ? (namesN === 2 ? nameFs * 1.2 * 2 + 8 * k : nameFs * 1.2 * 2 + 6 * k) : 0;
    const cardH = cardW * ratio, cellH = cardH + nameH;
    const per = Math.max(1, Math.floor((innerW + gap) / (cardW + gap)));
    const rh = (n) => { const r = Math.max(1, Math.ceil(n / per)); return r * cellH + (r - 1) * gap + rowPad * 2; };
    return { cardW, cardH, cellH, per, nameFs, rh, H: top + shown.reduce((s, r) => s + rh(r.items.length) + rowGap, 0) + footH + pad * 0.4 };
  };
  let P;
  if (fixed) {
    let lo = 18 * k, hi = Math.min(innerW, 400 * k);
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (plan(mid).H <= fh) lo = mid; else hi = mid; }
    P = plan(Math.floor(lo));
  } else P = plan(+o.card * k);
  const H = fixed ? Math.max(fh, Math.round(P.H)) : Math.round(P.H);
  const extra = fixed ? (H - P.H) / Math.max(1, shown.length) : 0; // spread any leftover height between the rows
  const pxScale = Math.min(+o.scale || 1, Math.sqrt(90e6 / (W * H)), 16000 / H, 16000 / W);
  canvas.width = Math.round(W * pxScale); canvas.height = Math.round(H * pxScale);
  const c = canvas.getContext("2d");
  c.setTransform(pxScale, 0, 0, pxScale, 0, 0);
  T.bg(c, W, H, k);

  drawHeader(c, T, o, W, k, hm);

  const imgs = new Map(); const all = shown.flatMap((r) => r.items);
  for (let i = 0; i < all.length; i += 16) await Promise.all(all.slice(i, i + 16).map(async (it) => imgs.set(it.key, await loadImg(it.imgHi || it.img))));

  let y = top; const x0 = pad, rowW = W - pad * 2;
  for (const row of shown) {
    const h = P.rh(row.items.length) + extra;
    const stroke = T.rowStroke === "tier" ? row.color : T.rowStroke;
    c.save();
    if (T.rowFill) {
      if (T.rowShadow) { c.shadowColor = T.rowShadow; c.shadowBlur = 18 * k; c.shadowOffsetY = 6 * k; }
      if (T.hardShadow) { c.fillStyle = T.hardShadow; c.fillRect(x0 + 8 * k, y + 8 * k, rowW, h); }
      c.fillStyle = T.rowFill; rr(c, x0, y, rowW, h, T.radius * k); c.fill();
    }
    c.restore();
    if (stroke) {
      c.save(); c.strokeStyle = stroke; c.lineWidth = (T.rowLine || 1.5) * k;
      if (T.rowGlow) { c.shadowColor = row.color; c.shadowBlur = T.rowGlow * k; }
      if (T.labelStyle === "rule") { c.beginPath(); c.moveTo(x0, y + h); c.lineTo(x0 + rowW, y + h); c.stroke(); } else { rr(c, x0, y, rowW, h, T.radius * k); c.stroke(); }
      c.restore();
    }
    // label
    const ink = inkFor(row.color); let lx0 = x0, lw = labelW;
    c.save();
    if (T.labelStyle === "full") { c.fillStyle = row.color; c.fillRect(x0, y, labelW, h); }
    else if (T.labelStyle === "block") { c.fillStyle = row.color; rr(c, x0 + 8 * k, y + 8 * k, labelW - 8 * k, h - 16 * k, Math.max(8, T.radius - 6) * k); c.fill(); lx0 = x0 + 8 * k; lw = labelW - 8 * k; }
    else if (T.labelStyle === "rule") { c.fillStyle = row.color; c.fillRect(x0, y + 12 * k, 5 * k, h - 24 * k); lx0 = x0 + 22 * k; lw = labelW - 22 * k; }
    else if (T.labelStyle === "outline") { c.fillStyle = row.color + "22"; c.strokeStyle = row.color; c.lineWidth = 2 * k; c.shadowColor = row.color; c.shadowBlur = 12 * k; rr(c, x0 + 10 * k, y + 10 * k, labelW - 10 * k, h - 20 * k, 8 * k); c.fill(); c.stroke(); lx0 = x0 + 10 * k; lw = labelW - 10 * k; }
    else if (T.labelStyle === "stamp") { c.fillStyle = "#000"; c.fillRect(x0 + 6 * k, y + 6 * k, labelW - 6 * k + 6 * k, h - 12 * k + 6 * k); c.fillStyle = row.color; c.fillRect(x0 + 6 * k, y + 6 * k, labelW - 6 * k, h - 12 * k); c.strokeStyle = "#fff"; c.lineWidth = 3 * k; c.strokeRect(x0 + 6 * k, y + 6 * k, labelW - 6 * k, h - 12 * k); lx0 = x0 + 6 * k; lw = labelW - 6 * k; }
    c.restore();
    const lcx = lx0 + lw / 2, label = row.name, mono = !!T.mono, maxLW = lw - 24 * k;
    const base = label.length > 9 ? 17 : label.length > 4 ? 26 : label.length > 2 ? 40 : 56;
    const fs = Math.round(base * k * (mono ? 0.55 : 1));
    c.fillStyle = T.labelStyle === "rule" || T.labelStyle === "outline" ? row.color : ink;
    c.font = `700 ${fs}px ${T.labelFont}`; c.textAlign = "center"; c.textBaseline = "middle";
    if (c.measureText(label).width > maxLW && label.includes(" ")) {
      const words = label.split(" "), lines = []; let cur = "";
      for (const w of words) { const nx = cur ? `${cur} ${w}` : w; if (c.measureText(nx).width > maxLW && cur) { lines.push(cur); cur = w; } else cur = nx; }
      lines.push(cur); const lh = fs * 1.2;
      lines.slice(0, 4).forEach((ln, i, a) => c.fillText(fit(c, ln, maxLW), lcx, y + h / 2 + (i - (a.length - 1) / 2) * lh));
    } else c.fillText(fit(c, label, maxLW), lcx, y + h / 2);

    // cards
    const ax = x0 + labelW + rowPad + (T.labelStyle === "block" ? 6 * k : 0);
    row.items.forEach((it, i) => {
      const cx = ax + (i % P.per) * (P.cardW + gap), cy = y + rowPad + Math.floor(i / P.per) * (P.cellH + gap);
      drawCard(c, imgs.get(it.key), cx, cy, P.cardW, P.cardH, T.cardRadius * k, T, it.label, k);
      if (state.ui.numbered) drawBadge(c, cx, cy, P.cardW, i + 1, k);
      if (namesN) {
        const fs2 = P.nameFs, lh = fs2 * 1.2, maxW = P.cardW + 6 * k;
        c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillStyle = T.names;
        c.font = `500 ${Math.round(fs2)}px ${T.mono ? T.labelFont : SANS}`;
        const [a, b] = namesN === 2 ? [it.label, ""] : wrap2(c, it.label, maxW);
        c.fillText(fit(c, a, maxW), cx + P.cardW / 2, cy + P.cardH + fs2 + 3 * k);
        if (b) c.fillText(fit(c, b, maxW), cx + P.cardW / 2, cy + P.cardH + fs2 + 3 * k + lh);
        if (namesN === 2 && it.game) { c.globalAlpha = 0.7; c.font = `400 ${Math.round(fs2 * 0.82)}px ${T.mono ? T.labelFont : SANS}`; c.fillText(fit(c, it.game, maxW), cx + P.cardW / 2, cy + P.cardH + fs2 + 3 * k + lh); c.globalAlpha = 1; }
      }
    });
    y += h + rowGap;
  }
  drawFooter(c, T, o, W, H, k, { pad });
  return { w: W, h: H, px: [canvas.width, canvas.height], cards: total, card: Math.round(P.cardW), missing: all.filter((it) => (it.imgHi || it.img) && !imgs.get(it.key)).length };
}

function drawCard(c, img, x, y, w, h, r, T, label, k) {
  if (T.hardShadow) { c.fillStyle = "#000"; c.fillRect(x + 4 * k, y + 4 * k, w, h); }
  else if (T.cardShadow) { c.save(); c.shadowColor = T.cardShadow; c.shadowBlur = 12 * k; c.shadowOffsetY = 4 * k; c.fillStyle = "#000"; rr(c, x, y, w, h, r); c.fill(); c.restore(); }
  c.save(); rr(c, x, y, w, h, r); c.clip();
  if (img) {
    const tr = w / h, ar = img.width / img.height; let sw, sh, sx = 0;
    if (ar > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; } else { sw = img.width; sh = sw / tr; }
    c.drawImage(img, sx, 0, sw, sh, x, y, w, h);   // keep the top of the picture (faces)
  } else {
    c.fillStyle = T.empty; c.fillRect(x, y, w, h); c.fillStyle = "#fff"; c.font = `600 ${Math.round(w * 0.4)}px ${SANS}`;
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillText((label || "?")[0], x + w / 2, y + h / 2);
  }
  c.restore();
  if (T.cardStroke) { c.save(); c.strokeStyle = T.cardStroke; c.lineWidth = (T.mono ? 3 : 2) * k; rr(c, x, y, w, h, r); c.stroke(); c.restore(); }
}

function openTierExport() {
  const dlg = $("#exportDlg");
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(EXPORT_KEY)) || {}; } catch (e) { /* ignore */ }
  const o = { style: "pastel", title: state.name, subtitle: "", footer: "", size: "auto:1600", card: "100", names: "1", hideEmpty: true, pool: false, scale: "1", fmt: "png", titleScale: 100, subScale: 100, headGap: 100, ...saved };
  o.title = state.name;
  if (!EXPORT_STYLES[o.style]) o.style = "pastel";
  $("#exStyles").innerHTML = Object.entries(EXPORT_STYLES).map(([id, s]) =>
    `<button type="button" class="ex-style" data-style="${id}" aria-pressed="${o.style === id}"><span class="sw">${s.swatch.map((x) => `<i style="background:${x}"></i>`).join("")}</span><b>${esc(s.name)}</b><small>${esc(s.blurb)}</small></button>`).join("");
  $("#exSize").innerHTML = EXPORT_SIZES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("#exCard").innerHTML = Object.entries(CARD_SIZES).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  const sync = () => {
    $("#exTitle").value = o.title; $("#exSub").value = o.subtitle; $("#exFoot").value = o.footer; $("#exSize").value = o.size; $("#exCard").value = o.card;
    $("#exScale").value = o.scale; $("#exFmt").value = o.fmt; $("#exNames").value = o.names; $("#exHide").checked = o.hideEmpty; $("#exPool").checked = o.pool;
    for (const [id, f] of [["#exTitleScale", "titleScale"], ["#exSubScale", "subScale"], ["#exHeadGap", "headGap"]]) { $(id).value = o[f]; $(id).nextElementSibling.textContent = o[f] + "%"; }
    $("#exCard").disabled = state.mode === "axis" || (o.size.startsWith("fix:") && state.mode !== "venn");
    const noTier = state.mode !== "tier"; $("#exHide").closest("label").hidden = noTier; $("#exPool").closest("label").hidden = noTier;
  };
  sync();
  let run = 0, timer = 0;
  const draw = async () => {
    const mine = ++run; $("#exBusy").hidden = false;
    const info = await renderImage($("#exCanvas"), o);
    if (mine !== run) return; $("#exBusy").hidden = true;
    $("#exInfo").textContent = `${info.px[0]}×${info.px[1]} px · ${info.cards} characters · cards ${info.card}px` + (info.missing ? ` · ⚠ ${info.missing} picture(s) failed to load` : "");
    try { localStorage.setItem(EXPORT_KEY, JSON.stringify({ ...o, title: "" })); } catch (e) { /* ignore */ }
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(draw, 250); };
  dlg.oninput = dlg.onchange = () => {
    Object.assign(o, { title: $("#exTitle").value, subtitle: $("#exSub").value, footer: $("#exFoot").value, size: $("#exSize").value, card: $("#exCard").value,
      scale: $("#exScale").value, fmt: $("#exFmt").value, names: $("#exNames").value, hideEmpty: $("#exHide").checked, pool: $("#exPool").checked,
      titleScale: +$("#exTitleScale").value, subScale: +$("#exSubScale").value, headGap: +$("#exHeadGap").value });
    for (const [id, f] of [["#exTitleScale", "titleScale"], ["#exSubScale", "subScale"], ["#exHeadGap", "headGap"]]) $(id).nextElementSibling.textContent = o[f] + "%";
    $("#exCard").disabled = state.mode === "axis" || (o.size.startsWith("fix:") && state.mode !== "venn"); soon();
  };
  $("#exStyles").onclick = (e) => { const b = e.target.closest("[data-style]"); if (!b) return; o.style = b.dataset.style; $$("[data-style]", dlg).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); soon(); };
  const mime = () => ({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" }[o.fmt]);
  $("#exSave").onclick = () => $("#exCanvas").toBlob((blob) => {
    if (!blob) return toast("Couldn't make the image (too large?)", "error");
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${(o.title || "tier-list").replace(/[^\w぀-ヿ一-鿿-]+/g, "-").replace(/^-|-$/g, "") || "tier-list"}.${o.fmt === "jpeg" ? "jpg" : o.fmt}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, mime(), 0.92);
  $("#exCopy").hidden = !(navigator.clipboard && window.ClipboardItem);
  $("#exCopy").onclick = () => $("#exCanvas").toBlob(async (blob) => {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Image copied"); } catch (e) { toast("Couldn't copy: use Download", "error"); }
  }, "image/png");
  dlg.showModal(); draw();
}
