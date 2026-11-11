"""My Games Library - local server.

Serves the catalogue page, stores data in data/games.json, launches games,
and proxies VNDB lookups. Standard library only; listens on localhost only.
"""
import json
import mimetypes
import os
import re
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA = ROOT / "data"
COVERS = DATA / "covers"
GAMES_FILE = DATA / "games.json"
SETTINGS_FILE = DATA / "settings.json"

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", 8642))  # 8765 is taken by AnkiConnect
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
VNDB_API = "https://api.vndb.org/kana"
USER_AGENT = "MyGamesLibrary/0.1 (local personal catalogue)"
JITEN_API = "https://api.jiten.moe/api"
READ_CHARS_PER_HOUR = 14000  # Jiten shows ~36 h for 507k characters

# Anki export defaults, taken from the user's Yomitan card format (Lapis note type)
DEFAULT_ANKI = {"noteType": "Lapis", "deck": "MiningGroups::MINING", "tags": "yomitan"}

DEFAULT_SETTINGS = {
    "emulators": {
        "ppsspp": {"name": "PPSSPP (PSP)", "path": "", "args": "{rom}", "folders": []},
        "vita3k": {"name": "Vita3K (PS Vita)", "path": "", "args": "-r {rom}", "folders": []},
        "switch": {"name": "Switch emulator", "path": "", "args": "{rom}", "folders": []},
    }
}

lock = threading.Lock()


# ---------- storage ----------

def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path, value):
    """Write atomically and keep one .bak of the previous version."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
    if path.exists():
        os.replace(path, path.with_suffix(".json.bak"))
    os.replace(tmp, path)


def load_games():
    return read_json(GAMES_FILE, [])


def load_settings():
    settings = read_json(SETTINGS_FILE, {})
    emulators = dict(DEFAULT_SETTINGS["emulators"])
    emulators.update(settings.get("emulators", {}))
    settings["emulators"] = emulators
    return settings


def public_settings():
    """Settings as sent to the page: the itch.io API key never leaves the server."""
    settings = load_settings()
    settings["readingSpeed"] = settings.get("readingSpeed") or READ_CHARS_PER_HOUR
    settings["ankiExport"] = {**DEFAULT_ANKI, **(settings.get("ankiExport") or {})}
    settings["jitenKeySet"] = bool(settings.pop("jitenApiKey", ""))
    settings["itchKeySet"] = bool(settings.pop("itchApiKey", ""))
    return settings


def check_jiten_key(key):
    """Jiten silently ignores a bad key (coverage would read 0%), so confirm it before saving."""
    req = urllib.request.Request(JITEN_API + "/api-key/info", headers={"X-Api-Key": key, "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            if json.load(r).get("apiKey", {}).get("isRevoked"):
                raise ValueError("That Jiten API key has been revoked.")
    except urllib.error.HTTPError:
        raise ValueError("Jiten didn't accept that API key. Check you copied all of it.")
    except urllib.error.URLError as e:
        raise ValueError(f"Couldn't reach Jiten to check the key: {e.reason}")


def save_settings(incoming):
    current = load_settings()
    current["emulators"] = incoming.get("emulators", current["emulators"])
    jkey = (incoming.get("jitenApiKey") or "").strip()
    if jkey:
        check_jiten_key(jkey)
        current["jitenApiKey"] = jkey
    elif incoming.get("clearJitenKey"):
        current.pop("jitenApiKey", None)
    anki = incoming.get("ankiExport")
    if isinstance(anki, dict):
        clean = {k: re.sub(r"[\t\r\n]+", " ", str(anki.get(k) or "")).strip() for k in DEFAULT_ANKI}
        current["ankiExport"] = {k: clean[k] or DEFAULT_ANKI[k] for k in DEFAULT_ANKI}
    speed = incoming.get("readingSpeed")
    if speed is not None:
        speed = int(speed) if str(speed).strip().isdigit() else 0
        if speed and not 1000 <= speed <= 200000:
            raise ValueError("Reading speed should be between 1,000 and 200,000 characters per hour.")
        if speed:
            current["readingSpeed"] = speed
        else:
            current.pop("readingSpeed", None)
    key = (incoming.get("itchApiKey") or "").strip()
    if key:
        current["itchApiKey"] = key
    elif incoming.get("clearItchKey"):
        current.pop("itchApiKey", None)
    write_json(SETTINGS_FILE, current)


COVER_HOSTS = ("vndb.org", "itch.zone")


def localise_cover(game):
    """Download a VNDB / itch.io cover into data/covers so the library works offline."""
    url = game.get("cover") or ""
    host = urllib.parse.urlparse(url).hostname or ""
    if not (url.startswith("https://") and any(host == h or host.endswith("." + h) for h in COVER_HOSTS)):
        return
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    COVERS.mkdir(parents=True, exist_ok=True)
    dest = COVERS / f"{game['id']}{ext}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as r:
            dest.write_bytes(r.read())
        game["cover"] = f"/covers/{dest.name}?v={int(time.time())}"
    except (urllib.error.URLError, OSError) as e:
        print(f"Cover download failed for {game.get('title')}: {e}", file=sys.stderr)


def new_id(title):
    slug = re.sub(r"[^a-z0-9]+", "-", (title or "game").lower()).strip("-")[:40] or "game"
    return f"{slug}-{uuid.uuid4().hex[:6]}"


# ---------- launching ----------

def launch(game, settings):
    fmt = game.get("format")
    if fmt == "pc":
        target = (game.get("exePath") or "").strip().strip('"')
        if not target:
            raise ValueError("No executable path set for this game.")
        # steam://rungameid/..., itch:// and similar launcher URLs
        if re.match(r"^[a-z][a-z0-9+.-]*://", target, re.I) and not target.lower().startswith(("http", "file")):
            os.startfile(target)
            return
        path = Path(target)
        if not path.exists():
            raise ValueError(f"File not found: {target}")
        if path.suffix.lower() in (".lnk", ".url", ".bat", ".cmd"):
            os.startfile(str(path))
        else:
            # Many VNs expect to be started from their own folder
            subprocess.Popen([str(path)], cwd=str(path.parent))
    elif fmt == "emulated":
        emu = settings["emulators"].get(game.get("emulator") or "")
        if not emu or not emu.get("path"):
            raise ValueError("Emulator path not set. Open Settings and add it.")
        exe = Path(emu["path"].strip().strip('"'))
        rom = (game.get("romPath") or "").strip().strip('"')
        if not exe.exists():
            raise ValueError(f"Emulator not found: {exe}")
        # Vita3K launches installed games by title ID rather than a file
        if not rom or not (VITA_TITLE_ID.match(rom) or Path(rom).exists()):
            raise ValueError(f"Game file not found: {rom or '(none set)'}")
        args = [a.replace("{rom}", rom) for a in (emu.get("args") or "{rom}").split()]
        subprocess.Popen([str(exe), *args], cwd=str(exe.parent))
    else:
        raise ValueError("Physical copies can't be launched.")


# ---------- VNDB ----------

def vndb(endpoint, payload):
    req = urllib.request.Request(
        f"{VNDB_API}/{endpoint}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


SUMMARY_FIELDS = "id, title, alttitle, released, image.url, developers.name, platforms"


def vn_summary(v):
    return {
        "id": v["id"],
        "title": v.get("title"),
        "alttitle": v.get("alttitle"),
        "released": v.get("released"),
        "image": (v.get("image") or {}).get("url"),
        "developers": [d["name"] for d in v.get("developers") or []],
        "platforms": v.get("platforms") or [],
    }


def guess_category(v):
    tags = " ".join(t["name"].lower() for t in v.get("tags") or [] if t.get("rating", 0) >= 1.5)
    return "bl" if ("boys' love" in tags or "yaoi" in tags) else "otome" if "otome" in tags else ""


def vndb_search(query):
    res = vndb("vn", {
        "filters": ["search", "=", query],
        "fields": SUMMARY_FIELDS,
        "sort": "searchrank",
        "results": 12,
    })
    return [vn_summary(v) for v in res.get("results", [])]


def normalise(title):
    return re.sub(r"[\W_]+", "", (title or "").casefold())


def vndb_match(title, itch_url="", serial=""):
    """Best VNDB entry: exact store link or console serial, then exact title, then a guess."""
    fields = SUMMARY_FIELDS + ", titles.title, tags.name, tags.rating"
    if serial:
        want = normalise(serial)
        releases = vndb("release", {"filters": ["search", "=", serial], "fields": "catalog, vns.id", "results": 10})
        vids = [vn["id"] for r in releases.get("results", []) if normalise(r.get("catalog")) == want
                for vn in r.get("vns") or []]
        if vids:
            hit = vndb("vn", {"filters": ["id", "=", vids[0]], "fields": fields}).get("results")
            if hit:
                return {"confidence": "serial", "vn": vn_summary(hit[0]), "category": guess_category(hit[0])}
    if itch_url:
        releases = vndb("release", {"filters": ["extlink", "=", itch_url], "fields": "vns.id", "results": 5})
        vids = [vn["id"] for r in releases.get("results", []) for vn in r.get("vns") or []]
        if vids:
            hit = vndb("vn", {"filters": ["id", "=", vids[0]], "fields": fields}).get("results")
            if hit:
                return {"confidence": "link", "vn": vn_summary(hit[0]), "category": guess_category(hit[0])}
    hits = vndb("vn", {"filters": ["search", "=", title], "fields": fields,
                       "sort": "searchrank", "results": 5}).get("results", [])
    want = normalise(title)
    for h in hits:
        names = [h.get("title"), h.get("alttitle")] + [t["title"] for t in h.get("titles") or []]
        if want and want in {normalise(n) for n in names if n}:
            return {"confidence": "title", "vn": vn_summary(h), "category": guess_category(h)}
    if hits:
        return {"confidence": "possible", "vn": vn_summary(hits[0]), "category": guess_category(hits[0])}
    return {"confidence": "none"}


# ---------- folder scan (emulated games) ----------

SCAN_EXTS = {
    "ppsspp": {".iso", ".cso", ".chd", ".pbp"},
    "switch": {".nsp", ".xci", ".nsz", ".xcz"},
}
EMULATOR_PLATFORM = {"ppsspp": "psp", "vita3k": "vita", "switch": "switch"}
VITA_TITLE_ID = re.compile(r"^[A-Z]{4}\d{5}$")
SERIAL_IN_NAME = re.compile(r"\b([A-Z]{4})[-_ ]?(\d{5})\b")
MAX_SCAN_DEPTH = 6
MAX_META_BYTES = 1 << 20


def parse_sfo(data):
    """PARAM.SFO (PSP / Vita metadata) -> {"TITLE": ..., "DISC_ID" / "TITLE_ID": ...}."""
    if data[:4] != b"\0PSF":
        return {}
    key_start, data_start, count = struct.unpack_from("<III", data, 8)
    out = {}
    for i in range(min(count, 64)):
        key_off, fmt, length, _max_len, data_off = struct.unpack_from("<HHIII", data, 20 + i * 16)
        k = key_start + key_off
        key = data[k:data.index(b"\0", k)].decode("ascii", "replace")
        raw = data[data_start + data_off:data_start + data_off + length]
        out[key] = (struct.unpack("<I", raw[:4])[0] if fmt == 0x0404
                    else raw.split(b"\0")[0].decode("utf-8", "replace"))
    return out


def iso_param_sfo(path):
    """Read PSP_GAME/PARAM.SFO straight out of an ISO9660 image."""
    with open(path, "rb") as f:
        f.seek(16 * 2048)
        pvd = f.read(2048)
        if pvd[1:6] != b"CD001":
            return {}

        def entries(lba, size):
            f.seek(lba * 2048)
            buf = f.read(min(size, MAX_META_BYTES))
            i = 0
            while i < len(buf):
                length = buf[i]
                if length == 0:  # records never straddle sectors; skip the padding
                    i = (i // 2048 + 1) * 2048
                    continue
                name_len = buf[i + 32]
                name = buf[i + 33:i + 33 + name_len].decode("ascii", "replace").split(";")[0].upper()
                yield name, struct.unpack_from("<I", buf, i + 2)[0], struct.unpack_from("<I", buf, i + 10)[0]
                i += length

        root_lba, root_size = struct.unpack_from("<I", pvd, 158)[0], struct.unpack_from("<I", pvd, 166)[0]
        game_dir = next(((lba, size) for n, lba, size in entries(root_lba, root_size) if n == "PSP_GAME"), None)
        if not game_dir:
            return {}
        sfo = next(((lba, size) for n, lba, size in entries(*game_dir) if n == "PARAM.SFO"), None)
        if not sfo:
            return {}
        f.seek(sfo[0] * 2048)
        return parse_sfo(f.read(min(sfo[1], MAX_META_BYTES)))


def pbp_param_sfo(path):
    """EBOOT.PBP starts with a table of offsets; the first section is PARAM.SFO."""
    with open(path, "rb") as f:
        head = f.read(40)
        if head[:4] != b"\0PBP":
            return {}
        offsets = struct.unpack_from("<8I", head, 8)
        f.seek(offsets[0])
        return parse_sfo(f.read(min(offsets[1] - offsets[0], MAX_META_BYTES)))


def clean_file_title(stem):
    s = re.sub(r"[\[({][^\])}]*[\])}]", " ", stem)  # drop [tags] (region) {ids}
    s = re.sub(r"[_.]+", " ", s)
    return re.sub(r"\s+", " ", s).strip() or stem


def rom_key(rom):
    """Comparable form of a romPath: Vita title IDs as-is, file paths case-folded."""
    return rom if VITA_TITLE_ID.match(rom) else os.path.normcase(os.path.normpath(rom))


def scan_folders():
    settings = load_settings()
    games = load_games()
    known = {rom_key(g["romPath"]) for g in games if g.get("romPath")}
    found, errors = [], []

    def add(emulator, rom, title, serial, where):
        if any(x["romPath"] == rom for x in found):
            return
        found.append({
            "key": rom, "emulator": emulator, "platform": EMULATOR_PLATFORM.get(emulator, "other"),
            "romPath": rom, "title": title, "serial": serial, "location": where,
            "imported": rom_key(rom) in known,
        })

    for emulator, emu in settings["emulators"].items():
        for folder in emu.get("folders") or []:
            root = Path(os.path.expandvars(folder.strip().strip('"')))
            if not root.is_dir():
                errors.append(f"{emu.get('name', emulator)}: folder not found: {folder}")
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                here = Path(dirpath)
                if len(here.relative_to(root).parts) >= MAX_SCAN_DEPTH:
                    dirnames[:] = []
                try:
                    if emulator == "vita3k":
                        # Installed Vita apps: ux0/app/<TITLE_ID>/sce_sys/param.sfo
                        sfo_file = here / "sce_sys" / "param.sfo"
                        if sfo_file.is_file():
                            dirnames[:] = []
                            info = parse_sfo(sfo_file.read_bytes()[:MAX_META_BYTES])
                            title_id = info.get("TITLE_ID") or here.name
                            if VITA_TITLE_ID.match(title_id):
                                add(emulator, title_id, info.get("TITLE") or title_id, title_id, str(here))
                        continue
                    for name in filenames:
                        path = here / name
                        ext = path.suffix.lower()
                        if ext not in SCAN_EXTS.get(emulator, ()):
                            continue
                        if ext == ".pbp" and name.upper() != "EBOOT.PBP":
                            continue
                        info = (iso_param_sfo(path) if ext == ".iso"
                                else pbp_param_sfo(path) if ext == ".pbp" else {})
                        fallback = clean_file_title(here.name if ext == ".pbp" else path.stem)
                        m = SERIAL_IN_NAME.search(name.upper())
                        serial = info.get("DISC_ID") or (m.group(1) + m.group(2) if m else "")
                        add(emulator, str(path), info.get("TITLE") or fallback, serial, str(path))
                except (OSError, struct.error, ValueError) as e:
                    errors.append(f"Couldn't read {here}: {e}")
    found.sort(key=lambda x: (x["platform"], x["title"].casefold()))
    return {"items": found, "errors": errors[:20]}


# ---------- itch.io ----------

ITCH_API = "https://api.itch.io"


def itch_owned(api_key):
    """Every game the account owns (purchases, claims, bundles, gifts), one entry per game."""
    keys, page = [], 1
    while page <= 40:
        req = urllib.request.Request(
            f"{ITCH_API}/profile/owned-keys?per_page=500&page={page}",
            headers={"Authorization": f"Bearer {api_key}", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise ValueError("itch.io rejected the API key. Check it in Settings.")
            raise
        if data.get("errors"):
            raise ValueError("itch.io: " + "; ".join(map(str, data["errors"])))
        batch = data.get("owned_keys") or []
        keys += batch
        if len(batch) < int(data.get("per_page") or 500):
            break
        page += 1

    imported = {g.get("itchGameId") for g in load_games() if g.get("itchGameId")}
    items, seen = [], set()
    for k in keys:
        g = k.get("game") or {}
        if not g.get("id") or g["id"] in seen:
            continue
        seen.add(g["id"])
        user = g.get("user") or {}
        items.append({
            "itchGameId": g["id"],
            "title": g.get("title") or "",
            "url": g.get("url") or "",
            "cover": g.get("cover_url") or "",
            "classification": g.get("classification") or "game",
            "developer": user.get("display_name") or user.get("username") or "",
            "purchased": bool(k.get("purchase_id")),
            "ownedSince": k.get("created_at") or "",
            "imported": g["id"] in imported,
        })
    return items


VNDB_PLATFORMS = {"win": "pc", "psp": "psp", "psv": "vita", "swi": "switch", "ps4": "ps4"}


def vndb_details(vid):
    if not re.fullmatch(r"v\d+", vid):
        raise ValueError("Bad VNDB id")
    res = vndb("vn", {
        "filters": ["id", "=", vid],
        "fields": ("id, title, alttitle, titles.title, titles.lang, released, description, image.url, image.sexual, "
                   "developers.name, platforms, languages, tags.name, tags.rating, "
                   "va.character.id, va.staff.name, va.staff.original"),
    })["results"]
    if not res:
        raise ValueError("Not found on VNDB")
    v = res[0]
    chars = vndb("character", {
        "filters": ["vn", "=", ["id", "=", vid]],
        "fields": "id, name, original, vns.id, vns.role",
        "results": 100,
    }).get("results", [])

    seiyuu = {}
    for va in v.get("va") or []:
        cid = (va.get("character") or {}).get("id")
        staff = va.get("staff") or {}
        if cid and cid not in seiyuu:
            seiyuu[cid] = staff.get("original") or staff.get("name") or ""

    def role(c):
        return next((x["role"] for x in c.get("vns", []) if x["id"] == vid), "")

    # "primary" = main cast other than the protagonist, i.e. usually the love interests
    picked = [c for c in chars if role(c) == "primary"] or [c for c in chars if role(c) == "side"]
    routes = [{"name": c["name"], "original": c.get("original") or "",
               "seiyuu": seiyuu.get(c["id"], ""), "state": "none"} for c in picked]

    ja_title = next((t["title"] for t in v.get("titles") or [] if t.get("lang") == "ja"), "")
    original = v.get("alttitle") or (ja_title if ja_title != v.get("title") else "")

    desc = re.sub(r"\[url=[^\]]*\]|\[/url\]|\[/?[a-z]+\]", "", v.get("description") or "")
    return {
        "vndbId": v["id"],
        "title": v.get("title") or "",
        "originalTitle": original,
        "released": v.get("released") or "",
        "brand": ", ".join(d["name"] for d in v.get("developers") or []),
        "cover": (v.get("image") or {}).get("url") or "",
        "coverNsfw": ((v.get("image") or {}).get("sexual") or 0) > 1,
        "description": desc.strip(),
        "platforms": [VNDB_PLATFORMS.get(p, p) for p in v.get("platforms") or []],
        "languages": v.get("languages") or [],
        "category": guess_category(v),
        "routes": routes,
    }


# ---------- HTTP ----------

# ---------- Jiten (Japanese learning data) ----------

def jiten_key():
    return load_settings().get("jitenApiKey", "")


def jiten_get(path):
    """GET from the Jiten API. The user's key (if any) goes only to api.jiten.moe, on read-only calls."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if jiten_key():
        headers["X-Api-Key"] = jiten_key()
    try:
        with urllib.request.urlopen(urllib.request.Request(JITEN_API + path, headers=headers), timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ValueError("Jiten rejected your API key. Check it in Settings.")
        raise


def jiten_summary(d):
    chars = d.get("characterCount") or 0
    hours = round((d.get("runtimeSeconds") or 0) / 3600, 1) or (round(chars / READ_CHARS_PER_HOUR, 1) if chars else 0)
    known = {}
    if jiten_key() and d.get("coverage") is not None:
        known = {"coverage": round(d["coverage"], 1), "uniqueCoverage": round(d.get("uniqueCoverage") or 0, 1),
                 "coverageAt": time.strftime("%Y-%m-%dT%H:%M:%S")}
    return {
        **known,
        "deckId": d["deckId"],
        "title": d.get("originalTitle") or "",
        "romaji": d.get("romajiTitle") or "",
        "english": d.get("englishTitle") or "",
        "characterCount": chars,
        "wordCount": d.get("wordCount") or 0,
        "uniqueWordCount": d.get("uniqueWordCount") or 0,
        "uniqueKanjiCount": d.get("uniqueKanjiCount") or 0,
        "difficulty": d.get("difficulty"),
        "difficultyRaw": round(d.get("difficultyRaw") or 0, 1),
        "dialoguePercentage": round(d.get("dialoguePercentage") or 0, 1),
        "averageSentenceLength": round(d.get("averageSentenceLength") or 0, 1),
        "externalRating": d.get("externalRating"),
        "hours": hours,
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def jiten_deck(deck_id):
    return jiten_summary(jiten_get(f"/media-deck/{int(deck_id)}/detail")["data"]["mainDeck"])


def jiten_match(vndb_id="", titles=()):
    """Jiten deck for a game: VNDB id first (exact), then exact title, else candidates to pick from."""
    if re.fullmatch(r"v\d+", vndb_id or ""):
        ids = jiten_get(f"/media-deck/by-link-id/2/{vndb_id}")
        if ids:
            return {"confidence": "link", "deck": jiten_deck(ids[0]), "candidates": []}
    wanted = {normalise(t) for t in titles if t}
    wanted.discard("")
    seen, cands = set(), []
    for t in dict.fromkeys(t for t in titles if t):
        res = jiten_get("/media-deck/get-media-decks?titleFilter=" + urllib.parse.quote(t))["data"]
        for d in res:
            if d["deckId"] in seen:
                continue
            seen.add(d["deckId"])
            names = [d.get("originalTitle"), d.get("romajiTitle"), d.get("englishTitle"), *(d.get("aliases") or [])]
            if wanted & {normalise(n) for n in names if n}:
                return {"confidence": "title", "deck": jiten_summary(d), "candidates": []}
            cands.append(jiten_summary(d))
    return {"confidence": "possible" if cands else "none", "deck": None, "candidates": cands[:5]}


KANJI_READING = re.compile(r"[\u4e00-\u9fff\u3005\u3006]+\[([^\]]+)\]")


def jiten_learn(deck_id, count=50, skip_names=True):
    """The most frequent words in a game that the user doesn't know yet (needs their Jiten key)."""
    if not jiten_key():
        raise ValueError("Add your Jiten API key in Settings to see which words you don't know yet.")
    count = max(10, min(int(count), 200))
    words, offset, total = [], 0, 0
    while len(words) < count and offset < 1000:
        res = jiten_get(f"/media-deck/{int(deck_id)}/vocabulary?sortBy=deckFreq&sortOrder=0"
                        f"&displayFilter=unknown&limit=200&offset={offset}")
        rows, total = res["data"]["words"], res["totalItems"]
        if not rows:
            break
        for r in rows:
            pos = r.get("partsOfSpeech") or []
            is_name = any("name" in p.lower() for p in pos)
            if is_name and skip_names:
                continue
            furi = r["mainReading"]["text"]
            plain = re.sub(r"\[[^\]]*\]", "", furi)
            defs = r.get("definitions") or []
            meanings = (defs[0] if defs else {}).get("meanings") or []
            reading = KANJI_READING.sub(lambda m: m.group(1), furi)
            reading = "".join(chr(ord(c) - 0x60) if "\u30a1" <= c <= "\u30f6" else c for c in reading)
            words.append({
                "word": plain,
                "furigana": furi,
                "reading": reading,
                "senses": [{"meanings": d.get("meanings") or [], "pos": d.get("partsOfSpeech") or []} for d in defs[:6]],
                "pitch": r.get("pitchAccents") or [],
                "rank": r["mainReading"].get("frequencyRank"),
                "meaning": "; ".join(meanings[:2]),
                "count": r.get("occurrences") or 0,
                "pos": pos[0] if pos else "",
                "name": is_name,
            })
            if len(words) >= count:
                break
        offset += 200
    return {"unknownTotal": total, "words": words}


def jiten_vocab(deck_id):
    rows = jiten_get(f"/media-deck/{int(deck_id)}/vocabulary-preview?limit=20")
    return [{"word": r["reading"], "furigana": r.get("readingFurigana") or "", "meaning": r.get("mainDefinition") or "",
             "count": r.get("occurrences") or 0, "rank": r.get("frequencyRank")} for r in rows]


class Handler(BaseHTTPRequestHandler):
    server_version = "MyGamesLibrary/0.1"

    def log_message(self, fmt, *args):
        if "/api/" in (str(args[0]) if args else "") or fmt.startswith("code"):
            sys.stderr.write("%s\n" % (fmt % args))

    # Only answer requests addressed to this machine, and only accept writes
    # from our own page (blocks other websites poking at localhost).
    def guard(self, write):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            self.send_json({"error": "Bad host"}, 403)
            return False
        if write:
            origin = self.headers.get("Origin", "")
            if origin not in {f"http://{h}" for h in ALLOWED_HOSTS}:
                self.send_json({"error": "Bad origin"}, 403)
                return False
        return True

    def send_json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def send_file(self, base, rel):
        path = (base / rel).resolve()
        if not path.is_relative_to(base.resolve()) or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.guard(write=False):
            return
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)
        try:
            if path == "/api/games":
                return self.send_json(load_games())
            if path == "/api/settings":
                return self.send_json(public_settings())
            query = urllib.parse.parse_qs(url.query)
            if path == "/api/vndb/search":
                q = query.get("q", [""])[0].strip()
                return self.send_json(vndb_search(q) if q else [])
            m = re.fullmatch(r"/api/vndb/vn/(v\d+)", path)
            if m:
                return self.send_json(vndb_details(m.group(1)))
            if path == "/api/vndb/match":
                arg = lambda k: query.get(k, [""])[0].strip()
                return self.send_json(vndb_match(arg("title"), arg("url"), arg("serial")))
            if path == "/api/jiten/match":
                arg = lambda k: query.get(k, [""])[0].strip()
                return self.send_json(jiten_match(arg("vndb"), [arg("title"), arg("alt")]))
            m = re.fullmatch(r"/api/jiten/learn/(\d+)", path)
            if m:
                return self.send_json(jiten_learn(m.group(1), query.get("count", ["50"])[0],
                                                  query.get("names", ["hide"])[0] != "show"))
            m = re.fullmatch(r"/api/jiten/(deck|vocab)/(\d+)", path)
            if m:
                return self.send_json((jiten_deck if m.group(1) == "deck" else jiten_vocab)(m.group(2)))
            if path == "/api/scan":
                return self.send_json(scan_folders())
            if path == "/api/itch/owned":
                key = load_settings().get("itchApiKey")
                if not key:
                    raise ValueError("No itch.io API key yet. Add one in Settings.")
                return self.send_json(itch_owned(key))
        except urllib.error.URLError as e:
            return self.send_json({"error": f"Network error: {e.reason}"}, 502)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        if path.startswith("/covers/"):
            return self.send_file(COVERS, path[len("/covers/"):])
        return self.send_file(WEB, "index.html" if path == "/" else path.lstrip("/"))

    def do_POST(self):
        if not self.guard(write=True):
            return
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/games":
                game = self.read_body()
                game["id"] = new_id(game.get("title"))
                game["addedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                localise_cover(game)
                with lock:
                    games = load_games()
                    games.append(game)
                    write_json(GAMES_FILE, games)
                return self.send_json(game, 201)
            m = re.fullmatch(r"/api/launch/([\w-]+)", path)
            if m:
                with lock:
                    games = load_games()
                    game = next((g for g in games if g["id"] == m.group(1)), None)
                    if not game:
                        return self.send_json({"error": "Game not found"}, 404)
                    launch(game, load_settings())
                    game["lastPlayed"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    write_json(GAMES_FILE, games)
                return self.send_json(game)
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except OSError as e:
            return self.send_json({"error": f"Couldn't start: {e}"}, 500)
        self.send_json({"error": "Not found"}, 404)

    def do_PUT(self):
        if not self.guard(write=True):
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/settings":
            try:
                with lock:
                    save_settings(self.read_body())
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            return self.send_json(public_settings())
        m = re.fullmatch(r"/api/games/([\w-]+)", path)
        if m:
            game = self.read_body()
            game["id"] = m.group(1)
            localise_cover(game)
            with lock:
                games = load_games()
                idx = next((i for i, g in enumerate(games) if g["id"] == game["id"]), None)
                if idx is None:
                    return self.send_json({"error": "Game not found"}, 404)
                games[idx] = game
                write_json(GAMES_FILE, games)
            return self.send_json(game)
        self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        if not self.guard(write=True):
            return
        m = re.fullmatch(r"/api/games/([\w-]+)", urllib.parse.urlparse(self.path).path)
        if not m:
            return self.send_json({"error": "Not found"}, 404)
        with lock:
            games = load_games()
            write_json(GAMES_FILE, [g for g in games if g["id"] != m.group(1)])
        for f in COVERS.glob(f"{m.group(1)}.*"):
            f.unlink(missing_ok=True)
        self.send_json({"ok": True})


def main():
    DATA.mkdir(exist_ok=True)
    # On Windows, address reuse would let us silently share a port another app owns
    ThreadingHTTPServer.allow_reuse_address = False
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        sys.exit(f"Port {PORT} is already in use. Is the library already running? "
                 f"(Or set a different PORT environment variable.)")
    url = f"http://localhost:{PORT}/"
    print(f"My Games Library running at {url}  (close this window to stop)")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
