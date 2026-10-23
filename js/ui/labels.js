// 画面に出す日本語の呼び名。表記を画面ごとにばらつかせないため、ここに集める。

export const MEAL_LABEL = { breakfast: '朝', lunch: '昼', dinner: '夕' };

export const PART_LABEL = {
  dish: '一品',
  protein: 'たんぱく質',
  carb: '炭水化物',
  dressing: 'ドレッシング',
};

export const KIND_LABEL = {
  dish: '一品（朝食・昼食）',
  protein: 'たんぱく質（サラダに載せる）',
  rice_side: 'ご飯のおかず',
  noodle: '具入りの麺',
  dressing: 'ドレッシング・トッピング',
};

export const PROTEIN_LABEL = {
  chicken: '鶏',
  pork: '豚',
  beef: '牛',
  fish: '魚',
  egg: '卵',
  soy: '大豆',
  none: 'なし',
};

export const METHOD_LABEL = {
  sous_vide: '低温調理',
  pot: '鍋',
  microwave: '電子レンジ',
  rice_cooker: '炊飯器',
  sear: '焼き目だけ',
  none: '加熱なし',
};

export const SOURCE_LABEL = {
  dlab: 'Dラボ',
  arrange: 'Dラボ応用',
  external: '外部サイト',
  mine: '自分のレシピ',
};

// 夕食の毎日の前提。枠にはしないが、献立画面に常に出す。
export const DINNER_BASE = 'キャベツ半玉のサラダ ＋ 炭水化物 270g';
