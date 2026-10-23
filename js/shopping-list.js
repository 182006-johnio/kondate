// 買い物リスト。DOM にも保存にも触れない純関数だけを置く。
//
// 1 週間の献立の枠から、買う食材を合計する。
// - 同梱レシピは分量データ（details）の食材を 1 人分（grams ÷ servings）で数える
// - 自分のレシピと分量データの無いレシピは、レシピの食材名だけ（回数）で数える
// - 調味料は入れない。家に無い調味料だけを別に出す
// - 余り食材に当たる食材は入れず、別に出す
// - 夕食の前提（キャベツ半玉・炭水化物 270g）は日数分を足す

import { DINNER_CARB_GRAMS } from './nutrition.js';
import { missingSeasonings, normalizeName, sameIngredient } from './schema.js';

// 分量データの食材のうち調味料に当たる食品（data/foods.js のキー）。買い物リストには入れない。
const SEASONING_FOODS = new Set([
  'salt', 'soy_sauce', 'miso_low_salt', 'mirin', 'sake', 'vinegar', 'balsamic', 'wine_vinegar',
  'olive_oil', 'sesame_oil', 'coconut_oil', 'honey', 'sugar_brown', 'curry_powder', 'oyster_sauce',
  'dashi', 'chicken_stock', 'dashi_granule', 'mentsuyu_3x', 'pepper_black', 'basil_dried',
]);

// 夕食の前提で数える食材と、そのときの呼び名。
const BASE_CARB_NAME = {
  rice: '米',
  udon: 'ゆでうどん',
  pasta: 'パスタ（ゆで上がり）',
  soba: 'そば（ゆで上がり）',
};

// ご飯 1 合（米 150g）は炊き上がりでおよそ 330g。
const COOKED_GRAMS_PER_GO = 330;

// days: その週の日付の配列。slots: その週の枠。
// 返り値:
//   base:     夕食の前提（[{ name, text }]）
//   items:    買う食材（[{ name, grams | null, count, recipes }]、名前順）
//   leftovers: 余り食材で足りる食材（同じ形）
//   missingSeasonings: 家に無い調味料（[{ name, recipes }]）
export function shoppingList({ days, slots, byId, details, inventory, pantry }) {
  const lines = new Map();
  const missing = new Map();

  for (const slot of slots) {
    const recipe = byId.get(slot.recipe_id);
    if (!recipe) continue;

    for (const name of missingSeasonings(recipe, pantry)) {
      const entry = missing.get(name) ?? { name, recipes: [] };
      if (!entry.recipes.includes(recipe.name)) entry.recipes.push(recipe.name);
      missing.set(name, entry);
    }

    for (const { name, grams } of ingredientsOf(recipe, details)) {
      const key = normalizeName(name);
      const line = lines.get(key) ?? { name: key, grams: 0, hasGrams: true, count: 0, recipes: [] };
      line.count += 1;
      if (grams === null) line.hasGrams = false;
      else line.grams += grams;
      if (!line.recipes.includes(recipe.name)) line.recipes.push(recipe.name);
      lines.set(key, line);
    }
  }

  const items = [];
  const leftovers = [];
  for (const line of lines.values()) {
    const item = {
      name: line.name,
      grams: line.hasGrams ? Math.round(line.grams) : null,
      count: line.count,
      recipes: line.recipes,
    };
    (inventory.some((name) => sameIngredient(name, line.name)) ? leftovers : items).push(item);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'ja');

  return {
    base: baseItems({ days, slots, byId, details, inventory }),
    items: items.sort(byName),
    leftovers: leftovers.sort(byName),
    missingSeasonings: [...missing.values()].sort(byName),
  };
}

// そのレシピ 1 人分の食材（調味料を除く）。grams が分からなければ null。
function ingredientsOf(recipe, details) {
  const detail = recipe.source === 'mine' ? undefined : details[recipe.id];
  if (!detail) return recipe.ingredients.map((item) => ({ name: item.name, grams: null }));
  return detail.ingredients
    .filter((item) => !SEASONING_FOODS.has(item.food))
    .map((item) => ({ name: item.name, grams: item.grams / detail.servings }));
}

function baseItems({ days, slots, byId, details, inventory }) {
  const carbGrams = { rice: 0, udon: 0, pasta: 0, soba: 0 };
  for (const date of days) {
    const carbSlot = slots.find((slot) => slot.date === date && slot.meal === 'dinner' && slot.part === 'carb');
    const recipe = carbSlot ? byId.get(carbSlot.recipe_id) : undefined;
    const base = recipe?.kind === 'noodle' ? details[recipe.id]?.base_carb ?? 'rice' : 'rice';
    carbGrams[base] += DINNER_CARB_GRAMS;
  }

  const result = [];
  const covered = (name) => inventory.some((item) => sameIngredient(item, name));
  result.push({
    name: 'キャベツ',
    text: `${days.length / 2}玉（夕食のサラダ ${days.length}日分）`,
    leftover: covered('キャベツ'),
  });
  for (const [key, grams] of Object.entries(carbGrams)) {
    if (grams === 0) continue;
    const name = BASE_CARB_NAME[key];
    const text = key === 'rice'
      ? `約 ${(grams / COOKED_GRAMS_PER_GO).toFixed(1)}合（ご飯 ${grams.toLocaleString('ja-JP')}g）`
      : `${grams.toLocaleString('ja-JP')}g`;
    result.push({ name, text, leftover: covered(name) });
  }
  return result;
}

// 画面用の量の表記。例: 約 650g（3回）、約 1.2kg（2回）、2回
export function formatAmount(item) {
  const times = `${item.count}回`;
  if (item.grams === null) return times;
  const amount = item.grams >= 1000 ? `${(item.grams / 1000).toFixed(1)}kg` : `${item.grams}g`;
  return `約 ${amount}（${times}）`;
}
