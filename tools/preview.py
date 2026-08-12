#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""يبني المتجر ويعرضه على هذا الجهاز وعلى أجهزة الشبكة المحلية.

يُشغَّل من 2-معاينة-المتجر.bat — أو مباشرة:
    python tools/preview.py
"""

import http.server
import socket
import subprocess
import sys
import threading
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8000


def log(msg=""):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("utf-8", "replace").decode("ascii", "replace"), flush=True)


def lan_ip():
    """عنوان الجهاز على الشبكة المحلية — ليُفتح المتجر من الجوال."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # امنع المتصفح من عرض نسخة قديمة أثناء المعاينة
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass                                  # لا تُغرق النافذة بسجل الطلبات


def main():
    log("=" * 52)
    log("   ELORA — معاينة المتجر")
    log("=" * 52)
    log("")

    if subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], cwd=ROOT).returncode != 0:
        log("")
        log("  ✖ فشل بناء قائمة المنتجات.")
        input("\nاضغط Enter للإغلاق...")
        return 1

    try:
        srv = http.server.ThreadingHTTPServer(
            ("0.0.0.0", PORT), partial(Handler, directory=str(ROOT)))
    except OSError:
        log("")
        log(f"  ✖ المنفذ {PORT} مشغول — أغلق نافذة معاينة أخرى وأعد المحاولة.")
        input("\nاضغط Enter للإغلاق...")
        return 1

    ip = lan_ip()
    log("")
    log("-" * 52)
    log(f"   على هذا الجهاز : http://localhost:{PORT}")
    if ip:
        log(f"   من الجوال      : http://{ip}:{PORT}")
        log("                    (يجب أن يكون على نفس شبكة الواي فاي)")
    log("")
    log("   لإيقاف المعاينة: أغلق هذه النافذة")
    log("-" * 52)
    log("")

    threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("\nتوقفت المعاينة.")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
