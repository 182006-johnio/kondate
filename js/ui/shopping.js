// 買い物タブ。余っている食材の登録（段階 4）。買い物リストは段階 5 で足す。

import * as storage from '../storage.js';
import { append, clear, el } from './dom.js';

export async function renderShopping(container, ctx) {
  const inventory = await storage.getInventory();

  clear(container);
  append(container, [
    el('h1', { class: 'page-title', text: '買い物' }),
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
    el('p', { class: 'muted small', text: '献立を作るとき、ここにある食材を使うレシピを優先します（ほかの決まりは守ったうえで）。食材名はレシピの表記に合わせると見つかりやすくなります。' }),
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
