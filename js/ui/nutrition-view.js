// 栄養の表示部品。献立カードの 1 行、1 日の内訳シート、レシピ詳細の表で使う。

import { formatDayLabel } from '../dates.js';
import { NUTRIENTS, goalRatios } from '../nutrition.js';
import { clear, el } from './dom.js';
import { MEAL_LABEL, PART_LABEL } from './labels.js';

export const NUTRIENT_LABEL = {
  kcal: 'エネルギー',
  protein: 'たんぱく質',
  fat: '脂質',
  carb: '炭水化物',
  fiber: '食物繊維',
  salt: '塩分',
};

const UNIT = { kcal: 'kcal', protein: 'g', fat: 'g', carb: 'g', fiber: 'g', salt: 'g' };

export function formatValue(key, value) {
  if (key === 'kcal') return `${Math.round(value).toLocaleString('ja-JP')} kcal`;
  return `${value.toFixed(key === 'salt' ? 1 : 0)} g`;
}

// 献立カードに出す 1 行（例: 約 1,850 kcal ・P 120 ・F 50 ・C 230）。
export function daySummary(day) {
  const { kcal, protein, fat, carb } = day.totals;
  const text = `約 ${Math.round(kcal).toLocaleString('ja-JP')} kcal ・P ${Math.round(protein)} ・F ${Math.round(fat)} ・C ${Math.round(carb)}`;
  return day.unknownCount > 0 ? `${text}（栄養不明 ${day.unknownCount}品）` : text;
}

// その日の内訳と目標との比較をシートに出す。
export function openDaySheet(sheet, date, day, goals) {
  const ratios = goalRatios(day.totals, goals);
  clear(sheet);
  // Node#append は null を文字列 "null" にしてしまうので、el で包んで空の子を落とす。
  sheet.append(el('div', {},
    el('div', { class: 'sheet-head' },
      el('p', { class: 'muted', text: `${formatDayLabel(date)} の栄養（見込み）` }),
      el('h2', { class: 'sheet-title', text: formatValue('kcal', day.totals.kcal) }),
      day.unknownCount > 0
        ? el('p', { class: 'pick-warn', text: `栄養が分からない品が ${day.unknownCount} 品あり、合計に入っていません` })
        : null),
    el('ul', { class: 'goal-bars' }, NUTRIENTS.map((key) => goalBar(key, day.totals[key], goals?.[key] ?? null, ratios[key]))),
    goals ? null : el('p', { class: 'muted small', text: '目標は設定画面で入れられます。' }),
    el('h3', { class: 'sheet-sub', text: '内訳' }),
    el('ul', { class: 'items' }, day.items.map((item) => el('li', {},
      el('span', {},
        el('span', { class: 'muted small', text: `${itemLabel(item)} ` }),
        item.name),
      el('span', { class: 'amount', text: item.values ? formatValue('kcal', item.values.kcal) : '不明' })))),
    el('p', { class: 'muted small', text: '日本食品標準成分表（八訂）増補2023年と、元ページに載っている栄養値をもとにした目安です。' }),
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'button wide subtle', text: '閉じる', on: { click: () => sheet.close() } }))));
  if (!sheet.open) sheet.showModal();
  sheet.onclick = (event) => {
    if (event.target === sheet) sheet.close();
  };
}

function itemLabel(item) {
  if (item.part === 'base') return '夕・前提';
  if (item.meal === 'dinner') return `夕・${PART_LABEL[item.part]}`;
  return MEAL_LABEL[item.meal];
}

function goalBar(key, value, goal, ratio) {
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const fill = el('span', { class: ratio !== null && ratio > 1 ? 'bar-fill over' : 'bar-fill' });
  fill.style.width = `${Math.min(percent ?? 0, 100)}%`;
  return el('li', { class: 'goal-bar' },
    el('div', { class: 'goal-row' },
      el('span', { text: NUTRIENT_LABEL[key] }),
      el('span', { class: 'amount', text: goal === null
        ? formatValue(key, value)
        : `${formatValue(key, value)} / ${formatValue(key, goal)}（${percent}%）` })),
    goal === null ? null : el('span', { class: 'bar' }, fill));
}

// レシピ詳細の 1 人分の表。
export function nutritionTable(values) {
  return el('ul', { class: 'items' }, NUTRIENTS.map((key) => el('li', {},
    el('span', { text: NUTRIENT_LABEL[key] }),
    el('span', { class: 'amount', text: formatValue(key, values[key]) }))));
}

// 6 項目の数値入力（レシピの 1 人分の栄養と、設定の目標で使う）。
// 空欄は null。数として読めない値はそのまま NaN にして保存側の検証で弾く。
export function nutritionInputs(initial) {
  const inputs = Object.fromEntries(NUTRIENTS.map((key) => [key, el('input', {
    class: 'field',
    type: 'number',
    min: 0,
    step: 'any',
    inputMode: 'decimal',
    value: initial?.[key] ?? '',
    attrs: { 'aria-label': NUTRIENT_LABEL[key] },
  })]));
  return {
    node: el('div', { class: 'nutrient-grid' }, NUTRIENTS.map((key) => el('label', { class: 'form-field' },
      el('span', { class: 'form-label', text: `${NUTRIENT_LABEL[key]}（${UNIT[key]}）` }),
      inputs[key]))),
    values() {
      return Object.fromEntries(NUTRIENTS.map((key) => {
        const text = inputs[key].value.trim();
        return [key, text === '' ? null : Number(text)];
      }));
    },
  };
}
