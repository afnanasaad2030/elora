#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ينشر المتجر على الإنترنت: بناء ثم حفظ ثم رفع إلى GitHub.

يُشغَّل من 3-نشر-على-الإنترنت.bat — أو مباشرة:
    python tools/publish.py
    python tools/publish.py --check     تجربة بلا رفع
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://afnanasaad2030.github.io/elora/"


def log(msg=""):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("utf-8", "replace").decode("ascii", "replace"), flush=True)


def git(*args, quiet=False):
    """يشغّل أمر git موروثًا الطرفية — ضروري ليتمكّن GitHub من طلب تسجيل الدخول."""
    return subprocess.run(
        ["git", *args], cwd=ROOT,
        stdout=subprocess.DEVNULL if quiet else None,
        stderr=subprocess.DEVNULL if quiet else None,
    ).returncode


def git_out(*args):
    r = subprocess.run(["git", *args], cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "").strip()


def fail(msg):
    log("")
    log("  ✖ " + msg)
    log("")
    return 1


def main():
    check_only = "--check" in sys.argv

    log("=" * 52)
    log("   ELORA — نشر المتجر على الإنترنت")
    log("=" * 52)
    log("")

    if subprocess.run(["where", "git"], capture_output=True, shell=True).returncode != 0:
        return fail("Git غير مثبّت. حمّله من: https://git-scm.com/download/win")

    if not (ROOT / ".git").exists():
        return fail("المتجر غير مربوط بـ GitHub بعد. راجع ملف: خطوات-النشر.md")

    # ── 1) بناء ──────────────────────────────────────────────
    log("[1/3] تحديث قائمة المنتجات...")
    if subprocess.run([sys.executable, str(ROOT / "tools" / "build.py")], cwd=ROOT).returncode != 0:
        return fail("فشل بناء قائمة المنتجات.")

    # ── 2) حفظ ───────────────────────────────────────────────
    log("")
    log("[2/3] حفظ التغييرات...")
    git("add", "-A", quiet=True)

    if git("diff", "--cached", "--quiet", quiet=True) == 0:
        log("      لا توجد ملفات جديدة منذ آخر حفظ.")
    else:
        _, stat = git_out("diff", "--cached", "--shortstat")
        if git("commit", "-m", "تحديث المعرض", quiet=True) != 0:
            return fail("فشل الحفظ.")
        log(f"      تم الحفظ. {stat}")

    # ── 3) رفع ───────────────────────────────────────────────
    _, ahead = git_out("rev-list", "--count", "@{u}..HEAD")
    has_upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", quiet=True) == 0

    if has_upstream and ahead == "0":
        log("")
        log("      المتجر محدّث على الإنترنت أصلًا — لا شيء لرفعه.")
        log(f"      {SITE}")
        return 0

    log("")
    log("[3/3] الرفع إلى GitHub...")
    if not has_upstream:
        log("")
        log("      ⚠ ستظهر الآن نافذة زرقاء لتسجيل الدخول إلى GitHub.")
        log("        اضغط فيها: Sign in with your browser")
        log("        ثم وافق في المتصفح، وارجع إلى هنا.")
        log("        تظهر مرة واحدة فقط.")
    log("")

    if check_only:
        log("      (وضع التجربة — تم تخطّي الرفع)")
        return 0

    code = git("push", "-u", "origin", "main") if not has_upstream else git("push")
    if code != 0:
        return fail("فشل الرفع. تحقّق من الإنترنت ومن تسجيل الدخول، ثم أعد المحاولة.")

    log("")
    log("=" * 52)
    log("   ✔ تم النشر بنجاح")
    log("")
    log(f"   المتجر : {SITE}")
    log(f"   اللوحة : {SITE}admin.html")
    log("")
    log("   يظهر التحديث خلال دقيقة تقريبًا.")
    log("=" * 52)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("\nأُلغي.")
        sys.exit(1)
