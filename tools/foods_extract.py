"""sheet1.tsv（成分表 本表）から、食品番号ごとの 6 成分を JSON にする。

使い方: python -I foods_extract.py <sheet1.tsv> <出力 json>
成分識別子の行（"成分識別子" を含む行）から列の位置を決める。
値の表記: (x) は推定値 → x、Tr（微量）→ 0、- （未測定）→ None
"""
import json
import re
import sys

FIELDS = {
    "kcal": "ENERC_KCAL",
    "protein": "PROT-",
    "fat": "FAT-",
    "carb": "CHOCDF-",
    "fiber": "FIB-",
    "salt": "NACL_EQ",
}


def parse(value):
    v = value.strip().strip("()").strip()
    if v in ("", "-", "*"):
        return None
    if v.startswith("Tr"):
        return 0.0
    try:
        return round(float(v), 2)
    except ValueError:
        return None


def main(src, out):
    lines = open(src, encoding="utf-8").read().split("\n")
    header_row = next(i for i, line in enumerate(lines) if "成分識別子" in line)
    header = lines[header_row].split("\t")
    cols = {key: header.index(ident) for key, ident in FIELDS.items()}
    foods = {}
    for line in lines[header_row + 1:]:
        cells = line.split("\t")
        if len(cells) < 4 or not re.fullmatch(r"\d{5}", cells[1].strip()):
            continue
        name = re.sub(r"\s+", " ", cells[3].replace("　", " ")).strip()
        row = {"name": name}
        for key, col in cols.items():
            row[key] = parse(cells[col]) if col < len(cells) else None
        foods[cells[1].strip()] = row
    json.dump(foods, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(foods), "foods")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
