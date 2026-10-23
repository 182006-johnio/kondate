// 設定。朝食のレシピとエクスポート。

import { addDays, todayISO } from '../dates.js';
import { exportBackup } from '../export.js';
import { fitsSlot } from '../schema.js';
import * as storage from '../storage.js';
import { clear, el } from './dom.js';

export async function renderSettings(container, ctx) {
  const [recipes, settings, counts] = await Promise.all([
    ctx.recipes(),
    storage.getSettings(),
    storage.getCounts(),
  ]);
  const breakfasts = recipes
    .filter((recipe) => fitsSlot(recipe, 'breakfast', 'dish'))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  const breakfast = el('select', {
    class: 'field',
    attrs: { 'aria-label': '朝食のレシピ' },
    on: { change: () => changeBreakfast(ctx, breakfast.value || null).catch((error) => ctx.toast(error.message)) },
  },
  el('option', { value: '', text: '（未設定）', selected: settings.breakfast_recipe_id === null }),
  breakfasts.map((recipe) => el('option', {
    value: recipe.id,
    text: recipe.name,
    selected: recipe.id === settings.breakfast_recipe_id,
  })));

  // クリックハンドラから直接 exportBackup を呼ぶ。共有シートはユーザー操作の直後にしか開けない。
  async function runExport() {
    try {
      const result = await exportBackup();
      if (result.cancelled) ctx.toast('書き出しをやめました');
      else ctx.toast(`${result.filename} を書き出しました`);
    } catch (error) {
      ctx.toast(`書き出せませんでした: ${error.message}`);
    }
  }

  clear(container);
  container.append(
    el('h1', { class: 'page-title', text: '設定' }),

    el('section', { class: 'card' },
      el('h2', { text: '朝食' }),
      el('p', { class: 'muted small', text: '毎日の朝に入れるレシピです。変えると、今日以降の固定していない朝食も入れ替わります。' }),
      breakfasts.length > 0
        ? breakfast
        : el('p', { class: 'notice', text: '朝食に使えるレシピがまだありません。' }),
      el('a', { class: 'button wide', href: '#/recipe-new?kind=dish&meal=breakfast', text: '＋ 朝食のレシピを追加' })),

    el('section', { class: 'card' },
      el('h2', { text: 'バックアップ' }),
      el('p', { class: 'muted small', text: `自分のレシピ ${counts.recipes} 件と献立の枠 ${counts.slots} 件を JSON ファイルに書き出します。iPhone では共有シートの「"ファイル"に保存」から iCloud Drive などを選んでください。` }),
      el('button', { class: 'button primary wide', text: '書き出す', on: { click: runExport } })),
  );
}

// 朝食の設定を変え、今日以降の固定していない朝食の枠を入れ替える。
// 献立を作ってある最後の日までは、朝食の枠が無い日にも入れる（朝食を設定する前に作った週のため）。
async function changeBreakfast(ctx, recipeId) {
  await storage.updateSettings({ breakfast_recipe_id: recipeId });

  const today = todayISO();
  const future = await storage.getSlots(today, '9999-12-31');
  if (future.length === 0) {
    ctx.toast(recipeId ? '朝食を設定しました' : '朝食の設定を外しました');
    return;
  }
  const lastDate = future[future.length - 1].date;
  const breakfastByDate = new Map(future.filter((slot) => slot.meal === 'breakfast').map((slot) => [slot.date, slot]));

  const updates = [];
  for (let date = today; date <= lastDate; date = addDays(date, 1)) {
    const slot = breakfastByDate.get(date);
    if (slot?.locked) continue;
    if (recipeId) updates.push({ date, meal: 'breakfast', part: 'dish', recipe_id: recipeId, locked: false });
    else if (slot) await storage.deleteSlot(date, 'breakfast', 'dish');
  }
  if (updates.length > 0) await storage.putSlots(updates);
  ctx.toast(recipeId ? '朝食を設定し、今日以降の献立に入れました' : '朝食の設定を外しました');
}
