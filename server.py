import base64
import hashlib
import http.server
import json
import os
import re
import socketserver
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "accounts"
HTTP_PORT = int(os.environ.get("WIN7_HTTP_PORT", "8000"))
WS_PORT = int(os.environ.get("WIN7_WS_PORT", "8765"))
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
STORE_LOCK = threading.RLock()


def normalize_email(value):
    return str(value or "").strip().lower()


def derive_display_name(email):
    local_part = str(email or "").strip().split("@")[0]
    return re.sub(r'[\\/:*?"<>|]+', "", local_part).strip() or "Martin"


def safe_email_filename(email):
    return re.sub(r"[^a-z0-9._-]+", "_", normalize_email(email)) or "account"


def contact_id(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-") or "contact"


def contact_color(value):
    palette = ["#45b6ff", "#7a9dff", "#4fd3b3", "#ffb34d", "#f48aa8", "#64d8ff", "#9a92ff", "#8ca2ba"]
    key = str(value or "contact")
    total = 0
    for char in key:
        total = (total * 31 + ord(char)) % 0xFFFFFFFF
    return palette[total % len(palette)]


def now_label():
    return time.strftime("%I:%M %p").lstrip("0")


def create_default_vfs(user_name):
    name = derive_display_name(user_name)
    return {
        "C:": {
            "type": "drive",
            "children": {
                "Frames": {"type": "folder", "children": {}},
                "Users": {
                    "type": "folder",
                    "children": {
                        name: {
                            "type": "folder",
                            "children": {
                                "Desktop": {"type": "folder", "children": {}},
                                "Documents": {
                                    "type": "folder",
                                    "children": {
                                        "Welcome.txt": {
                                            "type": "file",
                                            "content": f"Welcome back, {name}. Your Frames 6 desktop is now saved to this account.",
                                            "modified": "04/16/2026",
                                        }
                                    },
                                },
                                "Downloads": {"type": "folder", "children": {}},
                                "Pictures": {"type": "folder", "children": {}},
                                "Music": {"type": "folder", "children": {}},
                                "Videos": {"type": "folder", "children": {}},
                            },
                        }
                    },
                },
                "Program Files": {"type": "folder", "children": {}},
            },
        },
        "D:": {"type": "drive", "children": {}},
        "RecycleBin": {"type": "recyclebin", "children": {}},
    }


def create_default_account(email, display_name=None):
    normalized_email = normalize_email(email)
    display_name = display_name or derive_display_name(normalized_email)
    return {
        "profile": {
            "email": normalized_email,
            "displayName": display_name,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
        "state": {
            "settings": {
                "wallpaper": "7.jpg",
                "aeroColor": "rgba(30,60,110,0.45)",
                "titlebarColor": "rgba(255,255,255,0.15)",
                "username": display_name,
                "themes": [],
                "activeTheme": None,
                "clockFormat": "12h",
                "stickyNotes": [],
                "volume": 65,
                "taskbarBrightness": 100,
                "titlebarBrightness": 100,
                "transparencyEffects": True,
                "pinnedTaskbar": ["ie", "explorer", "mediaplayer", "messenger"],
            },
            "vfs": create_default_vfs(display_name),
            "messenger": {
                "contacts": [],
                "conversations": {},
                "state": {
                    "status": "Online",
                    "personalMessage": "Back on Frames Messenger.",
                    "search": "",
                    "selected": "",
                    "currentChat": "",
                    "showOffline": True,
                    "groups": {
                        "Favorites": True,
                        "Friends": True,
                        "Family": True,
                        "Work": True,
                        "Frames Network": True,
                    },
                },
            },
        },
    }


def account_path(email):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / f"{safe_email_filename(email)}.json"


def _read_account_unlocked(email):
    path = account_path(email)
    if not path.exists():
        account = create_default_account(email)
        _write_account_unlocked(account)
        return account
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        account = create_default_account(email)
        _write_account_unlocked(account)
        return account


def _write_account_unlocked(account):
    email = normalize_email(account.get("profile", {}).get("email"))
    if not email:
        raise ValueError("Account profile email is required")
    path = account_path(email)
    path.write_text(json.dumps(account, indent=2), encoding="utf-8")


def read_account(email):
    with STORE_LOCK:
        return _read_account_unlocked(email)


def write_account(account):
    with STORE_LOCK:
        _write_account_unlocked(account)


def ensure_contact(account, friend_email, friend_name=None, group="Friends"):
    messenger = account.setdefault("state", {}).setdefault("messenger", {})
    contacts = messenger.setdefault("contacts", [])
    normalized_email = normalize_email(friend_email)
    existing = next((contact for contact in contacts if normalize_email(contact.get("email")) == normalized_email), None)
    if existing:
        if friend_name:
            existing["name"] = friend_name
        existing.setdefault("group", group)
        existing.setdefault("note", normalized_email)
        existing["kind"] = "account"
        return existing
    created = {
        "id": contact_id(normalized_email),
        "name": friend_name or derive_display_name(normalized_email),
        "group": group,
        "status": "Offline",
        "note": normalized_email,
        "color": contact_color(normalized_email),
        "email": normalized_email,
        "kind": "account",
    }
    contacts.append(created)
    return created


def append_message(account, friend_email, from_side, text, stamp):
    messenger = account.setdefault("state", {}).setdefault("messenger", {})
    conversations = messenger.setdefault("conversations", {})
    key = contact_id(friend_email)
    conversations.setdefault(key, [])
    conversations[key].append({"from": from_side, "text": text, "time": stamp or now_label()})


class PresenceHub:
    def __init__(self):
        self._lock = threading.RLock()
        self._clients_by_email = {}
        self._handler_email = {}
        self._presence = {}

    def register(self, email, handler, display_name, status, personal_message):
        with self._lock:
            self._clients_by_email.setdefault(email, set()).add(handler)
            self._handler_email[handler] = email
            self._presence[email] = {
                "email": email,
                "displayName": display_name,
                "status": status,
                "personalMessage": personal_message,
            }
        self.broadcast_snapshot()

    def unregister(self, handler):
        email = None
        with self._lock:
            email = self._handler_email.pop(handler, None)
            if not email:
                return
            handlers = self._clients_by_email.get(email, set())
            handlers.discard(handler)
            if not handlers:
                self._clients_by_email.pop(email, None)
                self._presence.pop(email, None)
        self.broadcast_presence_update(email, online=False)

    def update_presence(self, email, display_name, status, personal_message):
        with self._lock:
            if email not in self._clients_by_email:
                return
            self._presence[email] = {
                "email": email,
                "displayName": display_name,
                "status": status,
                "personalMessage": personal_message,
            }
        self.broadcast_presence_update(email, online=True)

    def snapshot(self):
        with self._lock:
            return list(self._presence.values())

    def broadcast_snapshot(self):
        payload = {"type": "presence_snapshot", "users": self.snapshot()}
        with self._lock:
            handlers = [handler for group in self._clients_by_email.values() for handler in list(group)]
        for handler in handlers:
            handler.send_json(payload)

    def broadcast_presence_update(self, email, online=True):
        payload = {"type": "presence_update", "email": email, "online": online}
        if online:
            presence = next((entry for entry in self.snapshot() if entry["email"] == email), None)
            if presence:
                payload.update(
                    {
                        "displayName": presence["displayName"],
                        "status": presence["status"],
                        "personalMessage": presence["personalMessage"],
                    }
                )
        with self._lock:
            handlers = [handler for group in self._clients_by_email.values() for handler in list(group)]
        for handler in handlers:
            handler.send_json(payload)

    def send_message(self, email, payload):
        with self._lock:
            handlers = list(self._clients_by_email.get(email, set()))
        for handler in handlers:
            handler.send_json(payload)

    def send_contact_added(self, email, contact):
        self.send_message(email, {"type": "contact_added", "contact": contact})


HUB = PresenceHub()


class WebSocketHandler(socketserver.BaseRequestHandler):
    def setup(self):
        self.email = None
        self.send_lock = threading.Lock()

    def handle(self):
        try:
            self.perform_handshake()
            while True:
                opcode, payload = self.read_frame()
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    self.send_frame(payload, opcode=0xA)
                    continue
                if opcode != 0x1:
                    continue
                message = json.loads(payload.decode("utf-8"))
                self.handle_message(message)
        except Exception:
            pass
        finally:
            if self.email:
                HUB.unregister(self)

    def perform_handshake(self):
        request_data = self._read_until_headers_end()
        header_text = request_data.decode("utf-8", errors="ignore")
        lines = header_text.split("\r\n")
        headers = {}
        for line in lines[1:]:
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
        key = headers.get("sec-websocket-key")
        if not key:
            raise ValueError("Missing websocket key")
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode("utf-8")).digest()).decode("ascii")
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        self.request.sendall(response.encode("ascii"))

    def _read_until_headers_end(self):
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.request.recv(1024)
            if not chunk:
                raise ConnectionError("Socket closed during handshake")
            data += chunk
        return data

    def _read_exact(self, length):
        data = b""
        while len(data) < length:
            chunk = self.request.recv(length - len(data))
            if not chunk:
                raise ConnectionError("Socket closed")
            data += chunk
        return data

    def read_frame(self):
        header = self._read_exact(2)
        first, second = header[0], header[1]
        opcode = first & 0x0F
        masked = (second & 0x80) != 0
        length = second & 0x7F
        if length == 126:
            length = int.from_bytes(self._read_exact(2), "big")
        elif length == 127:
            length = int.from_bytes(self._read_exact(8), "big")
        mask = self._read_exact(4) if masked else b""
        payload = self._read_exact(length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return opcode, payload

    def send_frame(self, payload, opcode=0x1):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        length = len(payload)
        if length < 126:
            header = bytes([0x80 | opcode, length])
        elif length < 65536:
            header = bytes([0x80 | opcode, 126]) + length.to_bytes(2, "big")
        else:
            header = bytes([0x80 | opcode, 127]) + length.to_bytes(8, "big")
        with self.send_lock:
            self.request.sendall(header + payload)

    def send_json(self, payload):
        try:
            self.send_frame(json.dumps(payload))
        except Exception:
            pass

    def handle_message(self, message):
        msg_type = message.get("type")
        if msg_type == "auth":
            email = normalize_email(message.get("email"))
            if not email:
                return
            self.email = email
            display_name = message.get("displayName") or derive_display_name(email)
            HUB.register(
                email,
                self,
                display_name,
                message.get("status") or "Online",
                message.get("personalMessage") or "",
            )
            return
        if not self.email:
            return
        if msg_type == "presence_update":
            HUB.update_presence(
                self.email,
                message.get("displayName") or derive_display_name(self.email),
                message.get("status") or "Online",
                message.get("personalMessage") or "",
            )
            return
        if msg_type == "chat_message":
            to_email = normalize_email(message.get("toEmail"))
            text = str(message.get("text") or "").strip()
            if not to_email or not text:
                return
            timestamp = message.get("time") or now_label()
            with STORE_LOCK:
                sender_account = _read_account_unlocked(self.email)
                recipient_account = _read_account_unlocked(to_email)
                sender_name = (
                    message.get("fromName")
                    or sender_account.get("profile", {}).get("displayName")
                    or derive_display_name(self.email)
                )
                recipient_name = (
                    message.get("toName")
                    or recipient_account.get("profile", {}).get("displayName")
                    or derive_display_name(to_email)
                )
                ensure_contact(sender_account, to_email, recipient_name)
                recipient_contact = ensure_contact(recipient_account, self.email, sender_name)
                append_message(sender_account, to_email, "me", text, timestamp)
                append_message(recipient_account, self.email, "them", text, timestamp)
                _write_account_unlocked(sender_account)
                _write_account_unlocked(recipient_account)
            HUB.send_message(
                to_email,
                {
                    "type": "message",
                    "fromEmail": self.email,
                    "fromName": sender_name,
                    "text": text,
                    "time": timestamp,
                },
            )
            HUB.send_contact_added(to_email, recipient_contact)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class ThreadingWebSocketServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


class DesktopRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/ping":
            return self.write_json({"ok": True, "wsPort": WS_PORT})
        if parsed.path == "/api/state":
            email = normalize_email(parse_qs(parsed.query).get("email", [""])[0])
            if not email:
                return self.write_json({"error": "email is required"}, status=400)
            account = read_account(email)
            return self.write_json({"ok": True, "profile": account["profile"], "state": account["state"], "wsPort": WS_PORT})
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw_body.decode("utf-8") or "{}")
        except Exception:
            body = {}

        if parsed.path == "/api/login":
            email = normalize_email(body.get("email"))
            if not email:
                return self.write_json({"error": "email is required"}, status=400)
            display_name = body.get("displayName") or derive_display_name(email)
            with STORE_LOCK:
                account = _read_account_unlocked(email)
                account.setdefault("profile", {})["displayName"] = display_name
                account["profile"]["email"] = email
                account.setdefault("state", {}).setdefault("settings", {})["username"] = display_name
                _write_account_unlocked(account)
            return self.write_json({"ok": True, "profile": account["profile"], "state": account["state"], "wsPort": WS_PORT})

        if parsed.path == "/api/state":
            email = normalize_email(body.get("email"))
            state = body.get("state")
            if not email or not isinstance(state, dict):
                return self.write_json({"error": "email and state are required"}, status=400)
            display_name = body.get("profile", {}).get("displayName") or derive_display_name(email)
            with STORE_LOCK:
                account = _read_account_unlocked(email)
                account["profile"]["email"] = email
                account["profile"]["displayName"] = display_name
                account["state"] = state
                account["state"].setdefault("settings", {})["username"] = display_name
                _write_account_unlocked(account)
            return self.write_json({"ok": True, "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S")})

        if parsed.path == "/api/friends":
            email = normalize_email(body.get("email"))
            friend_email = normalize_email(body.get("friendEmail"))
            if not email or not friend_email:
                return self.write_json({"error": "email and friendEmail are required"}, status=400)
            with STORE_LOCK:
                account = _read_account_unlocked(email)
                friend_account = _read_account_unlocked(friend_email)
                account_contact = ensure_contact(account, friend_email, derive_display_name(friend_email))
                friend_contact = ensure_contact(friend_account, email, account["profile"].get("displayName") or derive_display_name(email))
                _write_account_unlocked(account)
                _write_account_unlocked(friend_account)
            HUB.send_contact_added(friend_email, friend_contact)
            HUB.send_contact_added(email, account_contact)
            return self.write_json({"ok": True, "contacts": account["state"]["messenger"]["contacts"], "contactId": account_contact["id"]})

        return self.write_json({"error": "Not found"}, status=404)

    def write_json(self, payload, status=200):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format_string, *args):
        print(f"[http] {self.address_string()} - {format_string % args}")


def main():
    http_server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), DesktopRequestHandler)
    ws_server = ThreadingWebSocketServer(("0.0.0.0", WS_PORT), WebSocketHandler)

    threading.Thread(target=ws_server.serve_forever, daemon=True).start()
    print(f"Frames 6 desktop server running at http://127.0.0.1:{HTTP_PORT}")
    print(f"Messenger WebSocket running at ws://127.0.0.1:{WS_PORT}/ws")

    try:
        http_server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http_server.shutdown()
        ws_server.shutdown()


if __name__ == "__main__":
    main()
