// レシピ一覧。同梱レシピ集と自分のレシピを、献立のパーツ別に並べる。

import { fitsSlot } from '../schema.js';
import { clear, el } from './dom.js';
import { METHOD_LABEL, PROTEIN_LABEL, SOURCE_LABEL } from './labels.js';

// [タブ名, 表示名, そのタブに入るか, 新規追加したときの種類]
const TABS = [
  ['lunch', '昼の一品', (recipe) => fitsSlot(recipe, 'lunch', 'dish'), 'kind=dish&meal=lunch'],
  ['protein', 'たんぱく質', (recipe) => fitsSlot(recipe, 'dinner', 'protein'), 'kind=protein'],
  ['carb', '炭水化物', (recipe) => fitsSlot(recipe, 'dinner', 'carb'), 'kind=rice_side'],
  ['dressing', 'ドレッシング', (recipe) => fitsSlot(recipe, 'dinner', 'dressing'), 'kind=dressing'],
  ['breakfast', '朝食', (recipe) => fitsSlot(recipe, 'breakfast', 'dish'), 'kind=dish&meal=breakfast'],
];

// 絞り込みの文字は画面を移っても残す（詳細を見て戻ったときに打ち直さずに済むように）。
let query = '';

export async function renderRecipeList(container, ctx, tabName) {
  const [name, , belongs, newQuery] = TABS.find(([key]) => key === tabName) ?? TABS[0];
  const recipes = (await ctx.recipes())
    .filter(belongs)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const list = el('ul', { class: 'recipe-list' });
  const search = el('input', {
    type: 'search',
    class: 'field',
    value: query,
    placeholder: '料理名・食材で絞り込む',
    attrs: { 'aria-label': '絞り込み' },
    on: {
      input: () => {
        query = search.value.trim();
        fill();
      },
    },
  });

  function fill() {
    const shown = query === ''
      ? recipes
      : recipes.filter((recipe) => recipe.name.includes(query)
        || recipe.ingredients.some((item) => item.name.includes(query)));
    clear(list);
    if (shown.length === 0) {
      list.append(el('li', { class: 'muted empty-row', text: recipes.length === 0 ? 'まだありません' : '見つかりません' }));
      return;
    }
    for (const recipe of shown) {
      list.append(el('li', {},
        el('a', { class: 'recipe-link', href: `#/recipe/${encodeURIComponent(recipe.id)}` },
          el('span', { class: 'pick-name', text: recipe.name }),
          el('span', {
            class: 'pick-meta',
            text: `${SOURCE_LABEL[recipe.source]}・${PROTEIN_LABEL[recipe.protein]}・${METHOD_LABEL[recipe.method]}`,
          }))));
    }
  }

  clear(container);
  container.append(
    el('h1', { class: 'page-title', text: 'レシピ' }),
    el('nav', { class: 'segments', attrs: { 'aria-label': 'パーツ' } },
      TABS.map(([key, label]) => el('a', {
        class: key === name ? 'segment active' : 'segment',
        href: `#/recipes/${key}`,
        attrs: key === name ? { 'aria-current': 'page' } : {},
        text: label,
      }))),
    search,
    el('p', { class: 'muted small', text: `${recipes.length} 件` }),
    list,
    el('a', { class: 'button wide', href: `#/recipe-new?${newQuery}`, text: '＋ 自分のレシピを追加' }),
  );
  fill();
}
