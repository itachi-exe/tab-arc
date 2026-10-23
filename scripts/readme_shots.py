"""Capture the README screenshots from the live Tab site.

Usage: python3 scripts/readme_shots.py [base_url]
Writes PNGs into docs/screenshots/.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://tab-arc.vercel.app").rstrip("/")
OUT = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

done, skipped = [], []


def shot(name, fn):
    try:
        fn()
        done.append(name)
    except Exception as e:  # keep going, report at the end
        skipped.append(f"{name}: {type(e).__name__} {str(e)[:120]}")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])

    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pg = ctx.new_page()

    def landing():
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2500)
        pg.screenshot(path=str(OUT / "landing.png"))

    def try_chat():
        pg.goto(BASE + "/try", wait_until="networkidle"); pg.wait_for_timeout(1500)
        box = pg.locator("textarea").first
        box.fill("split 30 with @jay and @kira")
        box.press("Enter")
        pg.wait_for_timeout(9000)
        pg.screenshot(path=str(OUT / "try.png"))

    def join():
        pg.goto(BASE + "/join", wait_until="networkidle"); pg.wait_for_timeout(1800)
        pg.screenshot(path=str(OUT / "join.png"))

    def me():
        pg.goto(BASE + "/me", wait_until="networkidle"); pg.wait_for_timeout(1800)
        pg.screenshot(path=str(OUT / "me.png"))

    shot("landing", landing)
    shot("try", try_chat)
    shot("join", join)
    shot("me", me)
    ctx.close()

    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                      is_mobile=True, has_touch=True)
    mp = m.new_page()

    def mobile():
        mp.goto(BASE + "/", wait_until="networkidle"); mp.wait_for_timeout(2500)
        mp.screenshot(path=str(OUT / "mobile.png"))

    shot("mobile", mobile)
    b.close()

print("done:", done)
if skipped:
    print("skipped:", *skipped, sep="\n  ")
