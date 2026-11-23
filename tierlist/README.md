# Tier List Studio

Character tier-list and Venn-diagram builder for otome / joseimuke fans. Pulls characters from [KoiLog](https://koilog.moe) and [VNDB](https://vndb.org).

**Start:** double-click `start-tierlist.bat` (opens http://localhost:9100). Needs Python 3 only, no packages.

## Import
- **KoiLog user:** username or profile link (`koilog.moe/u/yourname`). Reads your games, route statuses and character ratings. Profile must be public.
- **VNDB:** VN ids (`v17, v2002`) or a VNDB username / user id.
- **Search by name:** KoiLog games, VNDB games, VNDB characters.

## Three modes
- **Tier list:** drag characters onto ranks (or click one, then click a rank). **Auto-rank by rating** uses your KoiLog character ratings.
- **Axis chart:** a cross chart (like an alignment chart). Drag characters anywhere on it. Set the four end labels, grid size (or none), square or wide shape, optional numbered scale, snap-to-grid, axis/grid colours and corner labels. **Auto-plot from ratings** puts personality left to right and looks bottom to top.
- **Venn diagram:** 2 or 3 circles with your own names and colours. Drop a character where circles overlap to put them in several groups. **Auto-fill from ratings** makes Looks / Personality / Voice circles from your 5★ aspect ratings.

## Customise
- **Layout:** pool beside or below the board, drag the divider (or use sliders) for pool width, card size on the board / in the pool / in the Venn, rank label width and text size, show or hide names on cards.
- **Ranks:** rename on the board (double-click), recolour, reorder, add or remove; four presets, save your own, or paste a list (`Soulmate #e8467c` per line). Optional order numbers on each card.
- Lists autosave in the browser; **More → Save list to file** keeps a copy.

## Export
8 styles (Pastel, Noir gold, Classic, Minimal, Neon, Washi, Midnight, Arcade), 17 sizes (auto-height widths 1000–3200, social posts and stories, wallpapers, A4 print), PNG / JPEG / WebP, 1–2× density, optional names. Works for both tier lists and Venn diagrams.

## Why a local server and not a bare `.html`
KoiLog's API rejects requests from other origins and its pictures aren't canvas-safe, so `server.py` proxies the API and images (`/proxy/koilog`, `/proxy/img`). VNDB is called straight from the page. This also means the site can't run from plain static hosting such as GitHub Pages without a proxy in front of it.
