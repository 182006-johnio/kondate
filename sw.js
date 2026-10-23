// Service Worker。オフラインでも起動できるようにする。
//
// アプリのファイル一式を 1 つの版としてまとめて保存し、取り出すときもその版から
// 揃って返す。1 ファイルごとに新旧を判断すると、電波が不安定なときに新しい版と
// 古い版が混ざり、モジュールの import が食い違ってアプリが起動しなくなる
// （習慣化トラッカーで実際に起きた）。
//
// 新しい版は次にアプリを開いたときに切り替わる。更新が 1 回遅れる代わりに、
// 半端に新しい状態にはならない。
//
// ファイルを変えたら CACHE の名前を変える。ファイルを足したら PRECACHE にも足す。

const CACHE = 'kondate-v1';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './data/foods.js',
  './data/pantry.js',
  './data/recipes.js',
  './js/app.js',
  './js/dates.js',
  './js/export.js',
  './js/nutrition.js',
  './js/planner.js',
  './js/schema.js',
  './js/shopping-list.js',
  './js/storage.js',
  './js/ui/dom.js',
  './js/ui/labels.js',
  './js/ui/nutrition-view.js',
  './js/ui/pantry-editor.js',
  './js/ui/recipe-detail.js',
  './js/ui/recipe-form.js',
  './js/ui/recipe-list.js',
  './js/ui/settings.js',
  './js/ui/shopping.js',
  './js/ui/slot-sheet.js',
  './js/ui/week.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// パス → 保存したときの URL。クエリが付いていても同じファイルとして拾うため、
// 照合はクエリを含まない pathname で行う。
const PRECACHED = new Map(PRECACHE.map((path) => {
  const href = new URL(path, self.location.href).href;
  return [new URL(href).pathname, href];
}));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' を付けないと、ブラウザの HTTP キャッシュにある古いファイルで
      // 新しい版を作ってしまい、版をまとめる意味が無くなる。
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const href = PRECACHED.get(url.pathname);
  // precache に無いもの（tests.html など）は素通しにしてネットワークへ。
  if (href) event.respondWith(fromCache(href, request));
});

async function fromCache(href, request) {
  const cache = await caches.open(CACHE);
  const response = await cache.match(href);
  // 版が揃っていれば必ず入っている。欠けていたときだけネットワークに頼る。
  return response ?? fetch(request);
}
