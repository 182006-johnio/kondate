// 献立の枠をタップしたときに下から出すシート。
// 引き直し・一覧から選ぶ・固定・空にする、とレシピ詳細への移動をここでまとめる。

import { formatDayLabel, weekdayOf } from '../dates.js';
import { rerollSlot } from '../planner.js';
import { fitsSlot, inventoryMatches, missingSeasonings } from '../schema.js';
import * as storage from '../storage.js';
import { clear, el } from './dom.js';
import { MEAL_LABEL, METHOD_LABEL, PART_LABEL, PROTEIN_LABEL } from './labels.js';

const FISH_DAY = 4; // 木曜。planner.js と同じ決まり

// info: { date, meal, part, slot, recipe, nearby }
// nearby は週の全枠と前週の日曜・翌週の月曜（引き直しで隣の日と比べるため）。
export function openSlotSheet(ctx, info) {
  const sheet = ctx.sheet;
  showActions(ctx, info);
  if (!sheet.open) sheet.showModal();
  // 背景（シートの外側）を押したら閉じる。
  sheet.onclick = (event) => {
    if (event.target === sheet) sheet.close();
  };
}

function title({ date, meal, part }) {
  const where = meal === 'dinner' ? `夕・${PART_LABEL[part]}` : MEAL_LABEL[meal];
  return `${formatDayLabel(date)} ${where}`;
}

function showActions(ctx, info) {
  const { slot, recipe } = info;
  const sheet = ctx.sheet;

  // 操作のあとは保存して閉じ、献立画面を描き直す。
  const act = (fn, message) => async () => {
    try {
      await fn();
      sheet.close();
      if (message) ctx.toast(message);
      await ctx.refresh();
    } catch (error) {
      ctx.toast(error.message);
    }
  };

  let current = '未提案';
  if (slot) current = recipe ? recipe.name : '見つからないレシピ';

  clear(sheet);
  sheet.append(
    el('div', { class: 'sheet-head' },
      el('p', { class: 'muted', text: title(info) }),
      el('h2', { class: 'sheet-title', text: current }),
      slot?.locked ? el('span', { class: 'chip', text: '🔒 固定中' }) : null),

    el('div', { class: 'sheet-actions' },
      recipe
        ? el('a', {
          class: 'button wide',
          href: `#/recipe/${encodeURIComponent(recipe.id)}`,
          text: 'レシピを見る',
          on: { click: () => sheet.close() },
        })
        : null,
      el('button', {
        class: 'button wide',
        text: '引き直す',
        on: { click: act(() => reroll(ctx, info), '引き直しました') },
      }),
      el('button', {
        class: 'button wide',
        text: '一覧から選ぶ',
        on: { click: () => showPicker(ctx, info).catch((error) => ctx.toast(error.message)) },
      }),
      slot
        ? el('button', {
          class: 'button wide',
          text: slot.locked ? '固定を外す' : '固定する',
          on: { click: act(() => storage.putSlot({ ...slot, locked: !slot.locked })) },
        })
        : null,
      slot
        ? el('button', {
          class: 'button wide danger',
          text: '空にする',
          on: { click: act(() => storage.deleteSlot(slot.date, slot.meal, slot.part), '空にしました') },
        })
        : null,
      el('button', { class: 'button wide subtle', text: '閉じる', on: { click: () => sheet.close() } })),
  );
}

async function reroll(ctx, { date, meal, part, slot, nearby }) {
  const [{ pantry }, inventory] = await Promise.all([storage.getSettings(), storage.getInventory()]);
  const next = rerollSlot({
    date, meal, part, recipes: await ctx.recipes(), slots: nearby, random: Math.random, pantry, inventory,
  });
  if (!next) throw new Error('この枠に入れられるレシピがありません');
  // 固定していた枠を引き直したときは、固定のままにする。
  await storage.putSlot({ ...next, locked: slot?.locked ?? false });
}

async function showPicker(ctx, info) {
  const { date, meal, part, slot } = info;
  const sheet = ctx.sheet;
  const fishDay = meal === 'dinner' && part === 'protein' && weekdayOf(date) === FISH_DAY;

  const [{ pantry }, inventory] = await Promise.all([storage.getSettings(), storage.getInventory()]);
  const candidates = (await ctx.recipes())
    .filter((recipe) => fitsSlot(recipe, meal, part))
    .sort((a, b) => {
      // 魚の日は魚を先に並べる。
      if (fishDay && (a.protein === 'fish') !== (b.protein === 'fish')) return a.protein === 'fish' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ja');
    });

  const list = el('ul', { class: 'picker' });
  const search = el('input', {
    type: 'search',
    class: 'field',
    placeholder: '料理名・食材で絞り込む',
    attrs: { 'aria-label': '絞り込み' },
    on: { input: () => fill(search.value.trim()) },
  });

  // 手で選んだ枠は固定する。「作り直す」で消えないようにするため。
  async function choose(recipe) {
    try {
      await storage.putSlot({ date, meal, part, recipe_id: recipe.id, locked: true });
      sheet.close();
      ctx.toast(`「${recipe.name}」にして固定しました`);
      await ctx.refresh();
    } catch (error) {
      ctx.toast(error.message);
    }
  }

  function fill(query) {
    const shown = query === ''
      ? candidates
      : candidates.filter((recipe) => recipe.name.includes(query)
        || recipe.ingredients.some((item) => item.name.includes(query)));
    clear(list);
    if (shown.length === 0) {
      list.append(el('li', { class: 'muted empty-row', text: '見つかりません' }));
      return;
    }
    for (const recipe of shown) {
      // 手で選ぶときは家に無い調味料のレシピも選べる。買い足す前提で選ぶこともあるため。
      const missing = missingSeasonings(recipe, pantry);
      const leftovers = inventoryMatches(recipe, inventory);
      list.append(el('li', {},
        el('button', {
          class: recipe.id === slot?.recipe_id ? 'pick current' : 'pick',
          on: { click: () => choose(recipe) },
        },
        el('span', { class: 'pick-name', text: recipe.name }),
        el('span', { class: 'pick-meta', text: `${PROTEIN_LABEL[recipe.protein]}・${METHOD_LABEL[recipe.method]}` }),
        leftovers.length > 0 ? el('span', { class: 'chip leftover', text: `余り: ${leftovers.join('・')}` }) : null,
        missing.length > 0
          ? el('span', { class: 'pick-warn', text: `家に無い調味料: ${missing.join('、')}` })
          : null)));
    }
  }

  clear(sheet);
  sheet.append(
    el('div', { class: 'sheet-head' },
      el('p', { class: 'muted', text: title(info) }),
      el('h2', { class: 'sheet-title', text: '一覧から選ぶ' }),
      el('p', { class: 'muted small', text: '選んだレシピは固定されます' })),
    search,
    list,
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'button wide subtle', text: '戻る', on: { click: () => showActions(ctx, info) } })),
  );
  fill('');
}
