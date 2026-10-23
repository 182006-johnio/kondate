// 起動と画面の切り替え。
//
// 画面は URL の # で決める（#/week/2026-10-19、#/recipe/dlab-001 など）。
// iPhone のスワイプで戻る操作やブラウザの戻るボタンがそのまま効くようにするため。

import { RECIPES } from '../data/recipes.js';
import * as storage from './storage.js';
import { clear, el } from './ui/dom.js';
import { renderRecipe } from './ui/recipe-detail.js';
import { renderRecipeForm } from './ui/recipe-form.js';
import { renderRecipeList } from './ui/recipe-list.js';
import { renderSettings } from './ui/settings.js';
import { renderShopping } from './ui/shopping.js';
import { openSlotSheet } from './ui/slot-sheet.js';
import { renderWeek } from './ui/week.js';

const view = document.getElementById('view');
const toastNode = document.getElementById('toast');
let toastTimer = 0;

// 画面に渡す道具。画面どうしはこれを介してだけやりとりする。
const ctx = {
  // 同梱レシピ集と自分のレシピを合わせた全レシピ。
  async recipes() {
    return [...RECIPES, ...(await storage.getMyRecipes())];
  },
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  refresh() {
    return render();
  },
  toast(message) {
    toastNode.textContent = message;
    toastNode.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastNode.hidden = true; }, 2500);
  },
  sheet: document.getElementById('sheet'),
  openSlot(info) {
    openSlotSheet(ctx, info);
  },
};

// [正規表現, 描画関数, タブ名]。上から順に最初に合ったものを使う。
const ROUTES = [
  [/^#\/week(?:\/(\d{4}-\d{2}-\d{2}))?$/, (match) => renderWeek(view, ctx, match[1]), 'week'],
  [/^#\/recipes(?:\/(\w+))?$/, (match) => renderRecipeList(view, ctx, match[1]), 'recipes'],
  [/^#\/recipe\/(.+)$/, (match) => renderRecipe(view, ctx, decodeURIComponent(match[1])), 'recipes'],
  [/^#\/recipe-new(?:\?(.*))?$/, (match) => renderRecipeForm(view, ctx, { query: match[1] ?? '' }), 'recipes'],
  [/^#\/recipe-edit\/(.+)$/, (match) => renderRecipeForm(view, ctx, { id: decodeURIComponent(match[1]) }), 'recipes'],
  [/^#\/shopping(?:\/(\d{4}-\d{2}-\d{2}))?$/, (match) => renderShopping(view, ctx, match[1]), 'shopping'],
  [/^#\/settings$/, () => renderSettings(view, ctx), 'settings'],
];

// moved は画面を移ったとき true。同じ画面の描き直し（枠を変えたあとなど）では
// スクロール位置を保つ。
async function render(moved = false) {
  const hash = location.hash || '#/week';
  for (const [pattern, draw, tab] of ROUTES) {
    const match = hash.match(pattern);
    if (!match) continue;
    markTab(tab);
    try {
      await draw(match);
      if (moved) window.scrollTo(0, 0);
    } catch (error) {
      showError(error);
    }
    return;
  }
  location.replace('#/week');
}

function markTab(tab) {
  for (const link of document.querySelectorAll('.tab')) {
    link.classList.toggle('active', link.dataset.tab === tab);
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function showError(error) {
  console.error(error);
  clear(view);
  view.append(el('section', { class: 'error' },
    el('h1', { text: 'うまく表示できませんでした' }),
    el('p', { class: 'pre', text: error?.message ?? String(error) })));
}

async function start() {
  // index.html の起動の見張りに、モジュールが動き始めたことを知らせる。
  document.documentElement.dataset.started = '1';
  try {
    await storage.init();
  } catch (error) {
    showError(error);
    return;
  }
  window.addEventListener('hashchange', () => render(true));
  await render();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('Service Worker を登録できませんでした:', error);
  });
}

start();
registerServiceWorker();
