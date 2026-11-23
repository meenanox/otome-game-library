"""Tier List Studio: tiny local server (Python 3 standard library only).

Serves web/ and proxies two things the browser can't reach itself:
  /proxy/koilog/<path>   -> https://api.koilog.moe/api/v1/<path>   (KoiLog refuses other origins)
  /proxy/img?u=<url>     -> character / cover pictures from an allow-list of hosts
                            (served same-origin so the export canvas isn't tainted)
VNDB's API allows browsers, so the page talks to it directly.
Localhost-only. Set PORT to change the port (default 9100).
"""
import http.server, socketserver, urllib.request, urllib.parse, urllib.error, os, time, threading, mimetypes

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
API = "https://api.koilog.moe/api/v1/"
IMG_HOSTS = {"images.koilog.moe", "t.vndb.org", "s.vndb.org"}
UA = "TierListStudio/1.0 (local fan tool)"
TTL, MAX_IMG = 900, 600
cache, lock = {}, threading.Lock()


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get("Content-Type", "application/octet-stream"), r.read()


def cached(key, producer):
    now = time.time()
    with lock:
        hit = cache.get(key)
        if hit and now - hit[0] < TTL:
            return hit[1]
    val = producer()
    with lock:
        if len(cache) > MAX_IMG:
            cache.clear()
        cache[key] = (now, val)
    return val


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "TierListStudio"

    def log_message(self, *a):
        pass

    def send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        try:
            if u.path.startswith("/proxy/koilog/"):
                url = API + urllib.parse.quote(u.path[len("/proxy/koilog/"):], safe="/%") + (("?" + u.query) if u.query else "")
                code, ctype, body = cached(url, lambda: fetch(url, {"Origin": "https://koilog.moe", "Accept": "application/json"}))
                return self.send(code, ctype, body)
            if u.path == "/proxy/img":
                target = urllib.parse.parse_qs(u.query).get("u", [""])[0]
                if urllib.parse.urlsplit(target).hostname not in IMG_HOSTS:
                    return self.send(403, "text/plain", b"host not allowed")
                code, ctype, body = cached(target, lambda: fetch(target, {"Referer": "https://koilog.moe/"}))
                return self.send(code, ctype, body, {"Cache-Control": "public, max-age=86400"})
            rel = "index.html" if u.path in ("", "/") else urllib.parse.unquote(u.path).lstrip("/")
            full = os.path.normpath(os.path.join(ROOT, rel))
            if not full.startswith(ROOT) or not os.path.isfile(full):
                return self.send(404, "text/plain", b"not found")
            with open(full, "rb") as f:
                self.send(200, mimetypes.guess_type(full)[0] or "application/octet-stream", f.read(), {"Cache-Control": "no-cache"})
        except urllib.error.HTTPError as e:
            self.send(e.code, "application/json", e.read() or b"{}")
        except Exception as e:  # network trouble etc.
            self.send(502, "application/json", ('{"errors":[{"message":%s}]}' % repr(str(e)).replace("'", '"')).encode())


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9100"))
    print(f"Tier List Studio running at http://localhost:{port}  (close this window to stop)")
    try:
        Server(("127.0.0.1", port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
