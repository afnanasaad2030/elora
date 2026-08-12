#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
يفحص مجلد media/ ويولّد data.json تلقائيًا.

الاستخدام:  python tools/build.py
اسم المجلد الفرعي داخل media/ = اسم التصنيف الذي يظهر في الموقع.

المكتبات الاختيارية:
  Pillow  -> ينشئ صورًا مصغّرة (يجعل الموقع أسرع بكثير)   pip install pillow
  ffmpeg  -> يستخرج صورة غلاف لكل فيديو
بدونهما يعمل السكربت لكن بجودة أداء أقل.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

ROOT       = Path(__file__).resolve().parent.parent
MEDIA      = ROOT / "media"
THUMBS     = MEDIA / "_thumbs"
OUT        = ROOT / "data.json"

IMAGE_EXT  = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"}
VIDEO_EXT  = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
THUMB_MAX  = 700          # أطول ضلع للصورة المصغّرة
THUMB_Q    = 78           # جودة WebP
NEW_DAYS   = 7            # يعتبر العنصر "جديدًا" خلال هذه المدة
DEFAULT_CAT = "عام"

try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

FFMPEG = shutil.which("ffmpeg")


# ---------------------------------------------------------------- أدوات مساعدة
def log(msg):
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("utf-8", "replace").decode("ascii", "replace"))


def url_path(rel: Path) -> str:
    """يحوّل مسار ملف إلى رابط صالح (يشفّر المسافات والحروف العربية)."""
    return "/".join(quote(p) for p in rel.as_posix().split("/"))


def make_id(rel: Path) -> str:
    """معرّف ثابت للعنصر — يبقى نفسه ما دام اسم الملف لم يتغيّر."""
    s = unicodedata.normalize("NFKC", rel.with_suffix("").as_posix())
    s = re.sub(r"[\s/\\]+", "-", s)
    return re.sub(r"[^\w؀-ۿ-]", "", s).strip("-").lower()


def pretty_title(stem: str) -> str:
    """اسم الملف -> عنوان معروض. احذف بادئات مثل IMG_20240115_ أو 001_ ."""
    s = stem
    s = re.sub(r"^(IMG|VID|PXL|DSC|PHOTO|WhatsApp[ _-]?(Image|Video))[-_ ]*", "", s, flags=re.I)
    s = re.sub(r"^\d{4}[-_]?\d{2}[-_]?\d{2}([-_ ]?\d{2}[-_]?\d{2}([-_]?\d{2})?)?[-_ ]*", "", s)
    s = re.sub(r"^\d{1,4}[-_. ]+", "", s)
    s = re.sub(r"[-_]+", " ", s).strip()
    return s or stem


# ------------------------------------------------- قراءة الأبعاد بدون مكتبات
def dims_stdlib(path: Path):
    """يقرأ العرض والارتفاع من ترويسة الملف مباشرة (PNG/JPEG/GIF/WEBP)."""
    try:
        with open(path, "rb") as f:
            head = f.read(32)

            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")

            if head[:6] in (b"GIF87a", b"GIF89a"):
                return int.from_bytes(head[6:8], "little"), int.from_bytes(head[8:10], "little")

            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                fmt = head[12:16]
                if fmt == b"VP8 ":
                    return (int.from_bytes(head[26:28], "little") & 0x3FFF,
                            int.from_bytes(head[28:30], "little") & 0x3FFF)
                if fmt == b"VP8L":
                    b = int.from_bytes(head[21:25], "little")
                    return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
                if fmt == b"VP8X":
                    return (int.from_bytes(head[24:27], "little") + 1,
                            int.from_bytes(head[27:30], "little") + 1)

            if head[:2] == b"\xff\xd8":                     # JPEG
                f.seek(2)
                while True:
                    b = f.read(1)
                    if not b:
                        break
                    if b != b"\xff":
                        continue
                    while b == b"\xff":
                        b = f.read(1)
                    marker = b[0]
                    if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                        continue
                    seg = f.read(2)
                    if len(seg) < 2:
                        break
                    length = int.from_bytes(seg, "big")
                    if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                        data = f.read(5)
                        if len(data) < 5:
                            break
                        return (int.from_bytes(data[3:5], "big"),
                                int.from_bytes(data[1:3], "big"))
                    f.seek(length - 2, os.SEEK_CUR)
    except Exception:
        pass
    return None, None


def get_dims(path: Path):
    if HAS_PIL:
        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im)
                return im.size
        except Exception:
            pass
    return dims_stdlib(path)


# -------------------------------------------------------------- المصغّرات
def build_thumb(src: Path, rel: Path):
    """ينشئ صورة مصغّرة WebP. يتخطّى الملف إذا كانت المصغّرة محدّثة أصلًا."""
    if not HAS_PIL:
        return None
    dest = THUMBS / rel.with_suffix(".webp")
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return dest
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGB")
            im.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
            im.save(dest, "WEBP", quality=THUMB_Q, method=4)
        return dest
    except Exception as e:
        log(f"  ! تعذّر تصغير {rel}: {e}")
        return None


def build_poster(src: Path, rel: Path):
    """يستخرج صورة غلاف من الفيديو باستخدام ffmpeg."""
    if not FFMPEG:
        return None
    dest = THUMBS / rel.with_suffix(".jpg")
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return dest
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-ss", "1", "-i", str(src),
             "-frames:v", "1", "-vf", f"scale={THUMB_MAX}:-2", str(dest)],
            check=True, timeout=90,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return dest if dest.exists() else None
    except Exception:
        return None


# ------------------------------------------------------------------ الفحص
def scan():
    items, skipped = [], 0

    for path in sorted(MEDIA.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(MEDIA)
        if rel.parts[0].startswith((".", "_")) or path.name.startswith("."):
            continue

        ext = path.suffix.lower()
        if ext in IMAGE_EXT:
            kind = "image"
        elif ext in VIDEO_EXT:
            kind = "video"
        else:
            skipped += 1
            continue

        category = rel.parts[0] if len(rel.parts) > 1 else DEFAULT_CAT
        mtime = path.stat().st_mtime

        if kind == "image":
            w, h = get_dims(path)
            thumb = build_thumb(path, rel)
        else:
            w, h = None, None
            thumb = build_poster(path, rel)

        items.append({
            "id":       make_id(rel),
            "title":    pretty_title(path.stem),
            "category": category,
            "type":     kind,
            "src":      "media/" + url_path(rel),
            "thumb":    ("media/" + url_path(thumb.relative_to(MEDIA))) if thumb else None,
            "w":        w,
            "h":        h,
            "added":    datetime.fromtimestamp(mtime).isoformat(timespec="seconds"),
            "_mtime":   mtime,
        })

    items.sort(key=lambda i: i["_mtime"], reverse=True)   # الأحدث أولًا
    for i in items:
        i.pop("_mtime")
    return items, skipped


ASSET_REF = re.compile(r'(href|src)="(assets/[^"?]+\.(?:css|js|png))(?:\?v=[^"]*)?"')


def stamp_assets(version):
    """يلحق رقم إصدار بروابط الملفات داخل صفحات HTML.

    بدونه يظل المتصفح يعرض النسخة القديمة من التصميم أو الشعار بعد أي تحديث،
    وهي أكثر مشكلة محيّرة لمن يدير المتجر ("عدّلت ولا أرى التغيير").
    """
    changed = 0
    for name in ("index.html", "admin.html"):
        p = ROOT / name
        if not p.exists():
            continue
        old = p.read_text(encoding="utf-8")
        new = ASSET_REF.sub(lambda m: f'{m.group(1)}="{m.group(2)}?v={version}"', old)
        if new != old:
            p.write_text(new, encoding="utf-8")
            changed += 1
    return changed


def prune_orphans(items):
    """يحذف المصغّرات التي لم يعد لها ملف أصلي."""
    if not THUMBS.exists():
        return 0
    alive = {i["thumb"] for i in items if i["thumb"]}
    removed = 0
    for t in THUMBS.rglob("*"):
        if t.is_file():
            key = "media/" + url_path(t.relative_to(MEDIA))
            if key not in alive:
                t.unlink()
                removed += 1
    return removed


def main():
    if not MEDIA.exists():
        MEDIA.mkdir(parents=True)
        log(f"أنشأت المجلد: {MEDIA}")

    log("جارٍ فحص مجلد media ...")
    if not HAS_PIL:
        log("  تنبيه: مكتبة Pillow غير مثبّتة — لن تُنشأ صور مصغّرة.")
        log("         ثبّتها بالأمر:  pip install pillow")
    if not FFMPEG:
        log("  تنبيه: ffmpeg غير موجود — لن تُستخرج صور غلاف للفيديوهات.")

    items, skipped = scan()
    removed = prune_orphans(items)

    now = datetime.now()
    version = now.strftime("%Y%m%d%H%M%S")
    stamped = stamp_assets(version)

    OUT.write_text(
        json.dumps(
            {"generated": now.isoformat(timespec="seconds"),
             "version": version,
             "items": items},
            ensure_ascii=False, indent=1,
        ),
        encoding="utf-8",
    )

    cats = {}
    for i in items:
        cats[i["category"]] = cats.get(i["category"], 0) + 1

    log("")
    log(f"تم: {len(items)} عنصر في data.json")
    for c, n in sorted(cats.items(), key=lambda x: -x[1]):
        log(f"   - {c}: {n}")
    if skipped:
        log(f"   (تم تجاهل {skipped} ملفًا غير مدعوم)")
    if removed:
        log(f"   (حُذفت {removed} مصغّرة قديمة)")
    if stamped:
        log(f"   (حُدّث رقم إصدار الملفات في {stamped} صفحة: {version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
