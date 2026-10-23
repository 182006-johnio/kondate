// スキーマ定義・生成・検証。
//
// フィールド名は CLAUDE.md のデータモデル表と同じ snake_case をそのまま使う。
// エクスポートする JSON もこの名前で出るので、仕様書・コード・ファイルで表記を揃えるため。
//
// 検証関数は例外を投げず { ok, errors } を返す。どこがどう不正かを列挙して見せるため。
// 同梱レシピ集（data/recipes.js）もこの validateRecipe で検証する。

import { PANTRY } from '../data/pantry.js';
import { isValidISO } from './dates.js';

// v1 → v2（2026-10-23）: settings に pantry と goals、inventory・shopping_checked・details を追加。
export const SCHEMA_VERSION = 2;

// 1 日の目標。どれも未設定（null）にできる。
export const GOAL_FIELDS = ['kcal', 'protein', 'fat', 'carb', 'fiber', 'salt'];

const PANTRY_ITEM_MAX = 20;

export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const KINDS = ['dish', 'dressing', 'protein', 'rice_side', 'noodle'];
export const SOURCES = ['dlab', 'arrange', 'external', 'mine'];
export const PROTEINS = ['chicken', 'pork', 'beef', 'fish', 'egg', 'soy', 'none'];
export const METHODS = ['sous_vide', 'pot', 'microwave', 'rice_cooker', 'sear', 'none'];

// 食事ごとのパーツ。並びは 1 日の中で選ぶ順（CLAUDE.md「提案ロジック」）でもある。
// 夕食のサラダ（キャベツ半玉）と炭水化物 270g は毎日の前提なので枠にしない。
export const PARTS = {
  breakfast: ['dish'],
  lunch: ['dish'],
  dinner: ['protein', 'carb', 'dressing'],
};

// パーツに入れられるレシピの kind。
export const KINDS_FOR_PART = {
  dish: ['dish'],
  dressing: ['dressing'],
  protein: ['protein'],
  carb: ['rice_side', 'noodle'],
};

const DISH_MEALS = ['breakfast', 'lunch'];
const NAME_MAX = 80;

export function createDB() {
  return {
    schemaVersion: SCHEMA_VERSION,
    recipes: [],
    slots: [],
    settings: createSettings(),
    inventory: [],
    shopping_checked: {},
    details: {},
  };
}

export function createSettings() {
  return { breakfast_recipe_id: null, pantry: [...PANTRY], goals: null };
}

// v1 のデータを v2 の形にする。元のオブジェクトは書き換えない。
// 調味料一覧は初期値（はちみつを含む）で始める。v1 には一覧を持つ場所が無かったため。
export function migrateDB(v1) {
  return {
    schemaVersion: SCHEMA_VERSION,
    // v2 でレシピに nutrition（1 人分の栄養）が増えた。v1 のレシピは未入力にする。
    recipes: Array.isArray(v1.recipes)
      ? v1.recipes.map((recipe) => (isPlainObject(recipe) ? { ...recipe, nutrition: recipe.nutrition ?? null } : recipe))
      : v1.recipes,
    slots: v1.slots,
    settings: { ...createSettings(), ...v1.settings },
    inventory: [],
    shopping_checked: {},
    details: {},
  };
}

// 調味料・食材の名前をそろえる。NFKC を先に、trim を後にかける
// （順序が逆だと全角スペースだけの前後余白が落ちない）。
export function normalizeName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : value;
}

// 空と重複を落とした名前の一覧。文字列でない値は残して検証側に判断を渡す。
export function normalizeNames(values) {
  if (!Array.isArray(values)) return values;
  const seen = new Set();
  const names = [];
  for (const value of values) {
    const name = normalizeName(value);
    if (typeof name !== 'string') {
      names.push(name);
      continue;
    }
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

// そのレシピの調味料がすべて家にあるか。表記は normalizeName でそろえて比べる。
export function missingSeasonings(recipe, pantry) {
  const have = new Set(pantry.map(normalizeName));
  return recipe.seasonings.map((item) => item.name).filter((name) => !have.has(normalizeName(name)));
}

// 自分のレシピを作る。省略した項目は空で埋める。
export function createRecipe(fields) {
  return normalizeRecipe({ ...fields, id: crypto.randomUUID() });
}

// 文字列の前後空白を落とし、省略された項目を既定値で埋める。
// 型が違う値は加工せずそのまま残し、判断を検証側に渡す。黙って直すと不正な入力が通る。
export function normalizeRecipe(fields) {
  const kind = fields.kind ?? 'dish';
  return {
    id: fields.id,
    name: trimText(fields.name),
    kind,
    // 夕食のパーツは夕食にしか使わないので、入力を待たずに決める。
    meals: kind !== 'dish' && KINDS.includes(kind) ? ['dinner'] : normalizeMeals(fields.meals),
    source: fields.source ?? 'mine',
    url: optionalText(fields.url),
    protein: fields.protein ?? 'none',
    method: fields.method ?? 'none',
    ingredients: normalizeItems(fields.ingredients),
    seasonings: normalizeItems(fields.seasonings),
    steps: normalizeSteps(fields.steps),
    minutes: fields.minutes === undefined || fields.minutes === '' ? null : fields.minutes,
    note: optionalText(fields.note),
    nutrition: normalizeNutrition(fields.nutrition),
  };
}

// 1 人分の栄養。全項目が未入力なら null にする（「栄養不明」と区別するため）。
export function normalizeNutrition(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) return value;
  const result = {};
  for (const key of GOAL_FIELDS) {
    const raw = value[key];
    result[key] = raw === undefined || raw === '' ? null : raw;
  }
  return GOAL_FIELDS.every((key) => result[key] === null) ? null : result;
}

function normalizeMeals(values) {
  return Array.isArray(values) ? [...new Set(values)] : values;
}

// 名前が空の行は入力途中の空行とみなして落とす。
function normalizeItems(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) return values;
  return values
    .map((item) => (isPlainObject(item)
      ? { name: trimText(item.name), amount: optionalText(item.amount) }
      : item))
    .filter((item) => !(isPlainObject(item) && item.name === ''));
}

function normalizeSteps(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) return values;
  return values.map(trimText).filter((step) => step !== '');
}

export function createSlot({ date, meal, part, recipe_id, locked = false }) {
  return { date, meal, part, recipe_id, locked };
}

// --- 検証 -------------------------------------------------------------

export function validateRecipe(recipe) {
  const errors = [];
  if (!isPlainObject(recipe)) return result(['レシピがオブジェクトではありません']);
  const label = `レシピ ${String(recipe.id)}`;

  if (!isNonEmptyString(recipe.id)) errors.push(`${label}: id が空です`);
  if (!isNonEmptyString(recipe.name)) errors.push(`${label}: name が空です`);
  else if (recipe.name.length > NAME_MAX) errors.push(`${label}: name が ${NAME_MAX} 文字を超えています`);

  if (!KINDS.includes(recipe.kind)) {
    errors.push(`${label}: kind が不正です: ${String(recipe.kind)}`);
  } else if (recipe.kind === 'dish') {
    if (!Array.isArray(recipe.meals) || recipe.meals.length === 0
      || !recipe.meals.every((meal) => DISH_MEALS.includes(meal))) {
      errors.push(`${label}: 一品料理の meals は breakfast / lunch の 1 つ以上にしてください`);
    }
  } else if (!(Array.isArray(recipe.meals) && recipe.meals.length === 1 && recipe.meals[0] === 'dinner')) {
    errors.push(`${label}: 夕食のパーツの meals は ['dinner'] です`);
  }

  if (!SOURCES.includes(recipe.source)) errors.push(`${label}: source が不正です: ${String(recipe.source)}`);
  if (!PROTEINS.includes(recipe.protein)) errors.push(`${label}: protein が不正です: ${String(recipe.protein)}`);
  if (!METHODS.includes(recipe.method)) errors.push(`${label}: method が不正です: ${String(recipe.method)}`);

  if (typeof recipe.url !== 'string') errors.push(`${label}: url が文字列ではありません`);
  else if (recipe.url !== '' && !/^https?:\/\//.test(recipe.url)) {
    errors.push(`${label}: url は http(s) で始めてください`);
  }

  for (const field of ['ingredients', 'seasonings']) {
    const items = recipe[field];
    if (!Array.isArray(items)) {
      errors.push(`${label}: ${field} が配列ではありません`);
    } else if (!items.every(
      (item) => isPlainObject(item) && isNonEmptyString(item.name) && typeof item.amount === 'string',
    )) {
      errors.push(`${label}: ${field} の各要素は { name, amount } の文字列にしてください`);
    }
  }

  if (!Array.isArray(recipe.steps) || !recipe.steps.every(isNonEmptyString)) {
    errors.push(`${label}: steps は空でない文字列の配列にしてください`);
  }

  if (recipe.minutes !== null && !(Number.isInteger(recipe.minutes) && recipe.minutes >= 0)) {
    errors.push(`${label}: minutes は 0 以上の整数か null にしてください`);
  }
  if (typeof recipe.note !== 'string') errors.push(`${label}: note が文字列ではありません`);
  errors.push(...validateNutrition(recipe.nutrition, `${label}: nutrition`));

  return result(errors);
}

// 栄養値（kcal / protein / fat / carb / fiber / salt）。null か、各項目が 0 以上の数か null。
// 目標（settings.goals）と同じ形。
export function validateNutrition(value, label) {
  if (value === null) return [];
  if (!isPlainObject(value)) return [`${label} はオブジェクトか null にしてください`];
  const errors = [];
  const unknown = Object.keys(value).filter((key) => !GOAL_FIELDS.includes(key));
  if (unknown.length > 0) errors.push(`${label} に不明な項目があります: ${unknown.join(', ')}`);
  for (const key of GOAL_FIELDS) {
    const item = value[key];
    if (item !== null && !(typeof item === 'number' && Number.isFinite(item) && item >= 0)) {
      errors.push(`${label} の ${key} は 0 以上の数か null にしてください`);
    }
  }
  return errors;
}

export const BASE_CARBS = ['udon', 'pasta', 'soba'];

// 分量データ（details）。キーはレシピの id。CLAUDE.md「分量データ」を参照。
//   servings: 何人分の分量か（正の数）
//   base_carb: 麺のレシピで、夕食の炭水化物 270g をどの麺で数えるか（省略時はご飯）
//   ingredients: [{ name, grams, food }]。food は data/foods.js のキー。分からなければ null
//   published: 元ページに載っている 1 人分の栄養（項目ごとに null 可）。無ければ null
export function validateDetails(details) {
  if (!isPlainObject(details)) return result(['分量データがオブジェクトではありません']);
  const errors = [];
  for (const [id, detail] of Object.entries(details)) {
    const label = `分量データ ${id}`;
    if (!isPlainObject(detail)) {
      errors.push(`${label}: オブジェクトではありません`);
      continue;
    }
    if (!(typeof detail.servings === 'number' && Number.isFinite(detail.servings) && detail.servings > 0)) {
      errors.push(`${label}: servings は正の数にしてください`);
    }
    if (detail.base_carb !== undefined && !BASE_CARBS.includes(detail.base_carb)) {
      errors.push(`${label}: base_carb が不正です: ${String(detail.base_carb)}`);
    }
    if (!Array.isArray(detail.ingredients)) {
      errors.push(`${label}: ingredients が配列ではありません`);
    } else {
      for (const item of detail.ingredients) {
        const ok = isPlainObject(item)
          && isNonEmptyString(item.name)
          && typeof item.grams === 'number' && Number.isFinite(item.grams) && item.grams >= 0
          && (item.food === null || isNonEmptyString(item.food));
        if (!ok) errors.push(`${label}: ingredients の要素は { name, grams（0 以上）, food（文字列か null） } にしてください`);
      }
    }
    errors.push(...validateNutrition(detail.published ?? null, `${label}: published`));
  }
  return result(errors);
}

export function validateSlot(slot) {
  const errors = [];
  if (!isPlainObject(slot)) return result(['枠がオブジェクトではありません']);
  const label = `枠 ${slotKey(slot.date, slot.meal, slot.part)}`;

  if (!isValidISO(slot.date)) errors.push(`${label}: date が YYYY-MM-DD ではありません`);
  if (!MEALS.includes(slot.meal)) errors.push(`${label}: meal が不正です`);
  else if (!PARTS[slot.meal].includes(slot.part)) errors.push(`${label}: part がこの食事に合いません`);
  if (!isNonEmptyString(slot.recipe_id)) errors.push(`${label}: recipe_id が空です`);
  if (typeof slot.locked !== 'boolean') errors.push(`${label}: locked が真偽値ではありません`);
  return result(errors);
}

export function validateSettings(settings) {
  if (!isPlainObject(settings)) return result(['settings がオブジェクトではありません']);
  const errors = [];

  const id = settings.breakfast_recipe_id;
  if (id !== null && !isNonEmptyString(id)) {
    errors.push('settings.breakfast_recipe_id は空でない文字列か null にしてください');
  }

  errors.push(...validateNames(settings.pantry, '調味料', PANTRY_ITEM_MAX));

  const { goals } = settings;
  if (goals !== null) {
    if (!isPlainObject(goals)) {
      errors.push('settings.goals はオブジェクトか null にしてください');
    } else {
      errors.push(...validateNutrition(goals, '目標'));
    }
  }
  return result(errors);
}

// 名前の一覧（調味料・余り食材）。空でなく、前後に空白が無く、重複しない文字列。
export function validateNames(values, label, max = PANTRY_ITEM_MAX) {
  if (!Array.isArray(values)) return [`${label}の一覧が配列ではありません`];
  const errors = [];
  const seen = new Set();
  for (const value of values) {
    if (!isNonEmptyString(value) || value !== normalizeName(value)) {
      errors.push(`${label}「${String(value)}」の表記が不正です`);
    } else if (value.length > max) {
      errors.push(`${label}「${value}」が ${max} 文字を超えています`);
    } else if (seen.has(value)) {
      errors.push(`${label}「${value}」が重複しています`);
    }
    seen.add(value);
  }
  return errors;
}

// recipes / slots の一意制約と、自分のレシピへの参照もここで確かめる。
// 同梱レシピへの参照は確かめない。同梱レシピ集はデータ層の外にあり、
// 版が変わって消えても保存データを壊れたとはみなさないため（CLAUDE.md 参照）。
export function validateDB(db) {
  if (!isPlainObject(db)) return result(['データがオブジェクトではありません']);
  const errors = [];

  if (db.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion が ${SCHEMA_VERSION} ではありません`);
  if (!Array.isArray(db.recipes)) errors.push('recipes が配列ではありません');
  if (!Array.isArray(db.slots)) errors.push('slots が配列ではありません');
  errors.push(...validateSettings(db.settings).errors);
  errors.push(...validateNames(db.inventory, '余り食材', NAME_MAX));
  if (!isPlainObject(db.shopping_checked)) {
    errors.push('shopping_checked がオブジェクトではありません');
  } else {
    for (const [week, names] of Object.entries(db.shopping_checked)) {
      if (!isValidISO(week)) errors.push(`買い物リストの週 ${week} が日付ではありません`);
      errors.push(...validateNames(names, `買い物リスト ${week} の項目`, NAME_MAX));
    }
  }
  errors.push(...validateDetails(db.details).errors);
  if (errors.length > 0) return result(errors);

  const recipeIds = new Set();
  for (const recipe of db.recipes) {
    errors.push(...validateRecipe(recipe).errors);
    if (recipe?.source !== 'mine') errors.push(`レシピ ${String(recipe?.id)}: 自分のレシピの source は mine です`);
    if (recipeIds.has(recipe?.id)) errors.push(`レシピ ${String(recipe?.id)}: id が重複しています`);
    recipeIds.add(recipe?.id);
  }

  const slotKeys = new Set();
  for (const slot of db.slots) {
    errors.push(...validateSlot(slot).errors);
    const key = slotKey(slot?.date, slot?.meal, slot?.part);
    if (slotKeys.has(key)) errors.push(`枠 ${key}: (date, meal, part) が重複しています`);
    slotKeys.add(key);
  }

  return result(errors);
}

export function slotKey(date, meal, part) {
  return `${date} ${meal} ${part}`;
}

// そのレシピをその枠に入れられるか。提案ロジックと UI の候補一覧が使う。
export function fitsSlot(recipe, meal, part) {
  return recipe.meals.includes(meal) && (KINDS_FOR_PART[part] ?? []).includes(recipe.kind);
}

// --- 内部 -------------------------------------------------------------

function result(errors) {
  return { ok: errors.length === 0, errors };
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function optionalText(value) {
  if (value === undefined || value === null) return '';
  return trimText(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
