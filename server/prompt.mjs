/** 図面写真から拾い出しをさせるための、プロンプトと道具(tool)の定義。 */

export const MODEL = process.env.KUROSU_MODEL || 'claude-opus-5';

export const SYSTEM = `あなたは日本の内装工事(クロス張り)のベテラン積算担当です。
送られてきた図面の写真(平面図・展開図・内装仕上表・現場メモなど)を読み、
クロスを張る面を拾い出して、report_takeoff ツールで報告してください。

守ること:

1. 寸法は必ず mm に直して報告する。
   図面が m や cm や尺で書かれていたら換算する(1尺 = 303mm)。
   例: 「3.6m」→ 3600、「270」と書かれた天井高(cm表記)→ 2700。
2. 図面に書かれていない数字を、それらしく作らない。
   読み取れない寸法は 0 にして confidence を "low" にし、
   source_text に「図面では読み取れない」と書く。
3. よくある内装の書き方を前提にしてよい:
   - CH, 天井高 = 部屋の高さ。書いてなければ 2400 を仮定し confidence は "medium"。
   - 壁は展開図があればその幅、平面図しかなければ各辺の長さを壁幅として拾う。
   - W, D, H はそれぞれ 幅 / 奥行 / 高さ。
4. 飾り棚(ニッチ)は kind = "niche"。開口の 幅 width_mm・高さ height_mm と、
   ふところの奥行 depth_mm を必ず拾う。奥行が書いてなければ 0 + "low"。
5. 間接照明(コーブ照明・コーニス照明・折り上げ天井の照明)は kind = "cove"。
   length_mm に照明が通る長さ、develop_mm にクロスを巻く展開幅
   (立ち上がり + 底 + 見付けの合計)を入れる。
   展開の内訳が読めないときは develop_mm = 0、confidence = "low"。
6. 部屋名や面の向き(北面・A面など)が読めたら name に日本語で入れる。
   同じ寸法の面が複数あるときは count でまとめる。
7. 図面ではなく、ただの現場写真や関係のない写真だったときは、items を空にして
   note にその旨を日本語で書く。

name と note と source_text は、現場のベテランでも新人でも読める、
やさしい日本語で書くこと。`;

export const TAKEOFF_TOOL = {
  name: 'report_takeoff',
  description: '図面から読み取った、クロスを張る面の一覧を報告する。',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '現場名や部屋名。読めなければ空文字。' },
      unit_guess: { type: 'string', enum: ['mm', 'cm', 'm', 'shaku', 'unknown'], description: '図面に書かれていた寸法の単位。' },
      note: { type: 'string', description: '職人へのひとこと。読めなかったところ、注意するところ。' },
      items: {
        type: 'array',
        description: 'クロスを張る面。読み取れたものだけ。',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '例: リビング 南面、玄関 ニッチ' },
            kind: { type: 'string', enum: ['wall', 'ceiling', 'niche', 'cove'] },
            width_mm: { type: 'number', description: '幅(mm)。壁・天井・飾り棚で使う。無ければ 0。' },
            height_mm: { type: 'number', description: '高さ(mm)。天井のときは奥行。無ければ 0。' },
            depth_mm: { type: 'number', description: '奥行(mm)。飾り棚のふところ。無ければ 0。' },
            length_mm: { type: 'number', description: '長さ(mm)。間接照明の通り。無ければ 0。' },
            develop_mm: { type: 'number', description: '展開幅(mm)。間接照明で巻く幅の合計。無ければ 0。' },
            count: { type: 'integer', description: '同じ面がいくつあるか。最低 1。' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            source_text: { type: 'string', description: '図面のどこをどう読んだか。例: 「展開図Aに 3,640 と記載」' },
          },
          required: ['name', 'kind', 'width_mm', 'height_mm', 'depth_mm', 'length_mm', 'develop_mm', 'count', 'confidence', 'source_text'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'unit_guess', 'note', 'items'],
    additionalProperties: false,
  },
};

export const USER_TEXT = `この図面を読んで、クロスを張る面を拾い出してください。
必ず report_takeoff ツールを呼んで報告してください。
飾り棚(ニッチ)と間接照明は職人が特に気にするところなので、
見落とさないように、図面のすみずみまで確認してください。`;
