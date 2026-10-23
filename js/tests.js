// テスト。ライブラリは使わず、素の JS で assert して結果を画面に出す。
//
// 本番データを壊さないよう、保存先は専用のキーに切り替えて実行し、最後に消す。

import * as dates from './dates.js';
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
  await storage.init({ key: TEST_KEY });
}

function makeRecipe(overrides = {}) {
  return {
    id: 'arrange-001',
    name: '鶏むね肉の塩レモン焼き',
    meals: ['lunch', 'dinner'],
    source: 'arrange',
    url: '',
    protein: 'chicken',
    ingredients: [{ name: '鶏むね肉', amount: '1枚' }],
    steps: ['焼く'],
    minutes: 20,
    note: '',
    ...overrides,
  };
}

const BREAKFAST = {
  name: 'オートミールとゆで卵',
  meals: ['breakfast'],
  protein: 'egg',
  ingredients: [{ name: 'オートミール', amount: '30g' }, { name: '卵', amount: '2個' }],
  steps: ['卵をゆでる', 'オートミールに牛乳をかける'],
  minutes: 10,
};

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
  assertEqual(schema.validateRecipe(makeRecipe()).errors, [], 'エラー');
});

test('validateRecipe は必須項目と列挙値の誤りを拾う', () => {
  const cases = [
    makeRecipe({ name: '  ' }),
    makeRecipe({ meals: [] }),
    makeRecipe({ meals: ['snack'] }),
    makeRecipe({ source: 'web' }),
    makeRecipe({ protein: 'lamb' }),
    makeRecipe({ url: 'javascript:alert(1)' }),
    makeRecipe({ ingredients: [{ name: '', amount: '' }] }),
    makeRecipe({ steps: [''] }),
    makeRecipe({ minutes: -1 }),
  ];
  cases.forEach((recipe, index) => {
    assert(!schema.validateRecipe(recipe).ok, `${index} 番目が通ってしまった`);
  });
});

test('normalizeRecipe は空白を落とし、空の材料行と手順を除く', () => {
  const recipe = schema.normalizeRecipe({
    id: 'x',
    name: '  納豆ごはん ',
    meals: ['breakfast', 'breakfast'],
    ingredients: [{ name: ' 納豆 ', amount: ' 1パック ' }, { name: '', amount: '' }],
    steps: [' 混ぜる ', '  '],
  });
  assertEqual(recipe.name, '納豆ごはん', '名前');
  assertEqual(recipe.meals, ['breakfast'], '食事の重複');
  assertEqual(recipe.ingredients, [{ name: '納豆', amount: '1パック' }], '材料');
  assertEqual(recipe.steps, ['混ぜる'], '手順');
  assertEqual([recipe.source, recipe.protein, recipe.minutes, recipe.url], ['mine', 'none', null, ''], '既定値');
});

test('validateDB は空の DB を通す', () => {
  assertEqual(schema.validateDB(schema.createDB()).errors, [], 'エラー');
});

test('validateDB は枠の重複を拾う', () => {
  const db = schema.createDB();
  const slot = { date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-001', locked: false };
  db.slots = [slot, { ...slot }];
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

test('getMyRecipe はコピーを返す（書き換えても保存に影響しない）', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  const copy = await storage.getMyRecipe(added.id);
  copy.name = '書き換え';
  assertEqual((await storage.getMyRecipe(added.id)).name, BREAKFAST.name, '名前');
});

test('putSlot は (date, meal) が同じなら置き換える', async () => {
  await freshStore();
  await storage.putSlot({ date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-001' });
  await storage.putSlot({ date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-002', locked: true });
  const slots = await storage.getSlots('2026-10-19', '2026-10-19');
  assertEqual(slots, [{ date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-002', locked: true }], '枠');
});

test('putSlots は 1 件でも不正なら何も書かない', async () => {
  await freshStore();
  await assertThrows(() => storage.putSlots([
    { date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-001' },
    { date: '2026-10-19', meal: 'snack', recipe_id: 'arrange-002' },
  ]), '不正な meal');
  await assertThrows(() => storage.putSlots([
    { date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-001' },
    { date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-002' },
  ]), '同じ枠が 2 回');
  assertEqual((await storage.getCounts()).slots, 0, '件数');
});

test('putSlot は存在しない自分のレシピを指せない', async () => {
  await freshStore();
  await assertThrows(
    () => storage.putSlot({ date: '2026-10-19', meal: 'breakfast', recipe_id: crypto.randomUUID() }),
    '存在しない UUID',
  );
});

test('getSlots は期間内を日付・朝昼夜の順で返す', async () => {
  await freshStore();
  await storage.putSlots([
    { date: '2026-10-20', meal: 'breakfast', recipe_id: 'a' },
    { date: '2026-10-19', meal: 'dinner', recipe_id: 'b' },
    { date: '2026-10-19', meal: 'breakfast', recipe_id: 'c' },
    { date: '2026-10-26', meal: 'lunch', recipe_id: 'd' },
  ]);
  const slots = await storage.getSlots('2026-10-19', '2026-10-25');
  assertEqual(slots.map((slot) => slot.recipe_id), ['c', 'b', 'a'], '順序');
});

test('deleteSlot は枠を消して未提案に戻す', async () => {
  await freshStore();
  await storage.putSlot({ date: '2026-10-19', meal: 'lunch', recipe_id: 'a' });
  assert(await storage.deleteSlot('2026-10-19', 'lunch'), '消せた');
  assert(!(await storage.deleteSlot('2026-10-19', 'lunch')), '2 回目は false');
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

test('deleteRecipe はそのレシピの枠と朝食設定も消す', async () => {
  await freshStore();
  const added = await storage.addRecipe(BREAKFAST);
  await storage.updateSettings({ breakfast_recipe_id: added.id });
  await storage.putSlots([
    { date: '2026-10-19', meal: 'breakfast', recipe_id: added.id },
    { date: '2026-10-19', meal: 'lunch', recipe_id: 'arrange-001' },
  ]);

  assert(await storage.deleteRecipe(added.id), '消せた');
  const slots = await storage.getSlots('2026-10-19', '2026-10-19');
  assertEqual(slots.map((slot) => slot.recipe_id), ['arrange-001'], '同梱レシピの枠は残る');
  assertEqual((await storage.getSettings()).breakfast_recipe_id, null, '朝食設定');
});

// --- planner ----------------------------------------------------------

const WEEK = '2026-10-19'; // 月曜
const PREV_SUNDAY = '2026-10-18';

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

// 昼・夕どちらにも使えるレシピを、protein ごとに count 件ずつ作る。
function variedRecipes(count = 4) {
  const proteins = ['chicken', 'pork', 'beef', 'fish', 'egg', 'soy'];
  return proteins.flatMap((protein) => Array.from({ length: count }, (_, index) => makeRecipe({
    id: `${protein}-${index}`,
    name: `${protein} ${index}`,
    protein,
  })));
}

const BREAKFAST_RECIPE = makeRecipe({ id: 'mine-breakfast', meals: ['breakfast'], protein: 'egg', source: 'mine' });

function byKey(slots) {
  return new Map(slots.map((slot) => [schema.slotKey(slot.date, slot.meal), slot]));
}

// 提案ルール 2〜4 を満たしているかを確かめる。違反を文字列の配列で返す。
function ruleViolations(slots, recipes) {
  const protein = new Map(recipes.map((recipe) => [recipe.id, recipe.protein]));
  const map = byKey(slots);
  const violations = [];
  const days = dates.weekDates(WEEK);

  const ids = days.flatMap((date) => ['lunch', 'dinner']
    .map((meal) => map.get(schema.slotKey(date, meal))?.recipe_id)
    .filter(Boolean));
  if (new Set(ids).size !== ids.length) violations.push('同じ週に同じレシピ');

  for (const date of days) {
    const lunch = protein.get(map.get(schema.slotKey(date, 'lunch'))?.recipe_id);
    const dinner = protein.get(map.get(schema.slotKey(date, 'dinner'))?.recipe_id);
    if (lunch && lunch !== 'none' && lunch === dinner) violations.push(`${date} 昼と夕が ${lunch}`);

    const before = protein.get(map.get(schema.slotKey(dates.addDays(date, -1), 'dinner'))?.recipe_id);
    if (dinner && dinner !== 'none' && dinner === before) violations.push(`${date} 前日の夕食と ${dinner}`);
  }
  return violations;
}

test('planWeek は朝食を固定し、昼・夕を 7 日分埋める', () => {
  const recipes = [BREAKFAST_RECIPE, ...variedRecipes()];
  const slots = planner.planWeek({
    weekStart: WEEK, recipes, slots: [], breakfastRecipeId: BREAKFAST_RECIPE.id, random: seeded(1),
  });
  assertEqual(slots.length, 21, '枠の数');
  assert(slots.filter((slot) => slot.meal === 'breakfast').every((slot) => slot.recipe_id === BREAKFAST_RECIPE.id), '朝食');
  assert(slots.every((slot) => slot.locked === false), '新しい枠は固定しない');
  assert(slots.every((slot) => schema.validateSlot(slot).ok), '枠として正しい');
});

test('planWeek は候補が十分あればルールを破らない（seed を変えて 50 回）', () => {
  const recipes = [BREAKFAST_RECIPE, ...variedRecipes()];
  for (let seed = 1; seed <= 50; seed += 1) {
    const previous = { date: PREV_SUNDAY, meal: 'dinner', recipe_id: 'fish-0', locked: false };
    const slots = planner.planWeek({
      weekStart: WEEK, recipes, slots: [previous], breakfastRecipeId: null, random: seeded(seed),
    });
    const violations = ruleViolations([previous, ...slots], recipes);
    assertEqual(violations, [], `seed ${seed}`);
  }
});

test('planWeek は前週の日曜の夕食を返さず、月曜の夕食と比べるだけにする', () => {
  // 夕食に使えるのは fish と chicken だけ。前週日曜が fish なら月曜は chicken になる。
  const recipes = [
    makeRecipe({ id: 'lunch-none', meals: ['lunch'], protein: 'none' }),
    makeRecipe({ id: 'fish-a', meals: ['dinner'], protein: 'fish' }),
    makeRecipe({ id: 'chicken-a', meals: ['dinner'], protein: 'chicken' }),
  ];
  const previous = { date: PREV_SUNDAY, meal: 'dinner', recipe_id: 'fish-a', locked: false };
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = planner.planWeek({
      weekStart: WEEK, recipes, slots: [previous], breakfastRecipeId: null, random: seeded(seed),
    });
    assert(slots.every((slot) => slot.date >= WEEK), '週の外の枠を返した');
    assertEqual(byKey(slots).get(`${WEEK} dinner`).recipe_id, 'chicken-a', `seed ${seed} 月曜の夕食`);
  }
});

test('planWeek は固定枠を残し、そのレシピを他の枠で使わない', () => {
  const recipes = [BREAKFAST_RECIPE, ...variedRecipes()];
  const locked = [
    { date: '2026-10-21', meal: 'dinner', recipe_id: 'beef-0', locked: true },
    { date: '2026-10-19', meal: 'breakfast', recipe_id: 'chicken-3', locked: true },
  ];
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = planner.planWeek({
      weekStart: WEEK, recipes, slots: locked, breakfastRecipeId: BREAKFAST_RECIPE.id, random: seeded(seed),
    });
    const map = byKey(slots);
    assertEqual(map.get('2026-10-21 dinner'), locked[0], '固定した夕食');
    assertEqual(map.get('2026-10-19 breakfast'), locked[1], '固定した朝食');
    const beefUses = slots.filter((slot) => slot.recipe_id === 'beef-0').length;
    assertEqual(beefUses, 1, `seed ${seed} 固定したレシピの使用回数`);
    assertEqual(ruleViolations(slots, recipes), [], `seed ${seed} 固定枠の前後`);
  }
});

test('planWeek は固定していない既存の枠を作り直す（使用済みに数えない）', () => {
  // 昼専用・夕専用が 7 件ずつ。既存の枠を使用済みに数えてしまうと候補が足りず重複が出る。
  const lunches = Array.from({ length: 7 }, (_, i) => makeRecipe({ id: `l${i}`, meals: ['lunch'], protein: 'none' }));
  const dinners = Array.from({ length: 7 }, (_, i) => makeRecipe({ id: `d${i}`, meals: ['dinner'], protein: 'none' }));
  const existing = dates.weekDates(WEEK).flatMap((date, i) => [
    { date, meal: 'lunch', recipe_id: `l${i}`, locked: false },
    { date, meal: 'dinner', recipe_id: `d${i}`, locked: false },
  ]);
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = planner.planWeek({
      weekStart: WEEK, recipes: [...lunches, ...dinners], slots: existing, breakfastRecipeId: null, random: seeded(seed),
    });
    assertEqual(new Set(slots.map((slot) => slot.recipe_id)).size, 14, `seed ${seed} 14 件すべて別のレシピ`);
  }
});

test('planWeek は朝食が未設定なら朝食枠を作らない', () => {
  const slots = planner.planWeek({
    weekStart: WEEK, recipes: variedRecipes(), slots: [], breakfastRecipeId: null, random: seeded(1),
  });
  assert(slots.every((slot) => slot.meal !== 'breakfast'), '朝食枠がある');
  assertEqual(slots.length, 14, '枠の数');
});

test('planWeek は候補が少なくても条件を緩めて全枠を埋める', () => {
  // 昼・夕兼用が鶏肉 2 件だけ。重複も protein の重なりも避けられない。
  const recipes = [makeRecipe({ id: 'c1' }), makeRecipe({ id: 'c2' })];
  const slots = planner.planWeek({
    weekStart: WEEK, recipes, slots: [], breakfastRecipeId: null, random: seeded(3),
  });
  assertEqual(slots.length, 14, '枠の数');
});

test('planWeek は緩めるとき「同じ週で重複しない」を最後まで守る', () => {
  // 鶏肉だけ 14 件。protein の条件は破るしかないが、重複は避けられる。
  const recipes = Array.from({ length: 14 }, (_, i) => makeRecipe({ id: `c${i}` }));
  for (let seed = 1; seed <= 20; seed += 1) {
    const slots = planner.planWeek({
      weekStart: WEEK, recipes, slots: [], breakfastRecipeId: null, random: seeded(seed),
    });
    assertEqual(new Set(slots.map((slot) => slot.recipe_id)).size, 14, `seed ${seed} 重複`);
  }
});

test('planWeek は使えるレシピが 0 件の食事を未提案のままにする', () => {
  const recipes = [makeRecipe({ id: 'lunch-only', meals: ['lunch'] })];
  const slots = planner.planWeek({
    weekStart: WEEK, recipes, slots: [], breakfastRecipeId: null, random: seeded(1),
  });
  assert(slots.every((slot) => slot.meal === 'lunch'), '夕食枠がある');
  assertEqual(slots.length, 7, '枠の数');
});

test('planWeek は同じ乱数列なら同じ献立を返す', () => {
  const recipes = variedRecipes();
  const run = () => planner.planWeek({
    weekStart: WEEK, recipes, slots: [], breakfastRecipeId: null, random: seeded(42),
  });
  assertEqual(run(), run(), '結果');
});

test('planWeek は random が 1 に極めて近い値を返しても範囲外にならない', () => {
  const slots = planner.planWeek({
    weekStart: WEEK, recipes: variedRecipes(1), slots: [], breakfastRecipeId: null, random: () => 0.9999999999999999,
  });
  assert(slots.every((slot) => typeof slot.recipe_id === 'string'), 'recipe_id');
});

test('rerollSlot は今のレシピを避け、ルールを守る', () => {
  const recipes = variedRecipes();
  const base = planner.planWeek({
    weekStart: WEEK, recipes, slots: [], breakfastRecipeId: null, random: seeded(7),
  });
  const target = base.find((slot) => slot.date === '2026-10-22' && slot.meal === 'dinner');
  for (let seed = 1; seed <= 30; seed += 1) {
    const slot = planner.rerollSlot({
      date: target.date, meal: target.meal, recipes, slots: base, random: seeded(seed),
    });
    assert(slot.recipe_id !== target.recipe_id, `seed ${seed} 今のレシピのまま`);
    const next = base.map((candidate) => (candidate === target ? slot : candidate));
    assertEqual(ruleViolations(next, recipes), [], `seed ${seed}`);
  }
});

test('rerollSlot は他に候補が無ければ今のレシピを返し、0 件なら null', () => {
  const only = makeRecipe({ id: 'only', meals: ['lunch'] });
  const current = { date: WEEK, meal: 'lunch', recipe_id: 'only', locked: false };
  const slot = planner.rerollSlot({ date: WEEK, meal: 'lunch', recipes: [only], slots: [current], random: seeded(1) });
  assertEqual(slot, { ...current }, '今のレシピ');
  assertEqual(
    planner.rerollSlot({ date: WEEK, meal: 'dinner', recipes: [only], slots: [], random: seeded(1) }),
    null,
    '候補なし',
  );
});

// --- 実行 -------------------------------------------------------------

async function run() {
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
  summary.textContent = `${tests.length} 件中 ${tests.length - failed} 件成功 / ${failed} 件失敗`;
  summary.className = failed === 0 ? 'pass' : 'fail';
}

run().catch((error) => {
  const summary = document.getElementById('summary');
  summary.className = 'fail';
  summary.textContent = `テストの実行自体が失敗しました: ${error.message}`;
});
