"""献立アプリの data/foods.js を作る。

使い方: python -I make_foods_js.py <foods_all.json> <出力 foods.js>
キー → 食品番号の対応はこのファイルの MAP に書く。数値は成分表の値をそのまま使う。
"""
import json
import sys

MAP = {
    # 夕食の前提（キャベツ半玉・炭水化物 270g）
    "cabbage": "06061",
    "rice_cooked": "01088",
    "rice_raw": "01083",
    "udon_boiled": "01039",
    "pasta_boiled": "01064",
    "soba_boiled": "01128",
    # 肉
    "chicken_breast_skin": "11219",
    "chicken_breast": "11220",
    "chicken_thigh_skin": "11221",
    "chicken_thigh": "11224",
    "chicken_sasami": "11227",
    "pork_shoulder_loin": "11119",
    "pork_loin": "11123",
    "pork_belly": "11129",
    "pork_shoulder": "11115",
    "beef_thigh_lean": "11051",
    "beef_shoulder": "11030",
    # 魚介
    "salmon_coho": "10130",
    "salmon_chum": "10134",
    "salmon_salted": "10139",
    "salmon_atlantic": "10144",
    "mackerel": "10154",
    "mackerel_can": "10164",
    "cod": "10205",
    "yellowtail": "10241",
    "shrimp": "10415",
    "clam": "10281",
    "kamaboko": "10379",
    "katsuobushi": "10091",
    # 卵・大豆
    "egg": "12004",
    "egg_yolk": "12010",
    "tofu_firm": "04032",
    "tofu_silken": "04033",
    "natto": "04046",
    "aburaage": "04040",
    # 野菜・きのこ・いも・海藻
    "onion": "06153",
    "red_onion": "06156",
    "carrot": "06212",
    "potato": "02017",
    "broccoli": "06263",
    "mushroom": "08031",
    "mushroom_brown": "08059",
    "shimeji": "08016",
    "enoki": "08001",
    "maitake": "08028",
    "shiitake": "08039",
    "shiitake_dried": "08013",
    "burdock": "06084",
    "daikon": "06132",
    "taro": "02010",
    "leek": "06226",
    "komatsuna": "06086",
    "spinach": "06267",
    "spinach_boiled": "06268",
    "cherry_tomato": "06183",
    "tomato_can": "06184",
    "tomato_puree": "17034",
    "celery": "06119",
    "cucumber": "06065",
    "turnip": "06036",
    "nagaimo": "02023",
    "yamatoimo": "02025",
    "garlic": "06223",
    "ginger": "06103",
    "leaf_lettuce": "06314",
    "lemon_juice": "07156",
    "shiso": "06095",
    "mitsuba": "06278",
    "konnyaku": "02003",
    "shirataki": "02005",
    "kimchi": "06236",
    "shio_kombu": "09022",
    "sesame": "05018",
    "yogurt": "13025",
    "parmesan": "13038",
    # 調味料
    "salt": "17012",
    "soy_sauce": "17007",
    "miso_low_salt": "17119",
    "mirin": "16025",
    "sake": "16001",
    "vinegar": "17015",
    "balsamic": "17091",
    "wine_vinegar": "17017",
    "olive_oil": "14001",
    "sesame_oil": "14002",
    "coconut_oil": "14013",
    "honey": "03022",
    "sugar_brown": "03004",
    "curry_powder": "17061",
    "oyster_sauce": "17031",
    "dashi": "17021",
    "chicken_stock": "17024",
    "dashi_granule": "17028",
    "mentsuyu_3x": "17030",
    "pepper_black": "17063",
    "basil_dried": "17077",
}

FIELDS = ["kcal", "protein", "fat", "carb", "fiber", "salt"]


def js_number(value):
    if value is None:
        return "null"
    return str(int(value)) if float(value).is_integer() else repr(round(value, 2))


def main(src, out):
    foods = json.load(open(src, encoding="utf-8"))
    lines = [
        "// 食品の栄養成分（可食部 100g あたり）。献立アプリの栄養計算に使う。",
        "//",
        "// 出典: 日本食品標準成分表（八訂）増補2023年（文部科学省）から引用（2026年3月27日更新版の本表）。",
        "// https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html",
        "//",
        "// レシピで使う食品だけを抜き出した。値は成分表のまま（推定値の括弧は外し、Tr は 0、未測定は null）。",
        "// kcal: エネルギー / protein: たんぱく質 / fat: 脂質 / carb: 炭水化物 / fiber: 食物繊維総量 / salt: 食塩相当量",
        "// このファイルは scratchpad のスクリプトで成分表の Excel から生成した。手で数値を直さない。",
        "",
        "export const FOODS = {",
    ]
    for key, no in MAP.items():
        f = foods[no]
        values = ", ".join(f"{field}: {js_number(f[field])}" for field in FIELDS)
        name = f["name"].replace("'", "\\'")
        lines.append(f"  {key}: {{ no: '{no}', name: '{name}', {values} }},")
    lines.append("};")
    lines.append("")
    open(out, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    print(len(MAP), "foods")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
