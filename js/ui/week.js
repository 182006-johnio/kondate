// 献立画面（ホーム）。1 週間分を日ごとのカードで並べる。

import { FOODS } from '../../data/foods.js';
import { addDays, formatDayLabel, startOfWeek, todayISO, weekDates, weekdayOf } from '../dates.js';
import { dayNutrition } from '../nutrition.js';
import { planWeek } from '../planner.js';
import { MEALS, PARTS, slotKey } from '../schema.js';
import * as storage from '../storage.js';
import { append, clear, el } from './dom.js';
import { DINNER_BASE, MEAL_LABEL, PART_LABEL } from './labels.js';
import { daySummary, openDaySheet } from './nutrition-view.js';

const FISH_DAY = 4; // 木曜。planner.js と同じ決まり

export async function renderWeek(container, ctx, requested) {
  const today = todayISO();
  const weekStart = startOfWeek(requested ?? today);
  const days = weekDates(weekStart);
  const thisWeek = startOfWeek(today);

  // 前週の日曜と翌週の月曜も読む。作り直しと引き直しで隣の日と比べるため。
  const [recipes, nearby, settings, details] = await Promise.all([
    ctx.recipes(),
    storage.getSlots(addDays(weekStart, -1), addDays(weekStart, 7)),
    storage.getSettings(),
    storage.getDetails(),
  ]);
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const inWeek = nearby.filter((slot) => slot.date >= days[0] && slot.date <= days[6]);
  const slots = new Map(inWeek.map((slot) => [slotKey(slot.date, slot.meal, slot.part), slot]));

  async function generate() {
    const hasUnlocked = inWeek.some((slot) => !slot.locked);
    if (hasUnlocked && !confirm('固定していない枠をすべて引き直します。よろしいですか？')) return;
    const planned = planWeek({
      weekStart,
      recipes,
      slots: nearby,
      breakfastRecipeId: settings.breakfast_recipe_id,
      random: Math.random,
      pantry: settings.pantry,
    });
    await storage.putSlots(planned);
    ctx.toast(hasUnlocked ? '固定以外を作り直しました' : '献立を作りました');
    await ctx.refresh();
  }

  clear(container);
  append(container, [
    el('header', { class: 'week-header' },
      el('a', { class: 'icon-button', href: `#/week/${addDays(weekStart, -7)}`, attrs: { 'aria-label': '前の週' }, text: '‹' }),
      el('div', { class: 'week-title' },
        el('h1', { text: `${formatDayLabel(days[0])} 〜 ${formatDayLabel(days[6])}` }),
        weekStart === thisWeek
          ? el('span', { class: 'chip', text: '今週' })
          : el('a', { class: 'link', href: '#/week', text: '今週へ' })),
      el('a', { class: 'icon-button', href: `#/week/${addDays(weekStart, 7)}`, attrs: { 'aria-label': '次の週' }, text: '›' })),

    settings.breakfast_recipe_id === null
      ? el('p', { class: 'notice' },
        '朝食が未設定です。',
        el('a', { href: '#/settings', text: '設定で朝食を選ぶ' }))
      : null,

    el('button', {
      class: inWeek.length === 0 ? 'button primary wide' : 'button wide',
      text: inWeek.length === 0 ? 'この週の献立を作る' : '固定以外を作り直す',
      on: { click: () => generate().catch((error) => ctx.toast(error.message)) },
    }),

    el('ol', { class: 'days' }, days.map((date) => dayCard({
      date, today, slots, byId, ctx, nearby, inWeek, details, goals: settings.goals,
    }))),
  ]);
}

function dayCard({ date, today, slots, byId, ctx, nearby, inWeek, details, goals }) {
  const day = dayNutrition({ slots: inWeek.filter((slot) => slot.date === date), byId, details, foods: FOODS });
  const rows = [];
  for (const meal of MEALS) {
    if (meal === 'dinner') rows.push(el('li', { class: 'base', text: `夕 ${DINNER_BASE}` }));
    for (const part of PARTS[meal]) {
      const slot = slots.get(slotKey(date, meal, part)) ?? null;
      rows.push(el('li', {}, slotRow({ date, meal, part, slot, recipe: slot ? byId.get(slot.recipe_id) : null, ctx, nearby })));
    }
  }

  return el('li', { class: date === today ? 'day today' : 'day' },
    el('h2', { class: 'day-title' },
      formatDayLabel(date),
      date === today ? el('span', { class: 'chip strong', text: '今日' }) : null,
      weekdayOf(date) === FISH_DAY ? el('span', { class: 'chip fish', text: '魚の日' }) : null),
    el('ul', { class: 'slots' }, rows),
    el('button', {
      class: 'day-nutrition',
      text: daySummary(day),
      on: { click: () => openDaySheet(ctx.sheet, date, day, goals) },
    }));
}

function slotRow({ date, meal, part, slot, recipe, ctx, nearby }) {
  const label = meal === 'dinner' ? PART_LABEL[part] : MEAL_LABEL[meal];
  let name = '未提案';
  if (slot) name = recipe ? recipe.name : '見つからないレシピ';

  return el('button', {
    class: slot ? 'slot' : 'slot empty',
    dataset: { date, meal, part },
    on: { click: () => ctx.openSlot({ date, meal, part, slot, recipe, nearby }) },
  },
  el('span', { class: meal === 'dinner' ? 'slot-label sub' : 'slot-label', text: label }),
  el('span', { class: 'slot-name', text: name }),
  slot?.locked ? el('span', { class: 'lock', attrs: { 'aria-label': '固定' }, text: '🔒' }) : null);
}
