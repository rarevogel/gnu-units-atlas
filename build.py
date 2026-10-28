#!/usr/bin/env python3
"""
Builds the atlas from src/ and data/:

  index.html                   the web version (one self-contained file, fonts from Google Fonts)
  android/assets/index.html    the same page for the Android app (fonts bundled, works offline)

The page carries definitions.units and currency.units as text and works them out in the
browser with src/core.js, so the files in data/ are all there is to the data. To ship a newer
GNU units release, replace the files in data/ and run this script again.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
GOOGLE = re.compile(r'<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="stylesheet" href="https://fonts.googleapis.com/[^"]+">')


def page():
    template = (HERE / "src" / "template.html").read_text(encoding="utf-8")
    files = {f.name: f.read_text(encoding="utf-8", errors="replace") for f in sorted((HERE / "data").glob("*.units"))}
    if "definitions.units" not in files:
        raise SystemExit("data/definitions.units is missing")
    # '<' is escaped so that nothing in the files can end the <script> element
    payload = json.dumps(files, ensure_ascii=False).replace("<", "\\u003c")
    core = (HERE / "src" / "core.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
    return template.replace("__FILES__", payload).replace("__CORE__", core)


def main():
    html = page()
    (HERE / "index.html").write_text(html, encoding="utf-8")
    assert GOOGLE.search(html), "font link not found in template"
    app = GOOGLE.sub('<link rel="stylesheet" href="fonts/fonts.css">', html)
    app = app.replace("<html lang=\"en\">", "<html lang=\"en\" data-app=\"android\">")
    (HERE / "android" / "assets" / "index.html").write_text(app, encoding="utf-8")
    print(f"index.html: {len(html) // 1024} KB, android/assets/index.html: {len(app) // 1024} KB")


if __name__ == "__main__":
    main()
