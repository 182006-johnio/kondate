// 栄養計算。DOM にも保存にも触れない純関数だけを置く。
//
// 値はすべて 1 人分で、項目は kcal / protein / fat / carb / fiber / salt（g）。
// 食品の値は data/foods.js（日本食品標準成分表）の 100g あたり。
//
// レシピ 1 人分の栄養の決め方:
//   - 自分のレシピ: recipe.nutrition（入力した値）
//   - 同梱レシピ: 分量データ（details）の食材 × 成分表 ÷ servings。
//     元ページに載っている値（published）があれば、その項目は published を使う
// 夕食は毎日の前提として キャベツ半玉（500g）と炭水化物 270g を足す。
// 炭水化物はご飯。carb パーツが麺のレシピで base_carb があれば、その麺で数える。

import { GOAL_FIELDS, PARTS } from './schema.js';

export const NUTRIENTS = GOAL_FIELDS;
export const DINNER_CABBAGE_GRAMS = 500;
export const DINNER_CARB_GRAMS = 270;

const BASE_CARB_FOOD = { rice: 'rice_cooked', udon: 'udon_boiled', pasta: 'pasta_boiled', soba: 'soba_boiled' };

export function emptyValues() {
  return Object.fromEntries(NUTRIENTS.map((key) => [key, 0]));
}

// 食品 grams g ぶん。成分表で未測定（null）の項目は 0 として足す。
export function foodValues(food, grams) {
  const values = emptyValues();
  for (const key of NUTRIENTS) values[key] = ((food[key] ?? 0) * grams) / 100;
  return values;
}

function add(target, values) {
  for (const key of NUTRIENTS) target[key] += values[key] ?? 0;
  return target;
}

// 分量データの食材から合計を出す。成分表に無い食材（food が null や未知のキー）は unknown に入れる。
export function sumIngredients(ingredients, foods) {
  const totals = emptyValues();
  const unknown = [];
  for (const item of ingredients) {
    const food = item.food ? foods[item.food] : undefined;
    if (!food) {
      unknown.push(item.name);
      continue;
    }
    add(totals, foodValues(food, item.grams));
  }
  return { totals, unknown };
}

// レシピ 1 人分の栄養。分からなければ null。
// 返り値: { values, source: 'mine' | 'details', unknown: 成分表に無かった食材名 }
export function recipeNutrition(recipe, details, foods) {
  if (!recipe) return null;
  if (recipe.source === 'mine') {
    if (!recipe.nutrition) return null;
    const values = emptyValues();
    for (const key of NUTRIENTS) values[key] = recipe.nutrition[key] ?? 0;
    return { values, source: 'mine', unknown: [] };
  }

  const detail = details[recipe.id];
  if (!detail) return null;
  const { totals, unknown } = sumIngredients(detail.ingredients, foods);
  const values = emptyValues();
  for (const key of NUTRIENTS) {
    const published = detail.published?.[key];
    values[key] = published ?? totals[key] / detail.servings;
  }
  return { values, source: 'details', unknown };
}

// その日の炭水化物 270g に使う食品のキー。
export function baseCarbFood(carbRecipe, details) {
  const base = carbRecipe?.kind === 'noodle' ? details[carbRecipe.id]?.base_carb : undefined;
  return BASE_CARB_FOOD[base ?? 'rice'];
}

// 1 日分。slots はその日の枠、byId は id → レシピ。
// 返り値: { totals, items: [{ meal, part, name, values | null }], unknownCount }
// 栄養が分からない枠は合計に入れず、unknownCount に数える。
export function dayNutrition({ slots, byId, details, foods }) {
  const items = [];
  const totals = emptyValues();
  let unknownCount = 0;

  const slotOf = (meal, part) => slots.find((slot) => slot.meal === meal && slot.part === part);

  for (const [meal, parts] of Object.entries(PARTS)) {
    for (const part of parts) {
      const slot = slotOf(meal, part);
      if (!slot) continue;
      const recipe = byId.get(slot.recipe_id);
      const nutrition = recipeNutrition(recipe, details, foods);
      if (nutrition) add(totals, nutrition.values);
      else unknownCount += 1;
      items.push({ meal, part, name: recipe ? recipe.name : '見つからないレシピ', values: nutrition?.values ?? null });
    }
  }

  const cabbage = foodValues(foods.cabbage, DINNER_CABBAGE_GRAMS);
  const carbKey = baseCarbFood(byId.get(slotOf('dinner', 'carb')?.recipe_id), details);
  const carb = foodValues(foods[carbKey], DINNER_CARB_GRAMS);
  add(totals, cabbage);
  add(totals, carb);
  items.push(
    { meal: 'dinner', part: 'base', name: `キャベツ半玉（${DINNER_CABBAGE_GRAMS}g）`, values: cabbage },
    { meal: 'dinner', part: 'base', name: `${carbLabel(carbKey)}（${DINNER_CARB_GRAMS}g）`, values: carb },
  );

  return { totals, items, unknownCount };
}

function carbLabel(key) {
  return { rice_cooked: 'ご飯', udon_boiled: 'ゆでうどん', pasta_boiled: 'ゆでパスタ', soba_boiled: 'ゆでそば' }[key];
}

// 目標に対する割合（1 = 100%）。目標が未設定の項目は null。
export function goalRatios(totals, goals) {
  const ratios = {};
  for (const key of NUTRIENTS) {
    const goal = goals?.[key];
    ratios[key] = goal ? totals[key] / goal : null;
  }
  return ratios;
}
