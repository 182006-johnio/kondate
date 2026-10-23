// 買い物タブ。その週の買い物リストと、余っている食材の登録。

import { addDays, formatDayLabel, startOfWeek, todayISO, weekDates } from '../dates.js';
import { formatAmount, shoppingList } from '../shopping-list.js';
import * as storage from '../storage.js';
import { append, clear, el } from './dom.js';

// 夕食の前提の項目は、レシピの食材と同じ名前でもチェックを分ける。
const BASE_KEY = (name) => `前提:${name}`;

export async function renderShopping(container, ctx, requested) {
  const today = todayISO();
  const week = startOfWeek(requested ?? today);
  const days = weekDates(week);

  const [recipes, slots, settings, details, inventory, checked] = await Promise.all([
    ctx.recipes(),
    storage.getSlots(days[0], days[6]),
    storage.getSettings(),
    storage.getDetails(),
    storage.getInventory(),
    storage.getShoppingChecked(week),
  ]);
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const list = shoppingList({ days, slots, byId, details, inventory, pantry: settings.pantry });
  const done = new Set(checked);

  async function toggle(key, value) {
    try {
      await storage.setShoppingChecked(week, key, value);
      await ctx.refresh();
    } catch (error) {
      ctx.toast(error.message);
    }
  }

  const row = (key, name, amount, detail) => el('li', { class: done.has(key) ? 'shop-item done' : 'shop-item' },
    el('label', { class: 'shop-check' },
      el('input', { type: 'checkbox', checked: done.has(key), on: { change: (event) => toggle(key, event.target.checked) } }),
      el('span', { class: 'shop-text' },
        el('span', { class: 'shop-name', text: name }),
        detail ? el('span', { class: 'muted small', text: detail }) : null),
      el('span', { class: 'amount', text: amount })));

  // 夕食の前提を先に、レシピの食材をその後に並べ、買ったものはまとめて下に回す。
  const rows = [
    ...list.base.filter((item) => !item.leftover)
      .map((item) => ({ key: BASE_KEY(item.name), name: item.name, amount: item.text, detail: '夕食の前提' })),
    ...list.items
      .map((item) => ({ key: item.name, name: item.name, amount: formatAmount(item), detail: item.recipes.join('、') })),
  ].sort((a, b) => Number(done.has(a.key)) - Number(done.has(b.key)));
  const remaining = rows.filter((r) => !done.has(r.key)).length;

  clear(container);
  append(container, [
    el('h1', { class: 'page-title', text: '買い物' }),
    el('header', { class: 'week-header' },
      el('a', { class: 'icon-button', href: `#/shopping/${addDays(week, -7)}`, attrs: { 'aria-label': '前の週' }, text: '‹' }),
      el('div', { class: 'week-title' },
        el('h2', { text: `${formatDayLabel(days[0])} 〜 ${formatDayLabel(days[6])}` }),
        week === startOfWeek(today)
          ? el('span', { class: 'chip', text: '今週' })
          : el('a', { class: 'link', href: '#/shopping', text: '今週へ' })),
      el('a', { class: 'icon-button', href: `#/shopping/${addDays(week, 7)}`, attrs: { 'aria-label': '次の週' }, text: '›' })),

    slots.length === 0
      ? el('p', { class: 'notice' }, 'この週の献立がまだありません。', el('a', { href: `#/week/${week}`, text: '献立を作る' }))
      : null,

    el('section', { class: 'card' },
      el('h2', { text: `買うもの（残り ${remaining}）` }),
      el('p', { class: 'muted small', text: '量は分量データの 1 人分 × 回数の目安です。作り置きのレシピは元の分量でまとめて作るので、実際に買う量はもっと多くなります。分量データが無いレシピの食材は回数だけ出します。調味料と余っている食材は入れていません。' }),
      el('ul', { class: 'shop-list' }, rows.map((r) => row(r.key, r.name, r.amount, r.detail)))),

    list.missingSeasonings.length > 0
      ? el('section', { class: 'card' },
        el('h2', { text: '家に無い調味料' }),
        el('p', { class: 'muted small', text: '一覧から手で選んだレシピが使っています。買ったら設定の「家にある調味料」に足してください。' }),
        el('ul', { class: 'items' }, list.missingSeasonings.map((item) => el('li', {},
          el('span', { text: item.name }),
          el('span', { class: 'amount small', text: item.recipes.join('、') })))))
      : null,

    list.leftovers.length > 0 || list.base.some((item) => item.leftover)
      ? el('section', { class: 'card' },
        el('h2', { text: '余っている食材で足りるもの' }),
        el('ul', { class: 'items' },
          list.base.filter((item) => item.leftover).map((item) => el('li', {},
            el('span', { text: item.name }), el('span', { class: 'amount', text: item.text }))),
          list.leftovers.map((item) => el('li', {},
            el('span', { text: item.name }), el('span', { class: 'amount', text: formatAmount(item) })))))
      : null,

    inventoryCard(ctx, inventory),
  ]);
}

function inventoryCard(ctx, inventory) {
  const input = el('input', {
    class: 'field',
    maxLength: 80,
    placeholder: '例: 鶏むね肉、キャベツ',
    attrs: { 'aria-label': '余っている食材' },
  });

  async function add(event) {
    event.preventDefault();
    const name = input.value;
    try {
      const added = await storage.addInventory(name);
      ctx.toast(added ? `「${name.trim()}」を追加しました` : 'もう入っています');
      await ctx.refresh();
    } catch (error) {
      ctx.toast(error.message);
    }
  }

  async function remove(name) {
    await storage.removeInventory(name);
    ctx.toast(`「${name}」を外しました`);
    await ctx.refresh();
  }

  return el('section', { class: 'card' },
    el('h2', { text: `余っている食材（${inventory.length}）` }),
    el('p', { class: 'muted small', text: '献立を作るとき、ここにある食材を使うレシピを優先します（ほかの決まりは守ったうえで）。買い物リストからも外します。食材名はレシピの表記に合わせると見つかりやすくなります。' }),
    inventory.length > 0
      ? el('ul', { class: 'tag-list' }, inventory.map((name) => el('li', { class: 'tag' },
        el('span', { text: name }),
        el('button', {
          type: 'button',
          class: 'tag-remove',
          attrs: { 'aria-label': `${name}を外す` },
          text: '×',
          on: { click: () => remove(name).catch((error) => ctx.toast(error.message)) },
        }))))
      : el('p', { class: 'muted', text: 'まだありません。' }),
    el('form', { class: 'inline-form', on: { submit: add } },
      input,
      el('button', { class: 'button', type: 'submit', text: '追加' })));
}
