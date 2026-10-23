// 日付ユーティリティ。
//
// 日付の正準表現は 'YYYY-MM-DD' のローカル日付文字列で、Date はこのモジュールの中の
// 計算にだけ使う。この形式は辞書順が日付順と一致するので、比較とソートは文字列のまま行える。

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

// Date を 'YYYY-MM-DD' にする。
// toISOString() は UTC を返すので使わない。JST の朝 9 時より前に呼ぶと前日の日付になる。
function toISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 'YYYY-MM-DD' をローカル正午の Date にする。
// 0 時ではなく正午を起点にするのは、夏時間のある地域で加減算が 1 日ずれないようにするため。
function fromISO(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setFullYear(year); // 0〜99 年が 1900 年代に丸められるのを防ぐ
  return date;
}

function requireISO(iso) {
  if (!isValidISO(iso)) {
    throw new TypeError(`日付が 'YYYY-MM-DD' 形式の実在する日付ではありません: ${String(iso)}`);
  }
  return iso;
}

// 端末のローカルタイムでの今日。
export function todayISO() {
  return toISO(new Date());
}

export function isValidISO(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = fromISO(value);
  // 2026-02-30 のような日付は Date が翌月へ繰り上げるので、往復させて一致を見る。
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function addDays(iso, days) {
  if (!Number.isInteger(days)) {
    throw new TypeError(`日数には整数を渡してください: ${String(days)}`);
  }
  const date = fromISO(requireISO(iso));
  date.setDate(date.getDate() + days);
  return toISO(date);
}

// その日が属する週の月曜を返す。週は月曜始まり・日曜終わり。
export function startOfWeek(iso) {
  const date = fromISO(requireISO(iso));
  const offset = (date.getDay() + 6) % 7; // 月曜からの経過日数（日曜は 6）
  return addDays(iso, -offset);
}

// 曜日。Date#getDay と同じく 0 = 日曜 … 6 = 土曜。
export function weekdayOf(iso) {
  return fromISO(requireISO(iso)).getDay();
}

// その日が属する週の月曜〜日曜の 7 日分。
export function weekDates(iso) {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

// --- 表示用の整形 -----------------------------------------------------
// 日付の見せ方はここに集める。同じ表記が画面ごとにばらつかないようにするため。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 例: 10/23 (金)
export function formatDayLabel(iso) {
  const date = fromISO(requireISO(iso));
  return `${date.getMonth() + 1}/${date.getDate()} (${WEEKDAYS[date.getDay()]})`;
}

// 例: 10月23日
export function formatMonthDay(iso) {
  const [, month, day] = requireISO(iso).split('-').map(Number);
  return `${month}月${day}日`;
}
