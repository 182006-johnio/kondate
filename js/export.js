// エクスポート（バックアップ）。保存データを単一の JSON として書き出す。
//
// ローカル保存のみの構成なので、ブラウザのデータが消えると自分のレシピと献立が失われる。
// その復旧手段。保存先は OS 側でユーザーが選ぶ。クラウドサービスは一切知らない。
// 同梱レシピ集はアプリに含まれているので書き出さない。
//
// 副作用のある部分（共有シート・ダウンロード）と、そうでない部分（ファイル名の組み立て・
// JSON 化・経路の選択）を分けてある。共有シートの検証は PWA 化のあとになるので、
// それまでの間もテストできる範囲を広く取るため。

import { snapshot } from './storage.js';
import { todayISO } from './dates.js';

const MIME_TYPE = 'application/json';

export function backupFilename(today = todayISO()) {
  return `kondate-${today}.json`;
}

// storage.snapshot() の結果をそのまま書き出す。書き出し日時などのメタ情報は足さない。
// 将来インポートを作るとき、validateDB() がそのまま使える形にしておくため。
export function serializeBackup(data) {
  return JSON.stringify(data, null, 2);
}

// 共有シートが使えるか。navigator を引数で受け取るのは、テストで偽物を渡せるようにするため。
export function canUseShare(nav, file) {
  if (typeof nav?.share !== 'function' || typeof nav?.canShare !== 'function') return false;
  try {
    return !!nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// 実際に書き出す。UI 側はクリックハンドラから直接呼ぶこと。
//
// navigator.share() はユーザー操作の直後にしか呼べない。タイマーや通信を挟んでから呼ぶと
// WebKit に拒否される。storage.snapshot() は実体がメモリ上のコピーでマイクロタスクで
// 解決するため、この await を挟んでも操作起点は失われない。
//
// data を渡すと storage を読まない。動作確認用にサンプルを流し込むためのもの。
// nav と download はテストで差し替えるためのもので、通常は省略する。
export async function exportBackup({
  today = todayISO(),
  nav = navigator,
  data = null,
  download = downloadFile,
} = {}) {
  const payload = data ?? (await snapshot());
  const filename = backupFilename(today);
  const file = new File([serializeBackup(payload)], filename, { type: MIME_TYPE });

  if (canUseShare(nav, file)) {
    try {
      await nav.share({ files: [file] });
      return { method: 'share', filename, cancelled: false };
    } catch (error) {
      // 共有シートを閉じただけなら失敗ではない。
      if (error?.name === 'AbortError') {
        return { method: 'share', filename, cancelled: true };
      }
      // ここで <a download> に切り替えない。iOS の PWA ではその経路こそが壊れていて、
      // プレビューが開いたままアプリに戻れなくなる。原因が分かるよう投げ直す。
      throw error;
    }
  }

  download(file, filename);
  return { method: 'download', filename, cancelled: false };
}

function downloadFile(file, filename) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 解放しないとページを開いているあいだメモリに残り続ける。
  // click() の処理が終わってから解放する。
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
