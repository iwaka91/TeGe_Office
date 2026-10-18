#!/usr/bin/env bash
# Menyiapkan aset web + mesin offline (pdf.js, pptx-renderer). Dipakai CI beta dan rilis Play.
# Jalankan dari akar repo.
set -euo pipefail
web="TG-Office-Integrated/app/src/main/assets/web"
python3 TG-Office-Integrated/scripts/build-bundle.py
for id in openFileBtn viewerScreen backBtn menuBtn viewerMenu; do
  grep -q "id=\"$id\"" "$web/index.html" || { echo "Elemen wajib hilang: $id"; exit 1; }
done
node --check "$web/js/app.bundle.js"
tmp="$(mktemp -d)"
( cd "$tmp" && npm pack --silent pdfjs-dist@6.3.289 @aiden0z/pptx-renderer@1.3.0 >/dev/null )
mkdir -p "$tmp/pdfjs" "$tmp/pptx"
tar -xzf "$tmp"/pdfjs-dist-6.3.289.tgz -C "$tmp/pdfjs"
tar -xzf "$tmp"/aiden0z-pptx-renderer-1.3.0.tgz -C "$tmp/pptx"
rm -rf "$web/vendor" && mkdir -p "$web/vendor/pdfjs/build" "$web/vendor/pptx-renderer"
# .mjs disalin sebagai .js agar WebView mengenali MIME JavaScript
# Build "legacy" dipakai: mesin cadangan ini justru untuk WebView/perangkat lama
cp "$tmp/pdfjs/package/legacy/build/pdf.min.mjs" "$web/vendor/pdfjs/build/pdf.min.js"
cp "$tmp/pdfjs/package/legacy/build/pdf.worker.min.mjs" "$web/vendor/pdfjs/build/pdf.worker.min.js"
for d in cmaps standard_fonts iccs wasm; do
  [ -d "$tmp/pdfjs/package/$d" ] && cp -r "$tmp/pdfjs/package/$d" "$web/vendor/pdfjs/"
done
cp "$tmp/pdfjs/package/LICENSE" "$web/vendor/pdfjs/LICENSE" 2>/dev/null || true
cp "$tmp/pptx/package/dist/aiden0z-pptx-renderer.browser.es.js" "$web/vendor/pptx-renderer/"
cp "$tmp/pptx/package/LICENSE" "$web/vendor/pptx-renderer/LICENSE" 2>/dev/null || true
cp "$tmp/pptx/package/THIRD_PARTY_NOTICES.md" "$web/vendor/pptx-renderer/" 2>/dev/null || true
test -s "$web/vendor/pdfjs/build/pdf.min.js"
test -s "$web/vendor/pptx-renderer/aiden0z-pptx-renderer.browser.es.js"
du -sh "$web/vendor"/* || true
mkdir -p TG-Office-Integrated/app/src/main/res/drawable
cp "$web/assets/icon-512.png" TG-Office-Integrated/app/src/main/res/drawable/tg_office_icon.png
echo "TG Office Beta web assets staged"
