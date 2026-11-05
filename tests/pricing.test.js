// node tests/pricing.test.js
const assert = require("assert")
const { calcPrice, centsToYuan, renderItemText } = require("../pb_hooks/lib/pricing.js")
const { renderMeasureText } = require("../pb_hooks/lib/measure_text.js")

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log("  ok  " + name)
}

console.log("计价引擎")

check("formula：罗万袖 445 元", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [
      { name: "基础价", category: "base", unitCents: 30000, qty: 1 },
      { name: "打板费", category: "main", unitCents: 3000, qty: 1 },
      { name: "手套", category: "main", unitCents: 2000, qty: 1 },
      { name: "五指袜", category: "main", unitCents: 4500, qty: 1 },
      { name: "头套", category: "main", unitCents: 5000, qty: 1 },
    ],
    adjustCents: 0,
  })
  assert.strictEqual(r.baseCents, 30000)
  assert.strictEqual(r.itemsCents, 14500)
  assert.strictEqual(r.totalCents, 44500)
  assert.strictEqual(centsToYuan(r.totalCents), "445")
})

check("0 元项目必须保留在明细里", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [
      { name: "基础价", category: "base", unitCents: 30000, qty: 1 },
      { name: "打板费", category: "main", unitCents: 0, qty: 1 },
      { name: "裆部隐藏假阴", category: "extra", unitCents: 0, qty: 1 },
    ],
    adjustCents: 0,
  })
  assert.strictEqual(r.detail.length, 3)
  assert.strictEqual(r.detail[1].amount_cents, 0)
  assert.strictEqual(r.totalCents, 30000)
})

check("数量倍数：隐藏式拉链×2", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [
      { name: "基础价", category: "base", unitCents: 30000, qty: 1 },
      { name: "隐藏式拉链", category: "main", unitCents: 3000, qty: 2 },
    ],
    adjustCents: 0,
  })
  assert.strictEqual(r.detail[1].amount_cents, 6000)
  assert.strictEqual(r.totalCents, 36000)
})

check("固定价覆盖累加：王可可 650", () => {
  const r = calcPrice({
    priceMode: "fixed",
    fixedCents: 65000,
    lines: [{ name: "基础价", category: "base", unitCents: 30000, qty: 1 }],
    adjustCents: 0,
  })
  assert.strictEqual(r.totalCents, 65000)
  // 明细仍保留，供对账
  assert.strictEqual(r.detail.length, 1)
})

check("临时加价在固定价上叠加", () => {
  const r = calcPrice({
    priceMode: "fixed",
    fixedCents: 65000,
    lines: [],
    adjustCents: 5000,
  })
  assert.strictEqual(r.totalCents, 70000)
})

check("负数加价（减价）也支持", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [{ name: "基础价", category: "base", unitCents: 30000, qty: 1 }],
    adjustCents: -2000,
  })
  assert.strictEqual(r.totalCents, 28000)
})

check("勾选型：忽略传入数量，固定按 1 份计价", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [
      { name: "基础价", category: "base", unitCents: 30000, qty: 1, qtyMode: "check" },
      { name: "五指袜", category: "main", unitCents: 4500, qty: 3, qtyMode: "check" },
    ],
    adjustCents: 0,
  })
  assert.strictEqual(r.detail[1].qty, 1)
  assert.strictEqual(r.detail[1].amount_cents, 4500)
  assert.strictEqual(r.detail[1].label, "五指袜")
  assert.strictEqual(r.detail[1].unit, "")
  assert.strictEqual(r.totalCents, 34500)
})

check("数量型：单价 × 数量，明细带单位与导出文本", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [
      { name: "基础价", category: "base", unitCents: 30000, qty: 1, qtyMode: "check" },
      { name: "手套", category: "main", unitCents: 2000, qty: 2, unit: "对", qtyMode: "qty" },
    ],
    adjustCents: 0,
  })
  assert.strictEqual(r.detail[1].qty, 2)
  assert.strictEqual(r.detail[1].unit, "对")
  assert.strictEqual(r.detail[1].label, "手套 2对")
  assert.strictEqual(r.detail[1].amount_cents, 4000)
  assert.strictEqual(r.totalCents, 34000)
})

check("数量型：数量最小 1，0 与负数都按 1 处理", () => {
  const r = calcPrice({
    priceMode: "formula",
    lines: [
      { name: "手套", category: "main", unitCents: 2000, qty: 0, unit: "对", qtyMode: "qty" },
      { name: "五指袜", category: "main", unitCents: 4500, qty: -5, unit: "双", qtyMode: "qty" },
    ],
    adjustCents: 0,
  })
  assert.strictEqual(r.detail[0].qty, 1)
  assert.strictEqual(r.detail[0].label, "手套 1对")
  assert.strictEqual(r.detail[1].qty, 1)
  assert.strictEqual(r.totalCents, 6500)
})

check("导出文本：勾选型只有项目名，数量型拼数量与单位", () => {
  assert.strictEqual(renderItemText("五指袜", 1, "", "check"), "五指袜")
  assert.strictEqual(renderItemText("手套", 2, "对", "qty"), "手套 2对")
  assert.strictEqual(renderItemText("手套", 2, "", "qty"), "手套 ×2")
})

check("金额格式化", () => {
  assert.strictEqual(centsToYuan(44500), "445")
  assert.strictEqual(centsToYuan(44550), "445.5")
  assert.strictEqual(centsToYuan(0), "0")
  assert.strictEqual(centsToYuan(-2000), "-20")
})

console.log("量体文本渲染")

const fields = [
  { key: "height", label: "身高", unit: "cm", type: "number", decimals: 0, sort: 1, in_export: true, group_id: "", group_name: "" },
  { key: "weight", label: "体重", unit: "kg", type: "number", decimals: 0, sort: 2, in_export: true, group_id: "", group_name: "" },
  { key: "gender", label: "性别", unit: "", type: "select", decimals: 0, sort: 3, in_export: true, group_id: "", group_name: "" },
  { key: "finger_middle", label: "中指", unit: "cm", type: "number", decimals: 0, sort: 4, in_export: true, wrap_parens: true, group_id: "g1", group_name: "手指长" },
  { key: "finger_thumb", label: "大拇指", unit: "cm", type: "number", decimals: 0, sort: 5, in_export: true, wrap_parens: true, group_id: "g1", group_name: "手指长" },
  { key: "finger_little", label: "小拇指", unit: "cm", type: "number", decimals: 0, sort: 6, in_export: true, wrap_parens: true, group_id: "g1", group_name: "手指长" },
  { key: "wrist", label: "手腕围", unit: "cm", type: "number", decimals: 1, sort: 7, in_export: true, group_id: "", group_name: "" },
  { key: "chest", label: "胸围", unit: "cm", type: "number", decimals: 0, sort: 8, in_export: true, group_id: "", group_name: "" },
  { key: "secret_note", label: "内部备注", unit: "", type: "text", decimals: 0, sort: 9, in_export: false, group_id: "", group_name: "" },
]

const data = {
  height: 164,
  weight: 70,
  gender: "男",
  finger_middle: 9,
  finger_thumb: 6,
  finger_little: 7,
  wrist: 18,
  chest: 98,
  secret_note: "不要导出",
}

check("按顺序拼接 + 括号合并 + 跳过空值与非导出字段", () => {
  const text = renderMeasureText(fields, data)
  assert.strictEqual(
    text,
    "身高: 164cm，体重: 70kg，性别: 男，手指长（中指: 9cm, 大拇指: 6cm, 小拇指: 7cm），手腕围: 18cm，胸围: 98cm"
  )
  assert.ok(text.indexOf("内部备注") === -1, "in_export=false 的字段不应出现")
})

check("缺失字段自动跳过", () => {
  const text = renderMeasureText(fields, { height: 164, chest: 98 })
  assert.strictEqual(text, "身高: 164cm，胸围: 98cm")
})

check("小数位渲染 18.0 -> 18", () => {
  const text = renderMeasureText(fields, { wrist: 18.0 })
  assert.strictEqual(text, "手腕围: 18cm")
})

console.log("\n" + passed + " 个用例全部通过")
