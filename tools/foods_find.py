"""foods_all.json を食品名のキーワードで探す。全角空白区切りの複数語は AND。

使い方: python -I foods_find.py <foods_all.json> <キーワード> [<キーワード> ...]
各キーワードごとに最大 12 件を表示する。
"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
foods = json.load(open(sys.argv[1], encoding="utf-8"))
for query in sys.argv[2:]:
    words = query.split("+")
    hits = [(no, f) for no, f in foods.items() if all(w in f["name"] for w in words)]
    print(f"== {query} ({len(hits)})")
    for no, f in hits[:12]:
        print(no, f["name"], f["kcal"], f["protein"], f["fat"], f["carb"], f["fiber"], f["salt"])
