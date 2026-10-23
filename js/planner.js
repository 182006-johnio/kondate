// 献立の提案ロジック。DOM にも保存にも触れない純関数だけを置く。
//
// 乱数は random 引数で受け取る（Math.random と同じく 0 以上 1 未満を返す関数）。
// テストでは固定の乱数列を渡し、結果を再現できるようにする。
//
// 候補の絞り込み（CLAUDE.md「提案ロジック」）:
//   0. その枠の meal と part に合うレシピ（fitsSlot）
//   1. 同じ週の昼・夕で、まだ使っていない
//   2. 同じ日の昼・夕の各パーツと protein が重ならない
//   3. 夕の protein パーツは、前日と翌日の夕の protein パーツと protein が重ならない
// 候補が無ければ 3 → 2 → 1 の順に条件を外す。0 も満たせないときだけ未提案（null）にする。
//
// pantry（家にある調味料）を渡すと、家に無い調味料を使うレシピは 0 の段階で外す。
// これは緩めない。作れないレシピを出すよりは未提案のほうがよい。
//
// 木曜は魚の日。木曜夕の protein パーツは魚（protein: fish）から選ぶ。
// 魚のレシピが 1 件も無いときだけ、この決まりを外す。
//
// inventory（余り食材）を渡すと、上の条件を満たした候補の中で余り食材を使うレシピを優先する。
// 優先は最後にかけるだけで、上の条件を破ってまで余り食材を使うことはしない。

import { addDays, weekDates, weekdayOf } from './dates.js';
import { MEALS, PARTS, fitsSlot, inventoryMatches, missingSeasonings, slotKey } from './schema.js';

// 朝食は毎日同じものを出す前提なので、重複・protein の比較に入れない。
const COMPARED_MEALS = ['lunch', 'dinner'];

const FISH_DAY = 4; // 木曜

// その枠で決まっている protein。無ければ null。
function requiredProtein(date, meal, part) {
  return meal === 'dinner' && part === 'protein' && weekdayOf(date) === FISH_DAY ? 'fish' : null;
}

// 週の献立をまとめて作る。返すのはその週の枠の配列で、そのまま storage.putSlots に渡せる。
//
// slots には前週の日曜を含めて渡す（月曜の夕食を前日と比べるため）。
// 週の中の固定枠はそのまま返し、固定していない枠は作り直す。
export function planWeek({
  weekStart, recipes, slots, breakfastRecipeId, random, pantry = null, inventory = [],
}) {
  const days = weekDates(weekStart);
  const inWeek = new Set(days);

  // すでに決まっている枠。週の外の枠（前週の日曜など）は比較にだけ使い、返さない。
  // 週の中で固定していない枠は作り直すので、ここには入れない。
  const decided = new Map();
  for (const slot of slots) {
    if (inWeek.has(slot.date) && !slot.locked) continue;
    decided.set(keyOf(slot), slot);
  }

  const context = { recipes, byId: indexById(recipes), days, random, pantry, inventory };
  const result = [];

  for (const date of days) {
    for (const meal of MEALS) {
      for (const part of PARTS[meal]) {
        const key = slotKey(date, meal, part);
        const current = decided.get(key);
        if (current) {
          result.push(current);
          continue;
        }

        const recipeId = meal === 'breakfast'
          ? breakfastRecipeId
          : pickRecipe({ ...context, date, meal, part, decided, exclude: [] });
        if (!recipeId) continue;

        const slot = { date, meal, part, recipe_id: recipeId, locked: false };
        decided.set(key, slot);
        result.push(slot);
      }
    }
  }

  return result;
}

// 1 枠だけ引き直す。今のレシピは避けるが、他に候補が無ければ今のレシピを返す。
// slots には週の全枠と前週の日曜・翌週の月曜を含めて渡す。
// 返すのは新しい枠（固定なし）。候補が 1 件も無いときは null。
export function rerollSlot({ date, meal, part, recipes, slots, random, pantry = null, inventory = [] }) {
  const key = slotKey(date, meal, part);
  const decided = new Map();
  let currentId = null;
  for (const slot of slots) {
    if (keyOf(slot) === key) {
      currentId = slot.recipe_id;
      continue;
    }
    decided.set(keyOf(slot), slot);
  }

  const recipeId = pickRecipe({
    recipes,
    byId: indexById(recipes),
    days: weekDates(date),
    random,
    pantry,
    inventory,
    date,
    meal,
    part,
    decided,
    exclude: currentId ? [currentId] : [],
  });
  return recipeId ? { date, meal, part, recipe_id: recipeId, locked: false } : null;
}

// --- 内部 -------------------------------------------------------------

function pickRecipe({ recipes, byId, days, random, pantry, inventory = [], date, meal, part, decided, exclude }) {
  let fitting = recipes.filter((recipe) => fitsSlot(recipe, meal, part)
    && (pantry === null || missingSeasonings(recipe, pantry).length === 0));
  const required = requiredProtein(date, meal, part);
  if (required && fitting.some((recipe) => recipe.protein === required)) {
    fitting = fitting.filter((recipe) => recipe.protein === required);
  }
  let pool = fitting.filter((recipe) => !exclude.includes(recipe.id));
  // 避けたいレシピしか無いなら、それでも空にするよりはよい。
  if (pool.length === 0) pool = fitting;
  if (pool.length === 0) return null;

  const used = usedInWeek(decided, days);
  const sameDay = proteinsOf(byId, slotsOfDay(decided, date));
  // 木曜の昼は夕の protein より先に選ぶ。夕が魚に決まっているので、昼から魚を外しておく。
  const dinnerProtein = requiredProtein(date, 'dinner', 'protein');
  if (dinnerProtein && part !== 'protein' && !decided.has(slotKey(date, 'dinner', 'protein'))) {
    sameDay.add(dinnerProtein);
  }
  const neighbors = part === 'protein'
    ? new Set([
      neighborProtein(byId, decided, addDays(date, -1)),
      neighborProtein(byId, decided, addDays(date, 1)),
    ].filter(Boolean))
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
    if (candidates.length === 0) continue;
    const leftovers = unusedLeftovers(inventory, used, byId);
    const usingLeftovers = candidates.filter((recipe) => inventoryMatches(recipe, leftovers).length > 0);
    return choose(usingLeftovers.length > 0 ? usingLeftovers : candidates, random).id;
  }
  return null; // pool が空でない限りここには来ない（count = 0 で必ず候補がある）
}

// 余り食材のうち、その週のまだどのレシピにも使われていないもの。
// 余りは一度使えば片付くので、使ったあとは優先しない（同じ食材ばかり続かないように）。
function unusedLeftovers(inventory, usedIds, byId) {
  if (inventory.length === 0) return inventory;
  const usedRecipes = [...usedIds].map((id) => byId.get(id)).filter(Boolean);
  return inventory.filter((name) => !usedRecipes.some((recipe) => inventoryMatches(recipe, [name]).length > 0));
}

// 週の中の昼・夕で使っているレシピ。
function usedInWeek(decided, days) {
  const used = new Set();
  for (const date of days) {
    for (const slot of slotsOfDay(decided, date)) used.add(slot.recipe_id);
  }
  return used;
}

// その日の昼・夕の決まっている枠。
function slotsOfDay(decided, date) {
  const slots = [];
  for (const meal of COMPARED_MEALS) {
    for (const part of PARTS[meal]) {
      const slot = decided.get(slotKey(date, meal, part));
      if (slot) slots.push(slot);
    }
  }
  return slots;
}

// 隣の日の夕の protein パーツの protein。
// まだ決まっていなくても、木曜のように決まりがあればそれを使う。水曜を選ぶ時点で
// 木曜は未定なので、こうしないと水曜に魚を出して木曜と重なる。
function neighborProtein(byId, decided, date) {
  const slot = decided.get(slotKey(date, 'dinner', 'protein'));
  const protein = slot ? byId.get(slot.recipe_id)?.protein : requiredProtein(date, 'dinner', 'protein');
  return protein && protein !== 'none' ? protein : null;
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

function keyOf(slot) {
  return slotKey(slot.date, slot.meal, slot.part);
}

function indexById(recipes) {
  return new Map(recipes.map((recipe) => [recipe.id, recipe]));
}

// random() が 1 に極めて近い値を返しても範囲外にならないよう、末尾で抑える。
function choose(items, random) {
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  return items[index];
}
