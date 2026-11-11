# My Games Library (v0.1)

A local catalogue for owned otome / BL / josei-muke games.

**Start:** double-click `start-library.bat`. It opens http://localhost:8642. Close the console window to stop.

- `server.py` — local server (Python 3 standard library only, localhost-only)
- `web/` — the page (`index.html`, `app.css`, `app.js`)
- `data/games.json` — your catalogue (`games.json.bak` is the previous save)
- `data/settings.json` — emulator paths
- `data/covers/` — covers downloaded from VNDB

Launch targets: a PC `.exe` / `.lnk` / `steam://` URL, or an emulator + game file
(set the emulator paths under **Settings**). Physical copies are catalogue-only.

**itch.io import:** add an API key under Settings (create one at itch.io → Settings → API keys), then
click **itch.io**. Tick games, match them on VNDB (exact store link → same title → possible guess),
pick categories, import. The key stays in `data/settings.json` and is never sent to the page.

**Scan folders (emulated games):** list game folders under each emulator in Settings, then click
**Scan folders**. Finds PSP ISO/CSO/CHD/EBOOT.PBP, Switch NSP/XCI, and Vita3K installed apps
(`ux0\app\<TITLE_ID>`). PSP ISOs, EBOOTs and Vita apps carry their real title and serial, and VNDB
matches serials exactly. Vita games launch by title ID (`-r {rom}`).

**Japanese study (Jiten):** each game has a **Study** tab, and the **Study** button in the top bar opens a library-wide
view. Games match on [jiten.moe](https://jiten.moe) by VNDB id (exact), then exact title; anything fuzzy is offered as
a pick-list, never linked silently. The card shows a difficulty pill beside the title. Stats are stored in `games.json`
(use **Refresh** to update). Progress is a slider per game; reading time is an estimate (~14,000 characters/hour).

**Known-word coverage:** add a Jiten API key under Settings (it's checked when you save, kept only in `data/settings.json`, and used
for read-only requests to api.jiten.moe). Linked games then show how much of their text you already know, e.g. "Hard 3.3 · 71%".
Use **Refresh** on a game, or **Update known %** in the Study window, after you've studied more words. Set your own reading
speed under Settings → Japanese study.

**What to read next:** the Study window suggests your in-progress games plus the three best unread ones, by known-word fit
(or Jiten difficulty if there's no key). *Easy read* ranks by most known; *Challenge me* aims for about 85% known. Filter by length.

**Words to learn first:** in a game's Study tab (needs the Jiten key), list the most frequent words in that game you don't know yet,
with the known-% you'd reach. Names are hidden by default. Copy the list, or **Download for Anki (Lapis)**: a tab-separated file in the
Lapis note-type layout (22 fields + tags) with word, furigana, reading, definitions, pitch accent and frequency filled in. Sentence, audio and
picture fields are left empty for Yomitan to fill. Note type, deck and tags are editable under Settings.

Port 8765 is avoided on purpose: AnkiConnect uses it. Set a `PORT` environment variable to change the port.
