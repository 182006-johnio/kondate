// レシピ詳細。自分のレシピなら編集・削除もここから行う。

import { missingSeasonings } from '../schema.js';
import * as storage from '../storage.js';
import { clear, el } from './dom.js';
import { KIND_LABEL, MEAL_LABEL, METHOD_LABEL, PROTEIN_LABEL, SOURCE_LABEL } from './labels.js';

export async function renderRecipe(container, ctx, id) {
  const recipe = (await ctx.recipes()).find((candidate) => candidate.id === id);
  const { pantry } = await storage.getSettings();

  clear(container);
  container.append(backLink());
  if (!recipe) {
    container.append(el('p', { class: 'notice', text: 'レシピが見つかりません。同梱レシピ集から外れたか、削除された可能性があります。' }));
    return;
  }

  const mine = recipe.source === 'mine';
  const linkOnly = recipe.source === 'dlab' || recipe.source === 'external';

  async function remove() {
    if (!confirm(`「${recipe.name}」を削除します。このレシピが入っている献立の枠と、朝食の設定も外れます。よろしいですか？`)) return;
    try {
      await storage.deleteRecipe(recipe.id);
      ctx.toast('削除しました');
      ctx.navigate('#/recipes');
    } catch (error) {
      ctx.toast(error.message);
    }
  }

  container.append(
    el('article', { class: 'recipe' },
      el('h1', { class: 'recipe-title', text: recipe.name }),
      el('p', { class: 'chips' },
        el('span', { class: 'chip strong', text: SOURCE_LABEL[recipe.source] }),
        el('span', { class: 'chip', text: KIND_LABEL[recipe.kind] }),
        recipe.kind === 'dish' ? el('span', { class: 'chip', text: recipe.meals.map((meal) => `${MEAL_LABEL[meal]}食`).join('・') }) : null,
        el('span', { class: recipe.protein === 'fish' ? 'chip fish' : 'chip', text: `たんぱく源: ${PROTEIN_LABEL[recipe.protein]}` }),
        el('span', { class: 'chip', text: METHOD_LABEL[recipe.method] }),
        recipe.minutes !== null ? el('span', { class: 'chip', text: `手を動かす時間 ${recipe.minutes} 分` }) : null),

      recipe.url
        ? el('a', {
          class: 'button wide primary',
          href: recipe.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: `元のページを開く（${SOURCE_LABEL[recipe.source]}）`,
        })
        : null,
      linkOnly ? el('p', { class: 'muted small', text: '分量と作り方は元のページで確認してください。' }) : null,

      section('食材', itemList(recipe.ingredients)),
      section('調味料', itemList(recipe.seasonings, new Set(missingSeasonings(recipe, pantry)))),
      recipe.steps.length > 0
        ? section('作り方', el('ol', { class: 'steps' }, recipe.steps.map((step) => el('li', { text: step }))))
        : null,
      recipe.note ? section('メモ', el('p', { class: 'pre', text: recipe.note })) : null,

      mine
        ? el('div', { class: 'row-actions' },
          el('a', { class: 'button', href: `#/recipe-edit/${encodeURIComponent(recipe.id)}`, text: '編集' }),
          el('button', { class: 'button danger', text: '削除', on: { click: remove } }))
        : null),
  );
}

// 来た画面へ戻る。直接開いた（履歴が無い）ときはレシピ一覧へ。
function backLink() {
  return el('a', {
    class: 'back',
    href: '#/recipes',
    text: '‹ 戻る',
    on: {
      click: (event) => {
        if (history.length > 1) {
          event.preventDefault();
          history.back();
        }
      },
    },
  });
}

function section(heading, body) {
  return el('section', { class: 'recipe-section' }, el('h2', { text: heading }), body);
}

// missing に入っている名前は「家に無い」と印を付ける（調味料一覧と照らした結果）。
function itemList(items, missing = new Set()) {
  if (items.length === 0) return el('p', { class: 'muted', text: 'なし' });
  return el('ul', { class: 'items' }, items.map((item) => el('li', {},
    el('span', {},
      item.name,
      missing.has(item.name) ? el('span', { class: 'pick-warn inline', text: '家に無い' }) : null),
    item.amount ? el('span', { class: 'amount', text: item.amount }) : null)));
}
