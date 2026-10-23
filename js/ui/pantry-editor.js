// 設定画面の「家にある調味料」。追加と削除ができる。
// 一覧に無い調味料を使うレシピは、献立の提案に出なくなる（planner.js）。

import * as storage from '../storage.js';
import { el } from './dom.js';

export function pantryEditor(ctx, pantry) {
  async function save(next, message) {
    try {
      await storage.updateSettings({ pantry: next });
      ctx.toast(message);
      await ctx.refresh();
    } catch (error) {
      ctx.toast(error.message);
    }
  }

  const input = el('input', {
    class: 'field',
    maxLength: 20,
    placeholder: '調味料の名前',
    attrs: { 'aria-label': '追加する調味料' },
  });

  function add(event) {
    event.preventDefault();
    const name = input.value.normalize('NFKC').trim();
    if (name === '') return;
    if (pantry.includes(name)) {
      ctx.toast(`「${name}」はもう入っています`);
      return;
    }
    save([...pantry, name], `「${name}」を追加しました`);
  }

  return el('section', { class: 'card' },
    el('h2', { text: `家にある調味料（${pantry.length}）` }),
    el('p', { class: 'muted small', text: 'ここに無い調味料を使うレシピは、献立の提案に出なくなります。一覧から手で選ぶことはできます。' }),
    el('ul', { class: 'tag-list' }, pantry.map((name) => el('li', { class: 'tag' },
      el('span', { text: name }),
      el('button', {
        type: 'button',
        class: 'tag-remove',
        attrs: { 'aria-label': `${name}を外す` },
        text: '×',
        on: { click: () => save(pantry.filter((item) => item !== name), `「${name}」を外しました`) },
      })))),
    el('form', { class: 'inline-form', on: { submit: add } },
      input,
      el('button', { class: 'button', type: 'submit', text: '追加' })));
}
