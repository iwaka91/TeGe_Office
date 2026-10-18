#!/usr/bin/env python3
"""Bangun ulang assets/web/js/app.bundle.js dari modul sumber (ES module -> bundle klasik).
Jalankan: python3 TG-Office-Integrated/scripts/build-bundle.py"""
from pathlib import Path
import re, sys
web = Path(__file__).resolve().parents[1] / "app/src/main/assets/web"
ORDER = ["js/utils.js", "js/storage.js", "js/zip-reader.js", "js/viewers/docx.js",
         "js/viewers/xlsx.js", "js/viewers/pptx.js", "js/viewers/pdf.js",
         "js/menu.js", "js/qr.js", "js/cast.js", "js/app.js"]
IMP = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$", re.M)
def resolve(base, rel):
    parts = (Path(base).parent / rel).as_posix().split("/")
    out = []
    for p in parts:
        if p == "..": out.pop()
        elif p and p != ".": out.append(p)
    return "/".join(out)
def convert(mid, src):
    src = IMP.sub(lambda m: "const {%s}=require('%s');" % (m.group(1).replace(" ", ""), resolve(mid, m.group(2))), src)
    names = []
    def exp_decl(m):
        names.append(m.group(3)); return m.group(1) + m.group(2) + " " + m.group(3)
    src = re.sub(r"^(\s*)export\s+((?:async\s+)?function|class|const|let)\s+([A-Za-z_$][\w$]*)", exp_decl, src, flags=re.M)
    def exp_list(m):
        names.extend(x.strip() for x in m.group(1).split(",") if x.strip()); return ""
    src = re.sub(r"^export\s*\{([^}]*)\};?\s*$", exp_list, src, flags=re.M)
    if re.search(r"^\s*(import|export)\b", src, re.M):
        sys.exit("Sintaks import/export tidak didukung di " + mid)
    tail = "\nObject.assign(exports,{%s});\n" % ",".join(names) if names else "\n"
    return "__define('%s',function(module,exports,require){\n%s%s\n});\n" % (mid, src.rstrip("\n") + "\n", tail)
head = """(function(){
'use strict';
const __mods=Object.create(null),__cache=Object.create(null);
function __define(id,fn){__mods[id]=fn}
function require(id){if(__cache[id])return __cache[id].exports;if(!__mods[id])throw new Error('Module not found: '+id);const module={exports:{}};__cache[id]=module;__mods[id](module,module.exports,require);return module.exports}
"""
body = "".join(convert(m, (web / m).read_text(encoding="utf-8")) for m in ORDER if (web / m).exists())
(web / "js/app.bundle.js").write_text(head + body + "require('js/app.js');\n})();\n", encoding="utf-8")
print("app.bundle.js dibangun dari", len([m for m in ORDER if (web / m).exists()]), "modul")
