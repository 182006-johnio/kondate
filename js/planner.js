// 献立の提案ロジック。DOM にも保存にも触れない純関数だけを置く。
//
// 乱数は random 引数で受け取る（Math.random と同じく 0 以上 1 未満を返す関数）。
// テストでは固定の乱数列を渡し、結果を再現できるようにする。
//
// 候補の絞り込み（CLAUDE.md「提案ロジック」）:
//   1. その食事 (meals) に使えるレシピ
//   2. 同じ週の昼・夕で、まだ使っていない
//   3. 同じ日の昼と夕で protein が重ならない
//   4. 夕食は、前日と翌日の夕食と protein が重ならない
// 候補が無ければ 4 → 3 → 2 の順に条件を外す。1 も満たせないときだけ未提案（null）にする。

import { addDays, weekDates } from './dates.js';
import { MEALS, slotKey } from './schema.js';

// 週の献立をまとめて作る。返すのはその週の枠の配列で、そのまま storage.putSlots に渡せる。
//
// slots には前週の日曜を含めて渡す（月曜の夕食を前日と比べるため）。
// 週の中の固定枠はそのまま返し、固定していない枠は作り直す。
export function planWeek({ weekStart, recipes, slots, breakfastRecipeId, random }) {
  const days = weekDates(weekStart);
  const inWeek = new Set(days);

  // すでに決まっている枠。週の外の枠（前週の日曜など）は比較にだけ使い、返さない。
  // 週の中で固定していない枠は作り直すので、ここには入れない。
  const decided = new Map();
  for (const slot of slots) {
    if (inWeek.has(slot.date) && !slot.locked) continue;
    decided.set(slotKey(slot.date, slot.meal), slot);
  }

  const context = { recipes, byId: indexById(recipes), days, random };
  const result = [];

  for (const date of days) {
    for (const meal of MEALS) {
      const key = slotKey(date, meal);
      const current = decided.get(key);
      if (current) {
        result.push(current);
        continue;
      }

      const recipeId = meal === 'breakfast'
        ? breakfastRecipeId
        : pickRecipe({ ...context, date, meal, decided, exclude: [] });
      if (!recipeId) continue;

      const slot = { date, meal, recipe_id: recipeId, locked: false };
      decided.set(key, slot);
      result.push(slot);
    }
  }

  return result;
}

// 1 枠だけ引き直す。今のレシピは避けるが、他に候補が無ければ今のレシピを返す。
// slots には週の全枠と前週の日曜・翌週の月曜を含めて渡す。
// 返すのは新しい枠（固定なし）。候補が 1 件も無いときは null。
export function rerollSlot({ date, meal, recipes, slots, random }) {
  const key = slotKey(date, meal);
  const decided = new Map();
  let currentId = null;
  for (const slot of slots) {
    const slotK = slotKey(slot.date, slot.meal);
    if (slotK === key) {
      currentId = slot.recipe_id;
      continue;
    }
    decided.set(slotK, slot);
  }

  const recipeId = pickRecipe({
    recipes,
    byId: indexById(recipes),
    days: weekDates(date),
    random,
    date,
    meal,
    decided,
    exclude: currentId ? [currentId] : [],
  });
  return recipeId ? { date, meal, recipe_id: recipeId, locked: false } : null;
}

// --- 内部 -------------------------------------------------------------

function pickRecipe({ recipes, byId, days, random, date, meal, decided, exclude }) {
  let pool = recipes.filter((recipe) => recipe.meals.includes(meal) && !exclude.includes(recipe.id));
  // 避けたいレシピしか無いなら、それでも空にするよりはよい。
  if (pool.length === 0) pool = recipes.filter((recipe) => recipe.meals.includes(meal));
  if (pool.length === 0) return null;

  const used = usedInWeek(decided, days);
  const sameDay = proteinsOf(byId, [decided.get(slotKey(date, otherMeal(meal)))]);
  const neighbors = meal === 'dinner'
    ? proteinsOf(byId, [
      decided.get(slotKey(addDays(date, -1), 'dinner')),
      decided.get(slotKey(addDays(date, 1), 'dinner')),
    ])
    : new Set();

  // 前の条件ほど優先度が高い。満たせないときは後ろから外していく。
  const rules = [
    (recipe) => !used.has(recipe.id),
    (recipe) => !sameDay.has(recipe.protein),
    (recipe) => !neighbors.has(recipe.protein),
  ];

  for (let count = rules.length; count >= 0; count -= 1) {
    const active = rules.slice(0, count);
    const candidates = pool.filter((recipe) => active.every((rule) => rule(recipe)));
    if (candidates.length > 0) return choose(candidates, random).id;
  }
  return null; // pool が空でない限りここには来ない（count = 0 で必ず候補がある）
}

// 週の中の昼・夕で使っているレシピ。朝食は毎日同じものを出す前提なので数えない。
function usedInWeek(decided, days) {
  const used = new Set();
  for (const date of days) {
    for (const meal of ['lunch', 'dinner']) {
      const slot = decided.get(slotKey(date, meal));
      if (slot) used.add(slot.recipe_id);
    }
  }
  return used;
}

// 枠のレシピの protein を集める。none と、レシピ集から消えたレシピは比較に使わない。
function proteinsOf(byId, slots) {
  const proteins = new Set();
  for (const slot of slots) {
    const protein = slot ? byId.get(slot.recipe_id)?.protein : undefined;
    if (protein && protein !== 'none') proteins.add(protein);
  }
  return proteins;
}

// 同じ日の比べる相手。朝食は昼・夕のどちらとも比べない。
function otherMeal(meal) {
  if (meal === 'lunch') return 'dinner';
  if (meal === 'dinner') return 'lunch';
  return null;
}

function indexById(recipes) {
  return new Map(recipes.map((recipe) => [recipe.id, recipe]));
}

// random() が 1 に極めて近い値を返しても範囲外にならないよう、末尾で抑える。
function choose(items, random) {
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  return items[index];
}
