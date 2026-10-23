// 保存・読み出し。localStorage を知っているのはこのモジュールだけ。
//
// 全データを 1 つのキーに JSON 1 塊で持つ。1 回の setItem で常に整合の取れた状態に
// なるため、「レシピだけ消えて枠が残る」という壊れ方をしない。
// この形はエクスポートする JSON の形とも一致する。
//
// 公開関数はすべて Promise を返す。localStorage 自体は同期だが、後で IndexedDB に
// 差し替えたときに呼び出し側を書き直さずに済むようにしてある。

import {
  MEALS,
  PARTS,
  SCHEMA_VERSION,
  createDB,
  createRecipe,
  createSlot,
  normalizeRecipe,
  slotKey,
  validateDB,
  validateRecipe,
  validateSettings,
  validateSlot,
} from './schema.js';

const DEFAULT_STORAGE_KEY = 'kondate.v1';
const PATCHABLE_RECIPE_FIELDS = [
  'name', 'kind', 'meals', 'url', 'protein', 'method', 'ingredients', 'seasonings', 'steps', 'minutes', 'note',
];
const PATCHABLE_SETTINGS_FIELDS = ['breakfast_recipe_id'];

let storageKey = DEFAULT_STORAGE_KEY;
let db = null; // メモリ上の唯一の正。commit() 以外から書き換えない。

export class StorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageError';
  }
}

// 起動時に一度だけ呼ぶ。key はテスト用に別の保存領域を使うためのもので、
// アプリ本体は既定のキーをそのまま使う。
export async function init({ key = DEFAULT_STORAGE_KEY } = {}) {
  storageKey = key;
  db = null;

  const raw = readRaw();
  if (raw === null) {
    const empty = createDB();
    writeRaw(JSON.stringify(empty));
    db = empty;
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StorageError(
      '保存データを JSON として読めませんでした。上書きを避けるためここで中断します。',
      { cause },
    );
  }

  if (Number.isInteger(parsed?.schemaVersion) && parsed.schemaVersion > SCHEMA_VERSION) {
    throw new StorageError(
      `保存データが新しい形式です（version ${parsed.schemaVersion}）。`
      + 'このまま読み書きすると壊すので中断します。アプリを最新にしてください。',
    );
  }

  const { ok, errors } = validateDB(parsed);
  if (!ok) {
    throw new StorageError(
      `保存データの検証に失敗しました。上書きを避けるためここで中断します。\n${describe(errors)}`,
    );
  }
  db = parsed;
}

// --- 自分のレシピ -------------------------------------------------------

export async function getMyRecipes() {
  const state = requireInit();
  const recipes = [...state.recipes].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return clone(recipes);
}

export async function getMyRecipe(id) {
  const state = requireInit();
  const recipe = state.recipes.find((candidate) => candidate.id === id);
  return recipe ? clone(recipe) : null;
}

// source は常に mine。同梱レシピ集の種類（dlab など）は自分のレシピには付けない。
export async function addRecipe(fields) {
  const state = requireInit();
  const recipe = createRecipe({ ...fields, source: 'mine' });
  assertValid(validateRecipe(recipe), 'レシピ');
  commit({ ...state, recipes: [...state.recipes, recipe] });
  return clone(recipe);
}

export async function updateRecipe(id, patch) {
  const state = requireInit();
  const current = state.recipes.find((candidate) => candidate.id === id);
  if (!current) throw new StorageError(`レシピが見つかりません: ${String(id)}`);

  if (!isPlainObject(patch)) {
    throw new StorageError('patch にはオブジェクトを渡してください。');
  }
  const unknown = Object.keys(patch).filter((key) => !PATCHABLE_RECIPE_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new StorageError(
      `更新できないフィールドです: ${unknown.join(', ')}（更新できるのは ${PATCHABLE_RECIPE_FIELDS.join(', ')}）`,
    );
  }

  const updated = normalizeRecipe({ ...current, ...patch });
  assertValid(validateRecipe(updated), 'レシピ');
  commit({
    ...state,
    recipes: state.recipes.map((recipe) => (recipe.id === id ? updated : recipe)),
  });
  return clone(updated);
}

// レシピを消すと、それを指す枠と朝食設定もまとめて消える。
// 存在しないレシピを指す参照が残らないようにするため。
export async function deleteRecipe(id) {
  const state = requireInit();
  if (!state.recipes.some((recipe) => recipe.id === id)) return false;

  const settings = state.settings.breakfast_recipe_id === id
    ? { ...state.settings, breakfast_recipe_id: null }
    : state.settings;
  commit({
    ...state,
    recipes: state.recipes.filter((recipe) => recipe.id !== id),
    slots: state.slots.filter((slot) => slot.recipe_id !== id),
    settings,
  });
  return true;
}

// --- 献立の枠 -----------------------------------------------------------

// from と to はどちらも含む。'YYYY-MM-DD' は辞書順が日付順なので文字列のまま比較できる。
export async function getSlots(from, to) {
  const state = requireInit();
  const slots = state.slots
    .filter((slot) => slot.date >= from && slot.date <= to)
    .sort(bySlot);
  return clone(slots);
}

// 1 枠を書く。(date, meal, part) は一意なので、既存があれば置き換える。
export async function putSlot(fields) {
  return (await putSlots([fields]))[0];
}

// 複数枠をまとめて書く。週の作り直しで 1 回の保存に収めるため。
// 1 件でも不正なら何も書かない。
export async function putSlots(list) {
  const state = requireInit();
  if (!Array.isArray(list)) throw new StorageError('putSlots には配列を渡してください。');

  const slots = list.map(createSlot);
  const keys = new Set();
  for (const slot of slots) {
    assertValid(validateSlot(slot), '枠');
    assertKnownRecipe(state, slot.recipe_id);
    const key = slotKey(slot.date, slot.meal, slot.part);
    if (keys.has(key)) throw new StorageError(`同じ枠が 2 回指定されています: ${key}`);
    keys.add(key);
  }

  const kept = state.slots.filter((slot) => !keys.has(slotKey(slot.date, slot.meal, slot.part)));
  commit({ ...state, slots: [...kept, ...slots] });
  return clone(slots);
}

export async function deleteSlot(date, meal, part) {
  const state = requireInit();
  const key = slotKey(date, meal, part);
  const slots = state.slots.filter((slot) => slotKey(slot.date, slot.meal, slot.part) !== key);
  if (slots.length === state.slots.length) return false;
  commit({ ...state, slots });
  return true;
}

// --- 設定 -------------------------------------------------------------

export async function getSettings() {
  return clone(requireInit().settings);
}

export async function updateSettings(patch) {
  const state = requireInit();
  if (!isPlainObject(patch)) {
    throw new StorageError('patch にはオブジェクトを渡してください。');
  }
  const unknown = Object.keys(patch).filter((key) => !PATCHABLE_SETTINGS_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new StorageError(`更新できない設定です: ${unknown.join(', ')}`);
  }

  const settings = { ...state.settings, ...patch };
  assertValid(validateSettings(settings), '設定');
  if (settings.breakfast_recipe_id !== null) assertKnownRecipe(state, settings.breakfast_recipe_id);
  commit({ ...state, settings });
  return clone(settings);
}

// --- 全体 -------------------------------------------------------------

// 全データのコピー。エクスポートが使う。
export async function snapshot() {
  return clone(requireInit());
}

export async function getCounts() {
  const state = requireInit();
  return { recipes: state.recipes.length, slots: state.slots.length };
}

// --- 内部 -------------------------------------------------------------

function requireInit() {
  if (db === null) {
    throw new StorageError('init() を先に呼び、完了を待ってから使ってください。');
  }
  return db;
}

// 自分のレシピ（UUID）を指しているなら、実在を確かめる。
// 同梱レシピ（固定 ID）は保存側からは見えないので確かめない。
function assertKnownRecipe(state, recipeId) {
  if (!isUUID(recipeId)) return;
  if (!state.recipes.some((recipe) => recipe.id === recipeId)) {
    throw new StorageError(`レシピが見つかりません: ${recipeId}`);
  }
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// 先に保存してからメモリを差し替える。保存に失敗したときに、メモリだけ新しい状態に
// なって localStorage と食い違うのを防ぐ。
function commit(next) {
  writeRaw(JSON.stringify(next));
  db = next;
}

function readRaw() {
  try {
    return localStorage.getItem(storageKey);
  } catch (cause) {
    throw new StorageError(
      'ローカル保存を読み出せませんでした。ブラウザの設定でサイトデータが禁止されている可能性があります。',
      { cause },
    );
  }
}

function writeRaw(serialized) {
  try {
    localStorage.setItem(storageKey, serialized);
  } catch (cause) {
    throw new StorageError(
      '保存に失敗しました。保存容量の上限に達したか、ブラウザがローカル保存を許可していません。',
      { cause },
    );
  }
}

// 日付 → 朝昼夕 → パーツ（PARTS の並び）の順。
function bySlot(a, b) {
  return a.date.localeCompare(b.date)
    || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)
    || PARTS[a.meal].indexOf(a.part) - PARTS[b.meal].indexOf(b.part);
}

// 検証エラーは数が多くなりうる。画面に出せる量に絞る。
function describe(errors, limit = 5) {
  if (errors.length <= limit) return errors.join('\n');
  return `${errors.slice(0, limit).join('\n')}\nほか ${errors.length - limit} 件`;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 内部状態を呼び出し側から書き換えられないよう、読み出しはコピーを返す。
function clone(value) {
  return structuredClone(value);
}

function assertValid({ ok, errors }, label) {
  if (!ok) throw new StorageError(`${label}の内容が不正です:\n${errors.join('\n')}`);
}
