// テスト。ライブラリは使わず、素の JS で assert して結果を画面に出す。
//
// 本番データを壊さないよう、保存先は専用のキーに切り替えて実行し、最後に消す。

import * as dates from './dates.js';
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
