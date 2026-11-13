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
CHARACTERS_FILE = DATA / "characters.json"  # VNDB character id -> record (fetched data only)
STAFF_FILE = DATA / "staff.json"            # VNDB staff id -> voice actor record

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", 9999))  # 8765 is taken by AnkiConnect
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
    settings["vndbTokenSet"] = bool(settings.pop("vndbToken", ""))
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
    vtoken = (incoming.get("vndbToken") or "").strip()
    if vtoken:
        info = vndb_get("authinfo", vtoken)
        if "listread" not in (info.get("permissions") or []):
            raise ValueError("That VNDB token doesn't have the listread permission. "
                             "Create a new one at vndb.org/u/tokens with listread ticked.")
        current["vndbToken"] = vtoken
        current["vndbUser"] = info["id"]
        current["vndbUsername"] = info.get("username", "")
    elif incoming.get("clearVndbToken"):
        for k in ("vndbToken", "vndbUser", "vndbUsername"):
            current.pop(k, None)
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

def vndb(endpoint, payload, token=""):
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Token {token}"
    req = urllib.request.Request(f"{VNDB_API}/{endpoint}", data=json.dumps(payload).encode(),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def vndb_get(endpoint, token):
    req = urllib.request.Request(f"{VNDB_API}/{endpoint}", headers={
        "Authorization": f"Token {token}", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ValueError("VNDB didn't accept that token. Check you copied all of it.")
        raise


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


APP_PLATFORM_TO_VNDB = {"pc": "win", "psp": "psp", "vita": "psv", "switch": "swi", "ps4": "ps4"}
EDITION_TAIL = re.compile(
    r"(?:\s+[-–—:]\s+|\s+)[(\[]?\s*(?:(?:regular|standard|normal|limited|special|premium|deluxe|collector'?s?|first[- ]print|"
    r"download|digital|dl)\s+)+(?:edition|version|ver\.?|pack|box|set)\s*[)\]]?\s*$", re.I)
REL_FIELDS = ("id, title, alttitle, released, languages.lang, catalog, vns.id, vns.rtype, "
              "images.type, images.url, images.thumbnail")


def edition_stem(title):
    return EDITION_TAIL.sub("", title or "").strip()


def vndb_releases(vid, platform, item_title="", serial="", hints=()):
    """Releases of a VN on one platform, folded into one card per product (editions of the same thing
    collapse). Asks the user to choose only when it matters: a release that bundles several VNs
    (base game + fandisc) or that is just one volume (rtype "partial") of a VN split in parts."""
    flt = ["vn", "=", ["id", "=", vid]]
    if platform in APP_PLATFORM_TO_VNDB:
        flt = ["and", flt, ["platform", "=", APP_PLATFORM_TO_VNDB[platform]]]
    rels = vndb("release", {"filters": ["and", flt, ["official", "=", 1]], "fields": REL_FIELDS,
                            "results": 100, "sort": "released"}).get("results", [])
    other = sorted({v["id"] for r in rels for v in r.get("vns") or []} - {vid})
    names = {}
    if other:
        for v in vndb("vn", {"filters": ["or"] + [["id", "=", i] for i in other],
                             "fields": "id, title, image.url", "results": 100}).get("results", []):
            names[v["id"]] = v
    groups = {}
    for r in rels:
        vns = r.get("vns") or []
        langs = tuple(sorted(l["lang"] for l in r.get("languages") or []))
        key = (tuple(sorted(v["id"] for v in vns)), normalise(edition_stem(r["title"])), langs)
        img = next((i for i in r.get("images") or [] if i["type"] in ("pkgfront", "dig")), None) \
            or next(iter(r.get("images") or []), None)
        grp = groups.setdefault(key, {
            "id": r["id"], "ids": [], "title": r["title"], "name": edition_stem(r["title"]) or r["title"],
            "original": edition_stem(r.get("alttitle") or ""), "released": r.get("released") or "", "langs": list(langs),
            "image": (img or {}).get("thumbnail") or (img or {}).get("url") or "",
            "fullImage": (img or {}).get("url") or "", "catalog": r.get("catalog") or "",
            "rtype": next((v["rtype"] for v in vns if v["id"] == vid), "complete"),
            "vns": [{"id": v["id"], "rtype": v["rtype"],
                     "title": (names.get(v["id"]) or {}).get("title") or r["title"] if v["id"] != vid else ""} for v in vns],
        })
        grp["ids"].append(r["id"])
        if not grp["image"] and img:
            grp["image"] = img.get("thumbnail") or img["url"]
    out = list(groups.values())
    choose = any(len(g["vns"]) > 1 or g["rtype"] == "partial" for g in out)

    suggested = ""
    if out:
        want, want_serial = normalise(item_title), normalise(serial)
        def score(g):
            if set(g["ids"]) & set(hints) or (want_serial and want_serial in {normalise(c) for c in [g["catalog"]]}):
                return 1000
            names_ = [normalise(g["name"]), normalise(g["original"])]
            return max((len(n) for n in names_ if n and want and (n in want or want in n)), default=0)
        ranked = sorted(out, key=score, reverse=True)
        if score(ranked[0]) and (len(ranked) == 1 or score(ranked[0]) > score(ranked[1])):
            suggested = ranked[0]["id"]
        elif len(out) == 1:
            suggested = out[0]["id"]
        elif not score(ranked[0]):
            ja = [g for g in out if "ja" in g["langs"]]  # nothing in the name to go on: the lone Japanese release
            if len(ja) == 1:
                suggested = ja[0]["id"]
    return {"choose": choose, "groups": out, "suggested": suggested}


def vndb_match(title, itch_url="", serial="", platform=""):
    """vndb_match_vn() plus the matching VN's releases on this platform, when there's something to choose."""
    res, hints = vndb_match_vn(title, itch_url, serial)
    if res.get("vn") and platform:
        try:
            rel = vndb_releases(res["vn"]["id"], platform, title, serial, hints)
            if rel["choose"]:
                res["release"] = rel
                if rel["suggested"] and res["confidence"] == "possible":
                    res["confidence"] = "release"  # the file's name matches a specific release, which is stronger than a loose title guess
        except (urllib.error.URLError, ValueError, KeyError) as e:
            print(f"Release lookup failed for {title}: {e}", file=sys.stderr)
    return res


def vndb_match_vn(title, itch_url="", serial=""):
    """Best VNDB entry: exact store link or console serial, then exact title, then a guess.
    Returns (result, ids of the releases that matched exactly)."""
    fields = SUMMARY_FIELDS + ", titles.title, tags.name, tags.rating"
    if serial:
        want = normalise(serial)
        releases = vndb("release", {"filters": ["search", "=", serial], "fields": "catalog, vns.id", "results": 10})
        exact = [r for r in releases.get("results", []) if normalise(r.get("catalog")) == want]
        vids = [vn["id"] for r in exact for vn in r.get("vns") or []]
        if vids:
            hit = vndb("vn", {"filters": ["id", "=", vids[0]], "fields": fields}).get("results")
            if hit:
                return ({"confidence": "serial", "vn": vn_summary(hit[0]), "category": guess_category(hit[0])},
                        [r["id"] for r in exact])
    if itch_url:
        releases = vndb("release", {"filters": ["extlink", "=", itch_url], "fields": "id, vns.id", "results": 5})
        vids = [vn["id"] for r in releases.get("results", []) for vn in r.get("vns") or []]
        if vids:
            hit = vndb("vn", {"filters": ["id", "=", vids[0]], "fields": fields}).get("results")
            if hit:
                return ({"confidence": "link", "vn": vn_summary(hit[0]), "category": guess_category(hit[0])},
                        [r["id"] for r in releases.get("results", [])])
    hits = vndb("vn", {"filters": ["search", "=", title], "fields": fields,
                       "sort": "searchrank", "results": 5}).get("results", [])
    want = normalise(title)
    for h in hits:
        names = [h.get("title"), h.get("alttitle")] + [t["title"] for t in h.get("titles") or []]
        if want and want in {normalise(n) for n in names if n}:
            return {"confidence": "title", "vn": vn_summary(h), "category": guess_category(h)}, []
    if hits:
        return {"confidence": "possible", "vn": vn_summary(hits[0]), "category": guess_category(hits[0])}, []
    return {"confidence": "none"}, []


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


# ---------- VNDB list sync + characters ----------
# VNDB allows about 200 requests per 5 minutes, so bulk calls are spaced out and retried on 429.

VNDB_GAP = 1.6
_last_call = [0.0]
VNDB_LABELS_DIARY = {"Playing", "Finished", "Stalled", "Dropped"}
LABEL_STATUS = {"Playing": "playing", "Finished": "completed", "Stalled": "dropped", "Dropped": "dropped"}
PLATFORM_ORDER = ["win", "swi", "psv", "psp", "ps4"]
ULIST_FIELDS = (
    "id, added, voted, vote, started, finished, labels.id, labels.label, "
    "vn.title, vn.alttitle, vn.released, vn.image.url, vn.image.sexual, vn.developers.name, vn.platforms, "
    "vn.languages, vn.length_minutes, vn.rating, vn.tags.name, vn.tags.rating, vn.tags.spoiler"
)


def vndb_polite(endpoint, payload, token="", stop=None):
    """vndb() with spacing between calls and a pause-and-retry when VNDB says slow down."""
    for attempt in range(4):
        wait = VNDB_GAP - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        try:
            return vndb(endpoint, payload, token)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            for _ in range(60):  # back off for a minute, but stay stoppable
                if stop and stop.is_set():
                    raise ValueError("Stopped")
                time.sleep(1)


def vndb_paged(endpoint, payload, token="", stop=None):
    page = 1
    while True:
        res = vndb_polite(endpoint, {**payload, "page": page, "results": 100}, token, stop)
        yield from res.get("results", [])
        if not res.get("more"):
            return
        page += 1


def day(ts):
    return time.strftime("%Y-%m-%d", time.localtime(ts)) if isinstance(ts, (int, float)) else ""


def list_entry_fields(e):
    """Fields VNDB owns for one list entry. Never includes status/rating, which are the user's to edit."""
    v = e.get("vn") or {}
    labels = [l["label"] for l in e.get("labels") or []]
    plats = v.get("platforms") or []
    plat = next((VNDB_PLATFORMS[p] for p in PLATFORM_ORDER if p in plats), "other" if plats else "")
    tags = sorted((t for t in v.get("tags") or [] if t.get("rating", 0) >= 1.5 and not t.get("spoiler")),
                  key=lambda t: -t["rating"])
    return {
        "vndbVote": e.get("vote") or 0,
        "vndbLabels": labels,
        "startedOn": e.get("started") or "",
        "finishedOn": e.get("finished") or "",
        "vndbRating": v.get("rating") or 0,
        "lengthMinutes": v.get("length_minutes") or 0,
        "languages": v.get("languages") or [],
        "tags": [t["name"] for t in tags[:30]],
        "_new": {
            "title": v.get("title") or e["id"],
            "originalTitle": v.get("alttitle") or "",
            "brand": ", ".join(d["name"] for d in v.get("developers") or []),
            "cover": (v.get("image") or {}).get("url") or "",
            "coverNsfw": ((v.get("image") or {}).get("sexual") or 0) > 1,
            "released": v.get("released") or "",
            "platform": plat,
            "category": guess_category(v),
            "addedAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(e["added"])) if e.get("added") else "",
        },
    }


def sync_vndb_list(settings):
    """Pull the user's VNDB list into the catalogue. Adds new games, refreshes VNDB-owned fields on
    known ones, and only touches status/rating on games that haven't been set up yet."""
    token, user = settings.get("vndbToken"), settings.get("vndbUser")
    if not (token and user):
        raise ValueError("No VNDB token yet. Add one in Settings.")
    entries = list(vndb_paged("ulist", {"user": user, "fields": ULIST_FIELDS, "sort": "added"}, token))
    added = updated = skipped = 0
    with lock:
        games = load_games()
        by_vid = {g["vndbId"]: g for g in games if g.get("vndbId")}
        for e in entries:
            labels = [l["label"] for l in e.get("labels") or []]
            if labels == ["Blacklist"]:
                skipped += 1
                continue
            f = list_entry_fields(e)
            new = f.pop("_new")
            status = next((LABEL_STATUS[l] for l in labels if l in LABEL_STATUS), "unplayed")
            g = by_vid.get(e["id"])
            if g:
                g.update(f)
                if g.get("status", "unplayed") == "unplayed":
                    g["status"] = status
                if not g.get("rating") and f["vndbVote"]:
                    g["rating"] = round(f["vndbVote"] / 20)
                updated += 1
            else:
                g = {"id": new_id(new["title"]), "format": "", "status": status, "routes": [], "notes": "",
                     "rating": round(f["vndbVote"] / 20) if f["vndbVote"] else 0,
                     "vndbId": e["id"], "source": "vndb-list", **new, **f}
                games.append(g)
                by_vid[e["id"]] = g
                added += 1
            g["shelf"] = "diary" if VNDB_LABELS_DIARY & set(labels) else "collection"
        write_json(GAMES_FILE, games)
    return {"added": added, "updated": updated, "skipped": skipped, "listed": len(entries)}


def reset_library(mode):
    """Start over. "vndb" removes only what the VNDB list sync added (and that you haven't linked to a file);
    "all" empties the library. Settings, keys and folder lists are kept. The games file is backed up first."""
    if mode not in ("vndb", "all"):
        raise ValueError("Unknown reset option")
    if chars_job["running"]:
        raise ValueError("Wait for the character download to finish, or stop it in Settings, first.")
    with lock:
        games = load_games()
        if mode == "vndb":
            gone = [g for g in games if g.get("source") == "vndb-list" and not (g.get("romPath") or g.get("exePath"))]
        else:
            gone = list(games)
        ids = {g["id"] for g in gone}
        backup = None
        if gone:
            backup = DATA / "backups" / f"games-{time.strftime('%Y%m%d-%H%M%S')}.json"
            backup.parent.mkdir(parents=True, exist_ok=True)
            with open(backup, "w", encoding="utf-8") as f:
                json.dump(games, f, ensure_ascii=False, indent=2)
            write_json(GAMES_FILE, [g for g in games if g["id"] not in ids])
        if mode == "all":
            write_json(CHARACTERS_FILE, {})
            write_json(STAFF_FILE, {})
    for gid in ids:
        for f in COVERS.glob(f"{gid}.*"):
            f.unlink(missing_ok=True)
    return {"removed": len(gone), "backup": backup.name if backup else ""}


CHAR_FIELDS = ("id, name, original, image.url, image.sexual, sex, birthday, blood_type, height, "
               "vns.id, vns.role, vns.spoiler, traits.id, traits.name, traits.group_name, traits.spoiler")
CHAR_BATCH = 8
chars_job = {"running": False, "done": 0, "total": 0, "message": "", "error": "", "stop": threading.Event()}


def char_record(c):
    img = c.get("image") or {}
    return {
        "id": c["id"], "name": c.get("name") or "", "original": c.get("original") or "",
        "image": img.get("url") or "", "imageNsfw": (img.get("sexual") or 0) > 1,
        "sex": c.get("sex") or [], "birthday": c.get("birthday"), "bloodType": c.get("blood_type") or "",
        "height": c.get("height") or 0,
        "traits": [{"id": t["id"], "name": t["name"], "group": t.get("group_name") or "",
                    "spoiler": t.get("spoiler") or 0} for t in c.get("traits") or []],
        "vns": [{"id": x["id"], "role": x.get("role") or "", "spoiler": x.get("spoiler") or 0}
                for x in c.get("vns") or []],
    }


def fetch_characters(vids, stop):
    """Characters and voice actors for a batch of VNs. Returns (characters, staff, vn->[char ids])."""
    anyvn = ["or"] + [["id", "=", v] for v in vids]
    chars = list(vndb_paged("character", {"filters": ["vn", "=", anyvn], "fields": CHAR_FIELDS}, stop=stop))
    staff, voices = {}, {}
    for v in vndb_paged("vn", {"filters": anyvn, "fields": "id, va.character.id, va.staff.id, va.staff.name, va.staff.original"},
                        stop=stop):
        for va in v.get("va") or []:
            cid, s = (va.get("character") or {}).get("id"), va.get("staff") or {}
            if cid and s.get("id"):
                staff[s["id"]] = {"id": s["id"], "name": s.get("name") or "", "original": s.get("original") or ""}
                voices.setdefault(cid, []).append({"vn": v["id"], "staff": s["id"]})
    return chars, staff, voices


def run_characters(scope):
    job = chars_job
    try:
        with lock:
            games = load_games()
        todo = [g for g in games if g.get("vndbId") and not g.get("charsFetchedAt")
                and (scope != "diary" or g.get("shelf") == "diary")]
        job.update(total=len(todo), done=0, error="", message="")
        for i in range(0, len(todo), CHAR_BATCH):
            if job["stop"].is_set():
                break
            batch = todo[i:i + CHAR_BATCH]
            chars, staff, voices = fetch_characters([g["vndbId"] for g in batch], job["stop"])
            with lock:
                all_chars = read_json(CHARACTERS_FILE, {})
                all_staff = read_json(STAFF_FILE, {})
                for c in chars:
                    rec = char_record(c)
                    rec["va"] = voices.get(c["id"], [])
                    all_chars[c["id"]] = rec
                all_staff.update(staff)
                write_json(CHARACTERS_FILE, all_chars)
                write_json(STAFF_FILE, all_staff)
                games = load_games()
                by_id = {g["id"]: g for g in games}
                for b in batch:
                    g = by_id.get(b["id"])
                    if not g:
                        continue
                    mine = [c for c in all_chars.values() if any(x["id"] == g["vndbId"] for x in c["vns"])]
                    g["charIds"] = [c["id"] for c in mine]
                    g["charsFetchedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    if not g.get("routes"):  # games synced from a VNDB list have no routes yet: make them from the love interests
                        def voice(c):
                            va = next((x for x in c.get("va", []) if x["vn"] == g["vndbId"]), None)
                            return (all_staff.get(va["staff"]) or {}).get("original", "") if va else ""
                        g["routes"] = [{"name": c["name"], "original": c["original"], "seiyuu": voice(c),
                                        "state": "none", "charId": c["id"]}
                                       for c in mine if any(x["id"] == g["vndbId"] and x["role"] == "primary" for x in c["vns"])]
                    by_name = {c["name"].casefold(): c["id"] for c in mine}
                    for r in g.get("routes") or []:  # link the old hand-made routes to real characters
                        r.setdefault("charId", by_name.get((r.get("name") or "").casefold(), ""))
                write_json(GAMES_FILE, games)
            job["done"] = min(i + CHAR_BATCH, len(todo))
        job["message"] = "Stopped" if job["stop"].is_set() else "Done"
    except (urllib.error.URLError, ValueError, OSError) as e:
        job["error"] = str(getattr(e, "reason", e))
    finally:
        job["running"] = False


def start_characters(scope):
    if chars_job["running"]:
        raise ValueError("Already fetching characters.")
    chars_job["stop"].clear()
    chars_job.update(running=True, done=0, total=0, message="Starting…", error="")
    threading.Thread(target=run_characters, args=(scope,), daemon=True).start()


def library_summary():
    games = load_games()
    return {
        "games": len(games),
        "withVndb": sum(1 for g in games if g.get("vndbId")),
        "withCharacters": sum(1 for g in games if g.get("charsFetchedAt")),
        "diary": sum(1 for g in games if g.get("shelf") == "diary"),
        "characters": len(read_json(CHARACTERS_FILE, {})),
        "staff": len(read_json(STAFF_FILE, {})),
        "job": {k: v for k, v in chars_job.items() if k != "stop"},
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
            if path == "/api/vndb/releases":
                arg = lambda k: query.get(k, [""])[0].strip()
                if not re.fullmatch(r"v\d+", arg("vn")):
                    raise ValueError("Bad VNDB id")
                return self.send_json(vndb_releases(arg("vn"), arg("platform"), arg("title")))
            if path == "/api/vndb/match":
                arg = lambda k: query.get(k, [""])[0].strip()
                return self.send_json(vndb_match(arg("title"), arg("url"), arg("serial"), arg("platform")))
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
            if path == "/api/library/summary":
                return self.send_json(library_summary())
            if path == "/api/characters":
                return self.send_json(read_json(CHARACTERS_FILE, {}))
            if path == "/api/staff":
                return self.send_json(read_json(STAFF_FILE, {}))
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
            if path == "/api/library/reset":
                return self.send_json(reset_library(self.read_body().get("mode")))
            if path == "/api/vndb/sync-list":
                return self.send_json(sync_vndb_list(load_settings()))
            if path == "/api/characters/start":
                start_characters("diary" if self.read_body().get("scope") == "diary" else "all")
                return self.send_json(library_summary())
            if path == "/api/characters/stop":
                chars_job["stop"].set()
                return self.send_json(library_summary())
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
        except urllib.error.URLError as e:
            return self.send_json({"error": f"VNDB request failed: {getattr(e, 'reason', e)}"}, 502)
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
