"""xlsx の 1 シートを TSV に書き出す（標準ライブラリだけで読む）。

使い方: python -I xlsx_dump.py <xlsx> <シート番号 1..> <出力 tsv>
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def main(path, sheet_no, out):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        root = ET.fromstring(z.read(f"xl/worksheets/sheet{sheet_no}.xml"))
        rows = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            cells = {}
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS)
                if c.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                elif v is None:
                    text = ""
                elif c.get("t") == "s":
                    text = shared[int(v.text)]
                else:
                    text = v.text
                cells[col_index(c.get("r"))] = text.replace("\t", " ").replace("\n", " ")
            if cells:
                width = max(cells) + 1
                rows.append("\t".join(cells.get(i, "") for i in range(width)))
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(rows))
    print(len(rows), "rows")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3])
