// テスト。ライブラリは使わず、素の JS で assert して結果を画面に出す。
//
// 本番データを壊さないよう、保存先は専用のキーに切り替えて実行し、最後に消す。

import { FOODS } from '../data/foods.js';
import { PANTRY } from '../data/pantry.js';
import { RECIPES } from '../data/recipes.js';
import * as dates from './dates.js';
// export は予約語なので、モジュールの束縛名は backup にする。
import * as backup from './export.js';
import * as nutrition from './nutrition.js';
import * as planner from './planner.js';
import * as schema from './schema.js';
import * as storage from './storage.js';

const TEST_KEY = 'kondate.test';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${message}\n  期待: ${expectedText}\n  実際: ${actualText}`);
  }
}

async function assertThrows(fn, message) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${message}: 例外が投げられませんでした`);
}

async function freshStore() {
  localStorage.removeItem(TEST_KEY);
  // 退避キーも消す。残っていると次のテストが前のテストの後始末に左右される。
  localStorage.removeItem(`${TEST_KEY}.backup.v1`);
  await storage.init({ key: TEST_KEY });
}

// v1（schemaVersion 1）のときの保存データ。
function v1Data() {
  return {
    schemaVersion: 1,
    recipes: [{ ...schema.normalizeRecipe({ ...BREAKFAST, id: '11111111-1111-4111-8111-111111111111' }) }],
    slots: [slot('2026-10-19', 'breakfast', 'dish', '11111111-1111-4111-8111-111111111111', true)],
    settings: { breakfast_recipe_id: '11111111-1111-4111-8111-111111111111' },
  };
}

// 既定は夕食の protein パーツ（サラダに載せるたんぱく質）。
function makeRecipe(overrides = {}) {
  return schema.normalizeRecipe({
    id: 'arrange-001',
    name: '低温調理の鶏むね肉',
    kind: 'protein',
    source: 'arrange',
    protein: 'chicken',
    method: 'sous_vide',
    ingredients: [{ name: '鶏むね肉', amount: '1枚' }],
    seasonings: [{ name: '塩', amount: '肉の重さの1%' }],
    steps: ['塩をすり込み、63℃で1時間40分低温調理する'],
    minutes: 5,
    ...overrides,
  });
}

const BREAKFAST = {
  name: 'オートミールとゆで卵',
  kind: 'dish',
  meals: ['breakfast'],
  protein: 'egg',
  method: 'microwave',
  ingredients: [{ name: 'オートミール', amount: '30g' }, { name: '卵', amount: '2個' }],
  steps: ['卵をゆでる', 'オートミールに牛乳をかけてレンジで温める'],
  minutes: 10,
};

function slot(date, meal, part, recipe_id, locked = false) {
  return { date, meal, part, recipe_id, locked };
}

// --- dates ------------------------------------------------------------

test('todayISO はローカルの今日を返す（UTC ではない）', () => {
  const now = new Date();
  const expected = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  assertEqual(dates.todayISO(), expected, '今日');
});

test('isValidISO は実在しない日付を弾く', () => {
  assert(dates.isValidISO('2026-10-23'), '実在する日付');
  assert(!dates.isValidISO('2026-02-30'), '2/30');
  assert(!dates.isValidISO('2026-1-5'), '桁不足');
});

test('addDays は月・年をまたぐ', () => {
  assertEqual(dates.addDays('2026-12-31', 1), '2027-01-01', '年越し');
  assertEqual(dates.addDays('2026-03-01', -1), '2026-02-28', '月の境目');
});

test('startOfWeek は月曜を返す（日曜は前の月曜）', () => {
  assertEqual(dates.startOfWeek('2026-10-19'), '2026-10-19', '月曜');
  assertEqual(dates.startOfWeek('2026-10-23'), '2026-10-19', '金曜');
  assertEqual(dates.startOfWeek('2026-10-25'), '2026-10-19', '日曜');
});

test('weekDates は月曜から日曜の 7 日', () => {
  const week = dates.weekDates('2026-10-23');
  assertEqual(week.length, 7, '日数');
  assertEqual([week[0], week[6]], ['2026-10-19', '2026-10-25'], '両端');
});

test('formatDayLabel', () => {
  assertEqual(dates.formatDayLabel('2026-10-23'), '10/23 (金)', '表記');
});

// --- schema -----------------------------------------------------------

test('validateRecipe は正しいレシピを通す', () => {
  assertEqual(schema.validateRecipe(makeRecipe()).errors, [], 'protein');
  assertEqual(schema.validateRecipe(makeRecipe({ kind: 'dish', meals: ['lunch'] })).errors, [], 'dish');
});

test('validateRecipe は必須項目と列挙値の誤りを拾う', () => {
  const cases = [
    { ...makeRecipe(), name: '  ' },
    { ...makeRecipe(), kind: 'soup' },
    { ...makeRecipe(), kind: 'dish', meals: [] },
    { ...makeRecipe(), kind: 'dish', meals: ['dinner'] },
    { ...makeRecipe(), kind: 'protein', meals: ['lunch'] },
    { ...makeRecipe(), source: 'web' },
    { ...makeRecipe(), protein: 'lamb' },
    { ...makeRecipe(), method: 'fry' },
    { ...makeRecipe(), url: 'javascript:alert(1)' },
    { ...makeRecipe(), ingredients: [{ name: '', amount: '' }] },
    { ...makeRecipe(), seasonings: ['塩'] },
    { ...makeRecipe(), steps: [''] },
    { ...makeRecipe(), minutes: -1 },
  ];
  cases.forEach((recipe, index) => {
    assert(!schema.validateRecipe(recipe).ok, `${index} 番目が通ってしまった`);
  });
});

test('normalizeRecipe は空白を落とし、空の行を除き、既定値で埋める', () => {
  const recipe = schema.normalizeRecipe({
    id: 'x',
    name: '  納豆ごはん ',
    meals: ['breakfast', 'breakfast'],
    ingredients: [{ name: ' 納豆 ', amount: ' 1パック ' }, { name: '', amount: '' }],
    seasonings: [{ name: ' 醤油 ' }],
    steps: [' 混ぜる ', '  '],
  });
  assertEqual(recipe.name, '納豆ごはん', '名前');
  assertEqual(recipe.meals, ['breakfast'], '食事の重複');
  assertEqual(recipe.ingredients, [{ name: '納豆', amount: '1パック' }], '食材');
  assertEqual(recipe.seasonings, [{ name: '醤油', amount: '' }], '調味料');
  assertEqual(recipe.steps, ['混ぜる'], '手順');
  assertEqual(
    [recipe.kind, recipe.source, recipe.protein, recipe.method, recipe.minutes, recipe.url],
    ['dish', 'mine', 'none', 'none', null, ''],
    '既定値',
  );
});

test('normalizeRecipe は夕食のパーツの meals を dinner に決める', () => {
  for (const kind of ['dressing', 'protein', 'rice_side', 'noodle']) {
    assertEqual(schema.normalizeRecipe({ id: 'x', name: 'a', kind, meals: ['lunch'] }).meals, ['dinner'], kind);
  }
});

test('fitsSlot は meal と part に合う kind だけを通す', () => {
  const dish = makeRecipe({ kind: 'dish', meals: ['lunch'] });
  const riceSide = makeRecipe({ kind: 'rice_side' });
  const noodle = makeRecipe({ kind: 'noodle' });
  assert(schema.fitsSlot(dish, 'lunch', 'dish'), '昼の一品');
  assert(!schema.fitsSlot(dish, 'breakfast', 'dish'), '朝に使えない一品');
  assert(schema.fitsSlot(riceSide, 'dinner', 'carb'), 'ご飯のおかずは carb');
  assert(schema.fitsSlot(noodle, 'dinner', 'carb'), '具入り麺は carb');
  assert(!schema.fitsSlot(noodle, 'dinner', 'protein'), '麺は protein に入らない');
});

test('validateSlot は食事に合わない part を拾う', () => {
  assert(schema.validateSlot(slot('2026-10-19', 'dinner', 'carb', 'a')).ok, '夕の carb');
  assert(!schema.validateSlot(slot('2026-10-19', 'lunch', 'carb', 'a')).ok, '昼の carb');
  assert(!schema.validateSlot(slot('2026-10-19', 'dinner', 'dish', 'a')).ok, '夕の dish');
});

test('validateDB は空の DB を通す', () => {
  assertEqual(schema.validateDB(schema.createDB()).errors, [], 'エラー');
});

test('validateDB は枠の重複を拾う', () => {
  const db = schema.createDB();
  db.slots = [slot('2026-10-19', 'lunch', 'dish', 'a'), slot('2026-10-19', 'lunch', 'dish', 'b')];
  assert(!schema.validateDB(db).ok, '重複が通ってしまった');
});

// --- storage ----------------------------------------------------------

test('init は空の保存領域に空の DB を作る', async () => {
  await freshStore();
  const db = await storage.snapshot();
  assertEqual(db, schema.createDB(), 'DB');
});

test('init は壊れた JSON を上書きせず中断する', async () => {
  localStorage.setItem(TEST_KEY, '{壊れた');
  await assertThrows(() => storage.init({ key: TEST_KEY }), '壊れた JSON');
  assertEqual(localStorage.getItem(TEST_KEY), '{壊れた', '元のデータが残っている');
});

test('init は新しい版のデータを読まない', async () => {
  const future = { ...schema.createDB(), schemaVersion: schema.SCHEMA_VERSION + 1 };
  localStorage.setItem(TEST_KEY, JSON.stringify(future));
  await assertThrows(() => storage.init({ key: TEST_KEY }), '新しい版');
});

test('init は v1 のデータを v2 に移行し、元のデータを一度だけ退避する', async () => {
  await freshStore();
  const raw = JSON.stringify(v1Data());
  localStorage.setItem(TEST_KEY, raw);
  await storage.init({ key: TEST_KEY });

  const db = await storage.snapshot();
  assertEqual(db.schemaVersion, 2, 'schemaVersion');
  assertEqual(db.recipes, v1Data().recipes, 'レシピはそのまま');
  assertEqual(db.slots, v1Data().slots, '枠はそのまま');
  assertEqual(db.settings.breakfast_recipe_id, v1Data().settings.breakfast_recipe_id, '朝食の設定はそのまま');
  assert(db.settings.pantry.includes('はちみつ'), '調味料一覧にはちみつがある');
  assertEqual([db.settings.goals, db.inventory, db.shopping_checked, db.details], [null, [], {}, {}], '新しい項目');
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v1`), raw, '生のまま退避される');
  assertEqual(JSON.parse(localStorage.getItem(TEST_KEY)).schemaVersion, 2, '移行後の形で書き戻される');

  // 退避が残っている状態でもう一度 v1 を移行しても、最初の退避は上書きしない。
  const other = { ...v1Data(), slots: [] };
  localStorage.setItem(TEST_KEY, JSON.stringify(other));
  await storage.init({ key: TEST_KEY });
  assertEqual(localStorage.getItem(`${TEST_KEY}.backup.v1`), raw, '最初の退避が残る');
});

test('init は schemaVersion の無いデータを v1 とみなして移行する', async () => {
  await freshStore();
  const { schemaVersion, ...noVersion } = v1Data();
  localStorage.setItem(TEST_KEY, JSON.stringify(noVersion));
  await storage.init({ key: TEST_KEY });
  assertEqual((await storage.snapshot()).schemaVersion, 2, 'schemaVersion');
});

test('init は移行しても検証に通らないデータを書き戻さない', async () => {
  await freshStore();
  const broken = JSON.stringify({ ...v1Data(), slots: [slot('2026-10-19', 'lunch', 'carb', 'x')] });
  localStorage.setItem(TEST_KEY, broken);
  await assertThrows(() => storage.init({ key: TEST_KEY }), '壊れた v1');
  assertEqual(localStorage.getItem(TEST_KEY), broken, '元のまま残る');
});

test('addRecipe は UUID と source=mine を付けて保存し、再読み込みしても残る', async () => {
  await freshStore();
  const added = await storage.addRecipe({ ...BREAKFAST, source: 'dlab', id: 'dlab-999' });
  assert(added.id !== 'dlab-999', 'id は指定できない');
  assertEqual(added.source, 'mine', 'source');

  await storage.init({ key: TEST_KEY });
  const recipes = await storage.getMyRecipes();
  assertEqual(recipes.map((recipe) => recipe.name), ['オートミールとゆで卵'], '再読み込み後');
});

test('addRecipe は不正なレシピを保存しない', async () => {
  await freshStore();
  await assertThrows(() => storage.addRecipe({ ...BREAKFAST, meals: [] }), 'meals が空');
  await assertThrows(() => storage.addRecipe({ ...BREAKFAST, method: 'fry' }), '不明な method');
  assertEqual((await storage.getCounts()).recipes, 0, '件数');
});

test('updateRecipe は許可した項目だけ更新する', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  const updated = await storage.updateRecipe(added.id, { name: ' オートミール ', minutes: 5 });
  assertEqual([updated.name, updated.minutes], ['オートミール', 5], '更新後');
  await assertThrows(() => storage.updateRecipe(added.id, { source: 'dlab' }), 'source は更新できない');
  await assertThrows(() => storage.updateRecipe(added.id, { id: 'x' }), 'id は更新できない');
});

test('updateRecipe で kind を夕食のパーツに変えると meals が dinner になる', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  const updated = await storage.updateRecipe(added.id, { kind: 'dressing' });
  assertEqual(updated.meals, ['dinner'], 'meals');
});

test('getMyRecipe はコピーを返す（書き換えても保存に影響しない）', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  const copy = await storage.getMyRecipe(added.id);
  copy.name = '書き換え';
  assertEqual((await storage.getMyRecipe(added.id)).name, BREAKFAST.name, '名前');
});

test('putSlot は (date, meal, part) が同じなら置き換え、part が違えば別の枠にする', async () => {
  await freshStore();
  await storage.putSlot(slot('2026-10-19', 'dinner', 'protein', 'a'));
  await storage.putSlot(slot('2026-10-19', 'dinner', 'protein', 'b', true));
  await storage.putSlot(slot('2026-10-19', 'dinner', 'carb', 'c'));
  const slots = await storage.getSlots('2026-10-19', '2026-10-19');
  assertEqual(slots, [
    slot('2026-10-19', 'dinner', 'protein', 'b', true),
    slot('2026-10-19', 'dinner', 'carb', 'c'),
  ], '枠');
});

test('putSlots は 1 件でも不正なら何も書かない', async () => {
  await freshStore();
  await assertThrows(() => storage.putSlots([
    slot('2026-10-19', 'lunch', 'dish', 'a'),
    slot('2026-10-19', 'lunch', 'carb', 'b'),
  ]), '食事に合わない part');
  await assertThrows(() => storage.putSlots([
    slot('2026-10-19', 'lunch', 'dish', 'a'),
    slot('2026-10-19', 'lunch', 'dish', 'b'),
  ]), '同じ枠が 2 回');
  assertEqual((await storage.getCounts()).slots, 0, '件数');
});

test('putSlot は存在しない自分のレシピを指せない', async () => {
  await freshStore();
  await assertThrows(
    () => storage.putSlot(slot('2026-10-19', 'breakfast', 'dish', crypto.randomUUID())),
    '存在しない UUID',
  );
});

test('getSlots は期間内を日付・朝昼夕・パーツの順で返す', async () => {
  await freshStore();
  await storage.putSlots([
    slot('2026-10-20', 'breakfast', 'dish', 'a'),
    slot('2026-10-19', 'dinner', 'dressing', 'b'),
    slot('2026-10-19', 'dinner', 'protein', 'c'),
    slot('2026-10-19', 'breakfast', 'dish', 'd'),
    slot('2026-10-26', 'lunch', 'dish', 'e'),
  ]);
  const slots = await storage.getSlots('2026-10-19', '2026-10-25');
  assertEqual(slots.map((item) => item.recipe_id), ['d', 'c', 'b', 'a'], '順序');
});

test('deleteSlot は枠を消して未提案に戻す', async () => {
  await freshStore();
  await storage.putSlot(slot('2026-10-19', 'dinner', 'carb', 'a'));
  assert(await storage.deleteSlot('2026-10-19', 'dinner', 'carb'), '消せた');
  assert(!(await storage.deleteSlot('2026-10-19', 'dinner', 'carb')), '2 回目は false');
  assertEqual((await storage.getCounts()).slots, 0, '件数');
});

test('updateSettings は朝食のレシピを設定できる', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  await storage.updateSettings({ breakfast_recipe_id: added.id });
  assertEqual((await storage.getSettings()).breakfast_recipe_id, added.id, '設定');
  await assertThrows(() => storage.updateSettings({ theme: 'dark' }), '不明な設定');
  await assertThrows(
    () => storage.updateSettings({ breakfast_recipe_id: crypto.randomUUID() }),
    '存在しないレシピ',
  );
});

test('updateSettings は調味料一覧の表記をそろえ、空と重複を落とす', async () => {
  await freshStore();
  const settings = await storage.updateSettings({ pantry: [' 醤油 ', 'ｵｲｽﾀｰｿｰｽ', '醤油', '', '　'] });
  assertEqual(settings.pantry, ['醤油', 'オイスターソース'], '一覧');
  await assertThrows(() => storage.updateSettings({ pantry: ['あ'.repeat(21)] }), '21 文字');
  await assertThrows(() => storage.updateSettings({ pantry: '醤油' }), '配列でない');
});

test('updateSettings は目標を保存でき、不正な値を弾く', async () => {
  await freshStore();
  const goals = { kcal: 2000, protein: 120, fat: null, carb: 250, fiber: 21, salt: 7.5 };
  assertEqual((await storage.updateSettings({ goals })).goals, goals, '目標');
  await assertThrows(() => storage.updateSettings({ goals: { ...goals, kcal: -1 } }), '負の数');
  await assertThrows(() => storage.updateSettings({ goals: { ...goals, sugar: 10 } }), '不明な項目');
  assertEqual((await storage.updateSettings({ goals: null })).goals, null, '未設定に戻せる');
});

test('missingSeasonings は家に無い調味料を返す（表記はそろえて比べる）', () => {
  const recipe = makeRecipe({ seasonings: [{ name: '醤油', amount: '' }, { name: 'ﾅﾝﾌﾟﾗｰ', amount: '' }, { name: 'はちみつ', amount: '' }] });
  assertEqual(schema.missingSeasonings(recipe, ['醤油', 'はちみつ']), ['ﾅﾝﾌﾟﾗｰ'], '無いもの');
  assertEqual(schema.missingSeasonings(recipe, ['醤油', 'ナンプラー', 'はちみつ']), [], '全部ある');
});

test('deleteRecipe はそのレシピの枠と朝食設定も消す', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  await storage.updateSettings({ breakfast_recipe_id: added.id });
  await storage.putSlots([
    slot('2026-10-19', 'breakfast', 'dish', added.id),
    slot('2026-10-19', 'lunch', 'dish', 'arrange-001'),
  ]);

  assert(await storage.deleteRecipe(added.id), '消せた');
  const slots = await storage.getSlots('2026-10-19', '2026-10-19');
  assertEqual(slots.map((item) => item.recipe_id), ['arrange-001'], '同梱レシピの枠は残る');
  assertEqual((await storage.getSettings()).breakfast_recipe_id, null, '朝食設定');
});

// --- planner ----------------------------------------------------------

const WEEK = '2026-10-19'; // 月曜
const PREV_SUNDAY = '2026-10-18';
const PROTEINS = ['chicken', 'pork', 'beef', 'fish', 'egg', 'soy'];

// 再現できる乱数列（mulberry32）。同じ seed なら毎回同じ献立になる。
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 昼の一品・夕の protein・夕の carb（ご飯のおかずと麺を交互）を protein ごとに count 件、
// ドレッシングを 8 件作る。
function variedRecipes(count = 4) {
  const recipes = [];
  for (const protein of PROTEINS) {
    for (let index = 0; index < count; index += 1) {
      recipes.push(
        makeRecipe({ id: `dish-${protein}-${index}`, kind: 'dish', meals: ['lunch'], protein }),
        makeRecipe({ id: `protein-${protein}-${index}`, kind: 'protein', protein }),
        makeRecipe({ id: `carb-${protein}-${index}`, kind: index % 2 === 0 ? 'rice_side' : 'noodle', protein }),
      );
    }
  }
  for (let index = 0; index < 8; index += 1) {
    recipes.push(makeRecipe({ id: `dressing-${index}`, kind: 'dressing', protein: 'none' }));
  }
  return recipes;
}

const BREAKFAST_RECIPE = makeRecipe({
  id: 'mine-breakfast', kind: 'dish', meals: ['breakfast'], protein: 'egg', source: 'mine',
});

function run(options) {
  return planner.planWeek({ weekStart: WEEK, slots: [], breakfastRecipeId: null, ...options });
}

function byKey(slots) {
  return new Map(slots.map((item) => [schema.slotKey(item.date, item.meal, item.part), item]));
}

// 提案ルール 1〜3 を満たしているかを確かめる。違反を文字列の配列で返す。
function ruleViolations(slots, recipes) {
  const protein = new Map(recipes.map((recipe) => [recipe.id, recipe.protein]));
  const map = byKey(slots);
  const violations = [];
  const days = dates.weekDates(WEEK);
  const daySlots = (date) => [
    map.get(schema.slotKey(date, 'lunch', 'dish')),
    ...schema.PARTS.dinner.map((part) => map.get(schema.slotKey(date, 'dinner', part))),
  ].filter(Boolean);

  const ids = days.flatMap((date) => daySlots(date).map((item) => item.recipe_id));
  if (new Set(ids).size !== ids.length) violations.push('同じ週に同じレシピ');

  for (const date of days) {
    const proteins = daySlots(date)
      .map((item) => protein.get(item.recipe_id))
      .filter((value) => value && value !== 'none');
    if (new Set(proteins).size !== proteins.length) violations.push(`${date} 同じ日に protein が重複: ${proteins}`);

    const today = protein.get(map.get(schema.slotKey(date, 'dinner', 'protein'))?.recipe_id);
    const before = protein.get(map.get(schema.slotKey(dates.addDays(date, -1), 'dinner', 'protein'))?.recipe_id);
    if (today && today !== 'none' && today === before) violations.push(`${date} 前日の夕食と ${today}`);
  }
  return violations;
}

test('planWeek は朝食を固定し、昼の一品と夕の 3 パーツを 7 日分埋める', () => {
  const recipes = [BREAKFAST_RECIPE, ...variedRecipes()];
  const slots = run({ recipes, breakfastRecipeId: BREAKFAST_RECIPE.id, random: seeded(1) });
  assertEqual(slots.length, 7 * 5, '枠の数');
  for (const item of slots) {
    const recipe = recipes.find((candidate) => candidate.id === item.recipe_id);
    assert(schema.fitsSlot(recipe, item.meal, item.part), `${item.meal} ${item.part} に ${recipe.kind}`);
    assert(schema.validateSlot(item).ok, '枠として正しい');
    assert(item.locked === false, '新しい枠は固定しない');
  }
  assert(slots.filter((item) => item.meal === 'breakfast').every((item) => item.recipe_id === BREAKFAST_RECIPE.id), '朝食');
});

test('planWeek は候補が十分あればルールを破らない（seed を変えて 50 回）', () => {
  const recipes = [BREAKFAST_RECIPE, ...variedRecipes()];
  const previous = slot(PREV_SUNDAY, 'dinner', 'protein', 'protein-fish-0');
  for (let seed = 1; seed <= 50; seed += 1) {
    const slots = run({ recipes, slots: [previous], random: seeded(seed) });
    assertEqual(ruleViolations([previous, ...slots], recipes), [], `seed ${seed}`);
  }
});

test('planWeek は carb にご飯のおかずと麺の両方を使う', () => {
  const slots = run({ recipes: variedRecipes(), random: seeded(5) });
  const recipes = variedRecipes();
  const kinds = new Set(slots
    .filter((item) => item.part === 'carb')
    .map((item) => recipes.find((recipe) => recipe.id === item.recipe_id).kind));
  assertEqual([...kinds].sort(), ['noodle', 'rice_side'], 'kind');
});

test('planWeek は前週の日曜の夕食を返さず、月曜の protein と比べるだけにする', () => {
  // protein パーツは fish と chicken だけ。前週日曜が fish なら月曜は chicken になる。
  const recipes = [
    makeRecipe({ id: 'fish-a', protein: 'fish' }),
    makeRecipe({ id: 'chicken-a', protein: 'chicken' }),
  ];
  const previous = slot(PREV_SUNDAY, 'dinner', 'protein', 'fish-a');
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = run({ recipes, slots: [previous], random: seeded(seed) });
    assert(slots.every((item) => item.date >= WEEK), '週の外の枠を返した');
    assertEqual(byKey(slots).get(`${WEEK} dinner protein`).recipe_id, 'chicken-a', `seed ${seed} 月曜`);
  }
});

test('planWeek は固定枠を残し、そのレシピを他の枠で使わない', () => {
  const recipes = [BREAKFAST_RECIPE, ...variedRecipes()];
  const locked = [
    slot('2026-10-21', 'dinner', 'protein', 'protein-beef-0', true),
    slot('2026-10-22', 'dinner', 'dressing', 'dressing-3', true),
    slot('2026-10-19', 'breakfast', 'dish', 'dish-chicken-3', true),
  ];
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = run({ recipes, slots: locked, breakfastRecipeId: BREAKFAST_RECIPE.id, random: seeded(seed) });
    const map = byKey(slots);
    for (const item of locked) {
      assertEqual(map.get(schema.slotKey(item.date, item.meal, item.part)), item, '固定した枠');
    }
    for (const id of ['protein-beef-0', 'dressing-3']) {
      assertEqual(slots.filter((item) => item.recipe_id === id).length, 1, `seed ${seed} ${id} の使用回数`);
    }
    assertEqual(ruleViolations(slots, recipes), [], `seed ${seed} 固定枠の前後`);
  }
});

test('planWeek は固定していない既存の枠を作り直す（使用済みに数えない）', () => {
  // 昼の一品と各パーツが 7 件ずつ。既存の枠を使用済みに数えてしまうと候補が足りず重複が出る。
  const make = (kind, prefix, meals) => Array.from({ length: 7 }, (_, i) => makeRecipe({
    id: `${prefix}${i}`, kind, meals, protein: 'none',
  }));
  const recipes = [
    ...make('dish', 'l', ['lunch']),
    ...make('protein', 'p', undefined),
    ...make('rice_side', 'c', undefined),
    ...make('dressing', 'd', undefined),
  ];
  const existing = dates.weekDates(WEEK).flatMap((date, i) => [
    slot(date, 'lunch', 'dish', `l${i}`),
    slot(date, 'dinner', 'protein', `p${i}`),
    slot(date, 'dinner', 'carb', `c${i}`),
    slot(date, 'dinner', 'dressing', `d${i}`),
  ]);
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = run({ recipes, slots: existing, random: seeded(seed) });
    assertEqual(new Set(slots.map((item) => item.recipe_id)).size, 28, `seed ${seed} 28 件すべて別のレシピ`);
  }
});

test('planWeek は朝食が未設定なら朝食枠を作らない', () => {
  const slots = run({ recipes: variedRecipes(), random: seeded(1) });
  assert(slots.every((item) => item.meal !== 'breakfast'), '朝食枠がある');
  assertEqual(slots.length, 7 * 4, '枠の数');
});

test('planWeek は候補が少なくても条件を緩めて全枠を埋める', () => {
  // 各パーツが鶏肉 2 件だけ。重複も protein の重なりも避けられない。
  const recipes = ['dish', 'protein', 'noodle', 'dressing'].flatMap((kind) => [1, 2].map((i) => makeRecipe({
    id: `${kind}-${i}`, kind, meals: kind === 'dish' ? ['lunch'] : undefined,
  })));
  assertEqual(run({ recipes, random: seeded(3) }).length, 7 * 4, '枠の数');
});

test('planWeek は緩めるとき「同じ週で重複しない」を最後まで守る', () => {
  // protein パーツが鶏肉だけ 7 件。protein の条件は破るしかないが、重複は避けられる。
  const recipes = Array.from({ length: 7 }, (_, i) => makeRecipe({ id: `c${i}` }));
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = run({ recipes, random: seeded(seed) });
    assertEqual(new Set(slots.map((item) => item.recipe_id)).size, 7, `seed ${seed} 重複`);
  }
});

test('planWeek は使えるレシピが 0 件のパーツを未提案のままにする', () => {
  const recipes = [makeRecipe({ id: 'p1' })];
  const slots = run({ recipes, random: seeded(1) });
  assert(slots.every((item) => item.part === 'protein'), 'protein 以外の枠がある');
  assertEqual(slots.length, 7, '枠の数');
});

test('planWeek は同じ乱数列なら同じ献立を返す', () => {
  const recipes = variedRecipes();
  assertEqual(run({ recipes, random: seeded(42) }), run({ recipes, random: seeded(42) }), '結果');
});

test('planWeek は random が 1 に極めて近い値を返しても範囲外にならない', () => {
  const slots = run({ recipes: variedRecipes(1), random: () => 0.9999999999999999 });
  assert(slots.every((item) => typeof item.recipe_id === 'string'), 'recipe_id');
});

test('planWeek は家に無い調味料を使うレシピを提案しない（緩めない）', () => {
  const recipes = [
    makeRecipe({ id: 'ok', seasonings: [{ name: '塩', amount: '' }] }),
    makeRecipe({ id: 'ng', seasonings: [{ name: 'ナンプラー', amount: '' }] }),
  ];
  for (let seed = 1; seed <= 10; seed += 1) {
    const slots = run({ recipes, random: seeded(seed), pantry: ['塩'] });
    assert(slots.every((item) => item.recipe_id === 'ok'), `seed ${seed} 家に無い調味料のレシピを出した`);
  }
  const none = run({ recipes: [recipes[1]], random: seeded(1), pantry: ['塩'] });
  assertEqual(none.length, 0, '作れるレシピが無ければ未提案');
  assertEqual(run({ recipes: [recipes[1]], random: seeded(1) }).length, 7, 'pantry を渡さなければ絞らない');
});

test('rerollSlot も家に無い調味料を使うレシピを避ける', () => {
  const recipes = [
    makeRecipe({ id: 'a' }),
    makeRecipe({ id: 'b' }),
    makeRecipe({ id: 'ng', seasonings: [{ name: 'ナンプラー', amount: '' }] }),
  ];
  const current = slot('2026-10-20', 'dinner', 'protein', 'a');
  for (let seed = 1; seed <= 10; seed += 1) {
    const next = planner.rerollSlot({
      date: current.date, meal: 'dinner', part: 'protein', recipes, slots: [current], random: seeded(seed), pantry: ['塩'],
    });
    assertEqual(next.recipe_id, 'b', `seed ${seed}`);
  }
});

const THURSDAY = '2026-10-22';

test('weekdayOf は曜日を返す', () => {
  assertEqual(dates.weekdayOf(THURSDAY), 4, '木曜');
  assertEqual(dates.weekdayOf('2026-10-25'), 0, '日曜');
});

test('planWeek は木曜の夕の protein を魚にし、水・金の夕と昼は魚を避ける（seed を変えて 50 回）', () => {
  const recipes = variedRecipes();
  const protein = new Map(recipes.map((recipe) => [recipe.id, recipe.protein]));
  for (let seed = 1; seed <= 50; seed += 1) {
    const map = byKey(run({ recipes, random: seeded(seed) }));
    const proteinAt = (date, meal, part) => protein.get(map.get(schema.slotKey(date, meal, part)).recipe_id);
    assertEqual(proteinAt(THURSDAY, 'dinner', 'protein'), 'fish', `seed ${seed} 木曜の夕`);
    assert(proteinAt('2026-10-21', 'dinner', 'protein') !== 'fish', `seed ${seed} 水曜の夕が魚`);
    assert(proteinAt('2026-10-23', 'dinner', 'protein') !== 'fish', `seed ${seed} 金曜の夕が魚`);
    assert(proteinAt(THURSDAY, 'lunch', 'dish') !== 'fish', `seed ${seed} 木曜の昼が魚`);
  }
});

test('planWeek は魚のレシピが無ければ木曜も他の protein で埋める', () => {
  const recipes = variedRecipes().filter((recipe) => recipe.protein !== 'fish');
  const map = byKey(run({ recipes, random: seeded(1) }));
  assert(map.has(`${THURSDAY} dinner protein`), '木曜の夕が未提案');
});

test('planWeek は木曜の固定枠が魚でなくてもそのまま残す', () => {
  const locked = slot(THURSDAY, 'dinner', 'protein', 'protein-beef-1', true);
  const map = byKey(run({ recipes: variedRecipes(), slots: [locked], random: seeded(2) }));
  assertEqual(map.get(`${THURSDAY} dinner protein`), locked, '固定枠');
});

test('rerollSlot は木曜の夕の protein を魚の中で引き直す', () => {
  const recipes = variedRecipes();
  const base = run({ recipes, random: seeded(9) });
  for (let seed = 1; seed <= 20; seed += 1) {
    const next = planner.rerollSlot({
      date: THURSDAY, meal: 'dinner', part: 'protein', recipes, slots: base, random: seeded(seed),
    });
    assertEqual(recipes.find((recipe) => recipe.id === next.recipe_id).protein, 'fish', `seed ${seed}`);
  }
});

test('同梱レシピでも木曜の夕の protein は魚になる', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const map = byKey(run({ recipes: RECIPES, random: seeded(seed) }));
    const id = map.get(`${THURSDAY} dinner protein`).recipe_id;
    assertEqual(RECIPES.find((recipe) => recipe.id === id).protein, 'fish', `seed ${seed}`);
  }
});

test('rerollSlot は今のレシピを避け、ルールを守る', () => {
  const recipes = variedRecipes();
  const base = run({ recipes, random: seeded(7) });
  for (const part of schema.PARTS.dinner) {
    const target = base.find((item) => item.date === '2026-10-22' && item.part === part);
    for (let seed = 1; seed <= 30; seed += 1) {
      const next = planner.rerollSlot({
        date: target.date, meal: target.meal, part, recipes, slots: base, random: seeded(seed),
      });
      assert(next.recipe_id !== target.recipe_id, `${part} seed ${seed} 今のレシピのまま`);
      const replaced = base.map((item) => (item === target ? next : item));
      assertEqual(ruleViolations(replaced, recipes), [], `${part} seed ${seed}`);
    }
  }
});

test('rerollSlot は他に候補が無ければ今のレシピを返し、0 件なら null', () => {
  const only = makeRecipe({ id: 'only', kind: 'dish', meals: ['lunch'] });
  const current = slot(WEEK, 'lunch', 'dish', 'only');
  const next = planner.rerollSlot({
    date: WEEK, meal: 'lunch', part: 'dish', recipes: [only], slots: [current], random: seeded(1),
  });
  assertEqual(next, { ...current }, '今のレシピ');
  assertEqual(
    planner.rerollSlot({ date: WEEK, meal: 'dinner', part: 'carb', recipes: [only], slots: [], random: seeded(1) }),
    null,
    '候補なし',
  );
});

// --- 同梱レシピ集 -------------------------------------------------------

test('同梱レシピはすべて検証を通り、id が一意で、source が mine でない', () => {
  const errors = RECIPES.flatMap((recipe) => schema.validateRecipe(recipe).errors);
  assertEqual(errors, [], '検証エラー');
  const ids = RECIPES.map((recipe) => recipe.id);
  assertEqual(ids.filter((id, index) => ids.indexOf(id) !== index), [], '重複した id');
  assertEqual(RECIPES.filter((recipe) => recipe.source === 'mine').map((recipe) => recipe.id), [], 'source が mine');
});

test('同梱レシピは家にある調味料だけを使う', () => {
  const pantry = new Set(PANTRY);
  const outside = RECIPES.flatMap((recipe) => recipe.seasonings
    .filter((item) => !pantry.has(item.name))
    .map((item) => `${recipe.id}: ${item.name}`));
  assertEqual(outside, [], '一覧に無い調味料');
});

test('dlab と external は分量と手順を載せず、リンクを持つ', () => {
  const problems = RECIPES
    .filter((recipe) => recipe.source === 'dlab' || recipe.source === 'external')
    .flatMap((recipe) => {
      const found = [];
      if (recipe.url === '') found.push(`${recipe.id}: url が無い`);
      if (recipe.steps.length > 0) found.push(`${recipe.id}: 手順がある`);
      if ([...recipe.ingredients, ...recipe.seasonings].some((item) => item.amount !== '')) {
        found.push(`${recipe.id}: 分量がある`);
      }
      return found;
    });
  assertEqual(problems, [], '問題');
});

test('同梱レシピは Dラボと外部サイトだけ（応用レシピを載せない）', () => {
  const others = RECIPES.filter((recipe) => !['dlab', 'external'].includes(recipe.source)).map((recipe) => recipe.id);
  assertEqual(others, [], 'dlab / external 以外');
});

test('同梱レシピには木曜に回せる魚の protein パーツがある', () => {
  const fish = RECIPES.filter((recipe) => recipe.kind === 'protein' && recipe.protein === 'fish');
  assert(fish.length >= 2, `魚の protein パーツが ${fish.length} 件しかない`);
});

test('同梱レシピは昼の一品と夕の各パーツを 1 週間回せる数（7 件以上）ある', () => {
  const counts = [['lunch', 'dish'], ...schema.PARTS.dinner.map((part) => ['dinner', part])]
    .map(([meal, part]) => [`${meal} ${part}`, RECIPES.filter((recipe) => schema.fitsSlot(recipe, meal, part)).length]);
  const short = counts.filter(([, count]) => count < 7);
  assertEqual(short, [], `足りないパーツ（全体: ${JSON.stringify(counts)}）`);
});

test('同梱レシピで週を作るとルールを破らない（seed を変えて 50 回）', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const slots = run({ recipes: RECIPES, random: seeded(seed) });
    assertEqual(slots.length, 7 * 4, `seed ${seed} 枠の数`);
    assertEqual(ruleViolations(slots, RECIPES), [], `seed ${seed}`);
  }
});

// --- nutrition（栄養計算） ----------------------------------------------

function close(actual, expected, message, tolerance = 0.01) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}\n  期待: ${expected}\n  実際: ${actual}`);
  }
}

// 計算を追いやすい架空の食品。
const TEST_FOODS = {
  ...FOODS,
  test_meat: { no: '', name: 'テスト肉', kcal: 200, protein: 20, fat: 10, carb: 0, fiber: 0, salt: 0.1 },
  test_salt: { no: '', name: 'テスト塩', kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, salt: 100 },
  test_null: { no: '', name: '未測定あり', kcal: 100, protein: null, fat: 1, carb: 1, fiber: null, salt: 0 },
};

function detail(overrides = {}) {
  return {
    servings: 2,
    ingredients: [
      { name: '肉', grams: 300, food: 'test_meat' },
      { name: '塩', grams: 4, food: 'test_salt' },
    ],
    published: null,
    ...overrides,
  };
}

test('foods.js は成分表の値を持ち、キャベツとご飯の値が成分表どおり', () => {
  assertEqual([FOODS.cabbage.no, FOODS.cabbage.kcal, FOODS.cabbage.protein], ['06061', 23, 1.2], 'キャベツ');
  assertEqual([FOODS.rice_cooked.no, FOODS.rice_cooked.kcal, FOODS.rice_cooked.carb], ['01088', 156, 37.1], 'ご飯');
  for (const [key, food] of Object.entries(FOODS)) {
    for (const field of nutrition.NUTRIENTS) {
      assert(food[field] === null || typeof food[field] === 'number', `${key}.${field}`);
    }
  }
});

test('sumIngredients は g × 100g あたりの値を足し、成分表に無い食材を unknown に入れる', () => {
  const { totals, unknown } = nutrition.sumIngredients([
    { name: '肉', grams: 150, food: 'test_meat' },
    { name: '未測定あり', grams: 100, food: 'test_null' },
    { name: '謎の食材', grams: 50, food: null },
    { name: '無いキー', grams: 50, food: 'no_such_food' },
  ], TEST_FOODS);
  assertEqual([totals.kcal, totals.protein, totals.fat], [400, 30, 16], '合計（未測定は 0）');
  assertEqual(unknown, ['謎の食材', '無いキー'], 'unknown');
});

test('recipeNutrition は分量データを servings で割り、published があればその項目を優先する', () => {
  const recipe = makeRecipe({ id: 'r1', source: 'dlab' });
  const calc = nutrition.recipeNutrition(recipe, { r1: detail() }, TEST_FOODS);
  assertEqual([calc.values.kcal, calc.values.protein, calc.values.salt], [300, 30, 2.15], '計算値（1 人分）');

  const published = { kcal: 280, protein: null, fat: null, carb: null, fiber: null, salt: null };
  const mixed = nutrition.recipeNutrition(recipe, { r1: detail({ published }) }, TEST_FOODS);
  assertEqual([mixed.values.kcal, mixed.values.protein], [280, 30], 'kcal は published、たんぱく質は計算');
  assertEqual(nutrition.recipeNutrition(recipe, {}, TEST_FOODS), null, '分量データが無ければ null');
});

test('recipeNutrition は自分のレシピなら入力した値を使う', () => {
  const recipe = makeRecipe({
    id: 'mine-1', source: 'mine', kind: 'dish', meals: ['breakfast'],
    nutrition: { kcal: 350, protein: 20, fat: null, carb: 40, fiber: 5, salt: 1 },
  });
  const result = nutrition.recipeNutrition(recipe, {}, TEST_FOODS);
  assertEqual([result.values.kcal, result.values.fat, result.source], [350, 0, 'mine'], '入力値');
  assertEqual(nutrition.recipeNutrition({ ...recipe, nutrition: null }, {}, TEST_FOODS), null, '未入力は null');
});

test('dayNutrition は夕食にキャベツ半玉 500g とご飯 270g を足す', () => {
  const day = nutrition.dayNutrition({ slots: [], byId: new Map(), details: {}, foods: FOODS });
  // キャベツ 23kcal × 5 + ご飯 156kcal × 2.7
  close(day.totals.kcal, 23 * 5 + 156 * 2.7, 'kcal');
  close(day.totals.carb, 5.2 * 5 + 37.1 * 2.7, '炭水化物');
  assertEqual(day.unknownCount, 0, '不明な品');
  assertEqual(day.items.map((item) => item.name), ['キャベツ半玉（500g）', 'ご飯（270g）'], '内訳');
});

test('dayNutrition は carb が麺のレシピなら 270g をその麺で数える', () => {
  const noodle = makeRecipe({ id: 'n1', kind: 'noodle', source: 'external' });
  const slots = [slot('2026-10-19', 'dinner', 'carb', 'n1')];
  const day = nutrition.dayNutrition({
    slots, byId: new Map([['n1', noodle]]), details: { n1: detail({ base_carb: 'udon' }) }, foods: TEST_FOODS,
  });
  assert(day.items.some((item) => item.name === 'ゆでうどん（270g）'), 'うどんで数える');
  close(day.totals.kcal, 300 + 23 * 5 + 95 * 2.7, 'kcal');
});

test('dayNutrition は栄養が分からない枠を合計に入れず数える', () => {
  const known = makeRecipe({ id: 'k1', source: 'dlab' });
  const unknown = makeRecipe({ id: 'u1', source: 'dlab' });
  const slots = [
    slot('2026-10-19', 'lunch', 'dish', 'k1'),
    slot('2026-10-19', 'dinner', 'protein', 'u1'),
    slot('2026-10-19', 'dinner', 'dressing', 'gone'),
  ];
  const day = nutrition.dayNutrition({
    slots, byId: new Map([['k1', known], ['u1', unknown]]), details: { k1: detail() }, foods: TEST_FOODS,
  });
  assertEqual(day.unknownCount, 2, '不明な品（分量データ無し・見つからないレシピ）');
  close(day.totals.kcal, 300 + 23 * 5 + 156 * 2.7, 'kcal');
  assertEqual(day.items.find((item) => item.part === 'dressing').name, '見つからないレシピ', '消えたレシピ');
});

test('goalRatios は目標に対する割合を返し、未設定は null', () => {
  const ratios = nutrition.goalRatios({ kcal: 1500, protein: 90, fat: 50, carb: 200, fiber: 21, salt: 6 },
    { kcal: 2000, protein: 120, fat: null, carb: 250, fiber: 21, salt: 7.5 });
  assertEqual([ratios.kcal, ratios.protein, ratios.fat, ratios.fiber], [0.75, 0.75, null, 1], '割合');
  assertEqual(nutrition.goalRatios({ kcal: 1 }, null).kcal, null, '目標なし');
});

test('validateDetails は正しい分量データを通し、壊れたものを拾う', () => {
  assertEqual(schema.validateDetails({ r1: detail() }).errors, [], '正しい');
  const cases = [
    { r1: detail({ servings: 0 }) },
    { r1: detail({ base_carb: 'ramen' }) },
    { r1: detail({ ingredients: [{ name: '肉', grams: -1, food: 'x' }] }) },
    { r1: detail({ ingredients: [{ name: '', grams: 1, food: 'x' }] }) },
    { r1: detail({ published: { kcal: -5 } }) },
    { r1: 'x' },
  ];
  cases.forEach((value, index) => assert(!schema.validateDetails(value).ok, `${index} 番目が通ってしまった`));
});

test('replaceDetails は全置換し、不正なファイルでは何も変えない', async () => {
  await freshStore();
  assertEqual(await storage.replaceDetails({ version: 1, details: { r1: detail() } }), 1, '件数');
  await assertThrows(() => storage.replaceDetails({ version: 2, details: {} }), '版が違う');
  await assertThrows(() => storage.replaceDetails({ version: 1, details: { r2: detail({ servings: -1 }) } }), '壊れた中身');
  assertEqual(Object.keys(await storage.getDetails()), ['r1'], '最初に読み込んだまま');
  await storage.replaceDetails({ version: 1, details: { r3: detail() } });
  assertEqual(Object.keys(await storage.getDetails()), ['r3'], 'マージせず置き換える');
});

test('自分のレシピに 1 人分の栄養を保存でき、空欄だけなら null になる', async () => {
  await freshStore();
  const added = await storage.addRecipe({ ...BREAKFAST, nutrition: { kcal: 400, protein: '', fat: 10 } });
  assertEqual(added.nutrition, { kcal: 400, protein: null, fat: 10, carb: null, fiber: null, salt: null }, '保存');
  const cleared = await storage.updateRecipe(added.id, { nutrition: { kcal: '' } });
  assertEqual(cleared.nutrition, null, '全部空なら null');
  await assertThrows(() => storage.updateRecipe(added.id, { nutrition: { kcal: -1 } }), '負の数');
});

// --- export（エクスポート） --------------------------------------------

// storage を経由せず、その場で組み立てる。
function sampleBackup() {
  const db = schema.createDB();
  db.recipes = [{ ...schema.normalizeRecipe({ ...BREAKFAST, id: crypto.randomUUID() }) }];
  db.slots = [slot('2026-10-19', 'breakfast', 'dish', db.recipes[0].id), slot('2026-10-19', 'dinner', 'protein', 'dlab-001', true)];
  db.settings.breakfast_recipe_id = db.recipes[0].id;
  return db;
}

// share / canShare の偽物。呼ばれた引数を記録する。
function fakeNav({ canShare = true, shareError = null } = {}) {
  const calls = [];
  return {
    calls,
    canShare: () => canShare,
    share: async (data) => {
      calls.push(data);
      if (shareError) throw shareError;
    },
  };
}

function namedError(name) {
  const error = new Error(name);
  error.name = name;
  return error;
}

test('backupFilename は日付入りのファイル名を返す', () => {
  assertEqual(backup.backupFilename('2026-10-23'), 'kondate-2026-10-23.json', 'ファイル名');
  assertEqual(backup.backupFilename(), `kondate-${dates.todayISO()}.json`, '省略時は今日');
});

test('serializeBackup の JSON を読み戻すと validateDB を通り、内容が一致する', () => {
  const data = sampleBackup();
  const parsed = JSON.parse(backup.serializeBackup(data));
  assertEqual(schema.validateDB(parsed).errors, [], '検証エラー');
  assertEqual(parsed, data, '内容');
});

test('serializeBackup は storage.snapshot() の形をそのまま書き出す', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  await storage.updateSettings({ breakfast_recipe_id: added.id });
  const parsed = JSON.parse(backup.serializeBackup(await storage.snapshot()));
  assertEqual(
    Object.keys(parsed),
    ['schemaVersion', 'recipes', 'slots', 'settings', 'inventory', 'shopping_checked', 'details'],
    'キー',
  );
  assertEqual(schema.validateDB(parsed).errors, [], '検証エラー');
});

test('canUseShare は share と canShare の両方が使えるときだけ true', () => {
  const file = new File(['{}'], 'a.json', { type: 'application/json' });
  const share = async () => {};
  assert(backup.canUseShare({ share, canShare: () => true }, file), '両方あれば使える');
  assert(!backup.canUseShare({ share, canShare: () => false }, file), 'canShare が false');
  assert(!backup.canUseShare({ canShare: () => true }, file), 'share が無い');
  assert(!backup.canUseShare({ share }, file), 'canShare が無い');
  assert(!backup.canUseShare({}, file), '何も無い');
  assert(!backup.canUseShare(undefined, file), 'navigator が無い');
  assert(!backup.canUseShare({ share, canShare: () => { throw new Error('x'); } }, file), 'canShare が例外を投げる');
});

test('exportBackup は共有シートが使えれば File を 1 つ渡して共有する', async () => {
  const nav = fakeNav();
  const result = await backup.exportBackup({
    today: '2026-10-23', nav, data: sampleBackup(), download: () => { throw new Error('ダウンロードした'); },
  });
  assertEqual(result, { method: 'share', filename: 'kondate-2026-10-23.json', cancelled: false }, '結果');
  assertEqual(nav.calls.length, 1, 'share の呼び出し回数');
  const [file] = nav.calls[0].files;
  assertEqual([file.name, file.type], ['kondate-2026-10-23.json', 'application/json'], 'File');
  assertEqual(schema.validateDB(JSON.parse(await file.text())).errors, [], '中身が保存データとして正しい');
});

test('exportBackup は共有シートを閉じただけなら失敗にしない', async () => {
  const nav = fakeNav({ shareError: namedError('AbortError') });
  const result = await backup.exportBackup({ today: '2026-10-23', nav, data: sampleBackup() });
  assertEqual([result.method, result.cancelled], ['share', true], '結果');
});

test('exportBackup は共有シートの失敗をダウンロードに切り替えず投げ直す', async () => {
  let downloaded = false;
  const nav = fakeNav({ shareError: namedError('NotAllowedError') });
  await assertThrows(() => backup.exportBackup({
    today: '2026-10-23', nav, data: sampleBackup(), download: () => { downloaded = true; },
  }), 'NotAllowedError');
  assert(!downloaded, 'ダウンロードに切り替えてしまった');
});

test('exportBackup は共有シートが使えなければダウンロードする', async () => {
  let downloaded = null;
  const result = await backup.exportBackup({
    today: '2026-10-23',
    nav: fakeNav({ canShare: false }),
    data: sampleBackup(),
    download: (file, filename) => { downloaded = { name: file.name, filename }; },
  });
  assertEqual([result.method, result.cancelled], ['download', false], '経路');
  assertEqual(downloaded, { name: 'kondate-2026-10-23.json', filename: 'kondate-2026-10-23.json' }, 'ダウンロード');
});

test('exportBackup は data を省略すると storage の中身を書き出す', async () => {
  await freshStore();
  await storage.addRecipe(BREAKFAST);
  const nav = fakeNav();
  await backup.exportBackup({ today: '2026-10-23', nav });
  const parsed = JSON.parse(await nav.calls[0].files[0].text());
  assertEqual(parsed.recipes.map((recipe) => recipe.name), [BREAKFAST.name], '自分のレシピ');
});

// --- 実行 -------------------------------------------------------------

async function runAll() {
  const summary = document.getElementById('summary');
  const output = document.getElementById('output');
  summary.dataset.started = '1'; // tests.html の「起動できたか」の見張りに知らせる
  let failed = 0;

  for (const { name, fn } of tests) {
    const row = document.createElement('div');
    row.className = 'case';
    try {
      await fn();
      row.classList.add('pass');
      row.textContent = `PASS  ${name}`;
    } catch (error) {
      failed += 1;
      row.classList.add('fail');
      row.textContent = `FAIL  ${name}\n${error.message}`;
    }
    output.append(row);
  }

  localStorage.removeItem(TEST_KEY);
  localStorage.removeItem(`${TEST_KEY}.backup.v1`);
  summary.textContent = `${tests.length} 件中 ${tests.length - failed} 件成功 / ${failed} 件失敗`;
  summary.className = failed === 0 ? 'pass' : 'fail';
}

runAll().catch((error) => {
  const summary = document.getElementById('summary');
  summary.className = 'fail';
  summary.textContent = `テストの実行自体が失敗しました: ${error.message}`;
});
