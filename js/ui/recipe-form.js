// 自分のレシピの追加・編集。
// 食材・調味料・手順は行を足し引きできる。調味料は家にある一覧（data/pantry.js）を候補に出す。

import { PANTRY } from '../../data/pantry.js';
import { KINDS, METHODS, PROTEINS } from '../schema.js';
import * as storage from '../storage.js';
import { clear, el } from './dom.js';
import { KIND_LABEL, MEAL_LABEL, METHOD_LABEL, PROTEIN_LABEL } from './labels.js';

const DISH_MEALS = ['breakfast', 'lunch'];

// id があれば編集、無ければ新規。query は新規のときの初期値（kind=dish&meal=breakfast など）。
export async function renderRecipeForm(container, ctx, { id = null, query = '' } = {}) {
  let recipe;
  if (id) {
    recipe = await storage.getMyRecipe(id);
    if (!recipe) {
      clear(container);
      container.append(el('p', { class: 'notice', text: '編集できるのは自分のレシピだけです。' }));
      return;
    }
  } else {
    const params = new URLSearchParams(query);
    const kind = KINDS.includes(params.get('kind')) ? params.get('kind') : 'dish';
    const meal = DISH_MEALS.includes(params.get('meal')) ? params.get('meal') : 'lunch';
    recipe = {
      name: '', kind, meals: [meal], url: '', protein: 'none', method: 'none',
      ingredients: [], seasonings: [], steps: [], minutes: null, note: '',
    };
  }

  const name = el('input', { class: 'field', value: recipe.name, required: true, maxLength: 80 });
  const kind = select(KINDS, KIND_LABEL, recipe.kind);
  const mealBoxes = DISH_MEALS.map((meal) => el('input', {
    type: 'checkbox', value: meal, checked: recipe.meals.includes(meal),
  }));
  const mealsField = el('fieldset', { class: 'checks' },
    el('legend', { text: '使える食事' }),
    DISH_MEALS.map((meal, index) => el('label', { class: 'check' }, mealBoxes[index], `${MEAL_LABEL[meal]}食`)));
  const protein = select(PROTEINS, PROTEIN_LABEL, recipe.protein);
  const method = select(METHODS, METHOD_LABEL, recipe.method);
  const minutes = el('input', {
    class: 'field', type: 'number', min: 0, step: 1, inputMode: 'numeric',
    value: recipe.minutes ?? '',
  });
  const url = el('input', { class: 'field', type: 'url', value: recipe.url, placeholder: 'https://' });
  const ingredients = itemRows(recipe.ingredients, { placeholder: '食材', addLabel: '＋ 食材を追加' });
  const seasonings = itemRows(recipe.seasonings, { placeholder: '調味料', addLabel: '＋ 調味料を追加', list: 'pantry' });
  const steps = stepRows(recipe.steps);
  const note = el('textarea', { class: 'field', rows: 3, value: recipe.note });
  const errorBox = el('p', { class: 'form-error pre', hidden: true });

  // 一品のときだけ「使える食事」を出す。夕食のパーツは夕食専用なので選ばせない。
  const syncMeals = () => { mealsField.hidden = kind.value !== 'dish'; };
  kind.addEventListener('change', syncMeals);
  syncMeals();

  async function save(event) {
    event.preventDefault();
    const minutesText = minutes.value.trim();
    const fields = {
      name: name.value,
      kind: kind.value,
      meals: mealBoxes.filter((box) => box.checked).map((box) => box.value),
      protein: protein.value,
      method: method.value,
      minutes: minutesText === '' ? null : Number(minutesText),
      url: url.value,
      ingredients: ingredients.values(),
      seasonings: seasonings.values(),
      steps: steps.values(),
      note: note.value,
    };
    // よくある入力漏れは、保存側の検証メッセージ（id や項目名が出る）より先に日本語で知らせる。
    const missing = [];
    if (fields.name.trim() === '') missing.push('料理名を入れてください。');
    if (fields.kind === 'dish' && fields.meals.length === 0) missing.push('使える食事を 1 つ以上選んでください。');
    if (missing.length > 0) {
      errorBox.textContent = missing.join('\n');
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'center' });
      return;
    }
    try {
      const saved = id ? await storage.updateRecipe(id, fields) : await storage.addRecipe(fields);
      ctx.toast(id ? '保存しました' : '追加しました');
      // 戻るでフォームに戻らないよう、履歴を置き換える。
      location.replace(`#/recipe/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'center' });
    }
  }

  clear(container);
  container.append(
    el('a', { class: 'back', href: id ? `#/recipe/${encodeURIComponent(id)}` : '#/recipes', text: '‹ やめる' }),
    el('h1', { class: 'page-title', text: id ? 'レシピを編集' : '自分のレシピを追加' }),
    el('form', { class: 'form', on: { submit: save } },
      field('料理名', name),
      field('種類', kind),
      mealsField,
      field('主なたんぱく源', protein),
      field('主な加熱方法', method),
      field('手を動かす時間（分）', minutes),
      field('元のページの URL', url),
      group('食材', ingredients.node),
      group('調味料', seasonings.node),
      group('作り方', steps.node),
      field('メモ', note),
      errorBox,
      el('button', { class: 'button primary wide', type: 'submit', text: id ? '保存する' : '追加する' })),
    el('datalist', { id: 'pantry' }, PANTRY.map((item) => el('option', { value: item }))),
  );
}

function select(values, labels, current) {
  return el('select', { class: 'field' },
    values.map((value) => el('option', { value, selected: value === current, text: labels[value] })));
}

function field(label, control) {
  return el('label', { class: 'form-field' }, el('span', { class: 'form-label', text: label }), control);
}

function group(label, body) {
  return el('div', { class: 'form-field' }, el('span', { class: 'form-label', text: label }), body);
}

// 名前と分量の 2 列の行。空の行は保存時に schema 側で落ちる。
function itemRows(initial, { placeholder, addLabel, list = null }) {
  const rows = el('div', { class: 'rows' });
  const addRow = (item = { name: '', amount: '' }) => {
    const row = el('div', { class: 'row' },
      el('input', { class: 'field', value: item.name, placeholder, attrs: list ? { list } : {} }),
      el('input', { class: 'field amount-field', value: item.amount, placeholder: '分量' }),
      removeButton(() => row.remove()));
    rows.append(row);
  };
  initial.forEach(addRow);
  if (initial.length === 0) addRow();

  return {
    node: el('div', {}, rows, el('button', { type: 'button', class: 'button subtle', text: addLabel, on: { click: () => addRow() } })),
    values: () => [...rows.children].map((row) => {
      const [nameInput, amountInput] = row.querySelectorAll('input');
      return { name: nameInput.value, amount: amountInput.value };
    }),
  };
}

function stepRows(initial) {
  const rows = el('ol', { class: 'rows step-rows' });
  const addRow = (text = '') => {
    const row = el('li', { class: 'row' },
      el('textarea', { class: 'field', rows: 2, value: text, placeholder: '手順' }),
      removeButton(() => row.remove()));
    rows.append(row);
  };
  initial.forEach(addRow);
  if (initial.length === 0) addRow();

  return {
    node: el('div', {}, rows, el('button', { type: 'button', class: 'button subtle', text: '＋ 手順を追加', on: { click: () => addRow() } })),
    values: () => [...rows.querySelectorAll('textarea')].map((area) => area.value),
  };
}

function removeButton(onClick) {
  return el('button', {
    type: 'button',
    class: 'icon-button remove',
    attrs: { 'aria-label': 'この行を消す' },
    text: '×',
    on: { click: onClick },
  });
}
