#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
يولّد باركود QR بصيغة SVG (جودة طباعة لا نهائية) + PNG للمعاينة.

الاستخدام:
    python tools/make_qr.py https://yourname.github.io/store

يتطلّب مرة واحدة:  pip install "qrcode[pil]"
"""

import sys
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "qr"


def main():
    if len(sys.argv) < 2:
        print("الاستخدام: python tools/make_qr.py <رابط المعرض>")
        return 1

    url = sys.argv[1].strip()

    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage
    except ImportError:
        print("المكتبة غير مثبّتة. شغّل هذا الأمر أولًا:")
        print('    pip install "qrcode[pil]"')
        return 1

    OUT_DIR.mkdir(exist_ok=True)

    # ERROR_CORRECT_H = يظل الباركود قابلًا للقراءة حتى لو تلف 30% منه،
    # ويسمح بوضع شعارك في منتصفه لاحقًا.
    def qr(**kw):
        q = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=kw.pop("box", 12),
            border=4,          # الهامش الأبيض — لا تنقصه، بدونه لا تقرأ الكاميرا الباركود
        )
        q.add_data(url)
        q.make(fit=True)
        return q

    svg_path = OUT_DIR / "qr.svg"
    qr().make_image(image_factory=SvgPathImage).save(str(svg_path))

    png_path = OUT_DIR / "qr.png"
    qr(box=20).make_image(fill_color="black", back_color="white").save(str(png_path))

    print("تم إنشاء الباركود:")
    print(f"   {svg_path}   <-- استخدم هذا للمطبعة")
    print(f"   {png_path}   <-- للمعاينة والواتساب")
    print(f"\nالرابط بداخله: {url}")
    print("\nقبل الطباعة: امسح الباركود بجوالك للتأكد أنه يفتح الرابط الصحيح.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
