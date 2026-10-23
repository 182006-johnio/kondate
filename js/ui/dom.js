// DOM を組み立てる小さな補助。
//
// 文字列は必ず textContent / テキストノードとして入れる。innerHTML は使わない
// （ユーザー入力のレシピ名や手順をそのまま描画するため）。

// el('button', { class: 'primary', on: { click } }, '保存')
// props: class / text / attrs（属性）/ on（イベント）/ dataset / それ以外はプロパティとして代入
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'attrs') for (const [name, attr] of Object.entries(value)) node.setAttribute(name, attr);
    else if (key === 'on') for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node[key] = value;
  }
  append(node, children);
  return node;
}

// 子を足す。null / undefined / false は飛ばす（Node#append はそれらを文字列にしてしまう）。
export function append(node, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  node.replaceChildren();
}
