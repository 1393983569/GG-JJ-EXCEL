// 计价引擎：纯函数，无 PocketBase 依赖，可单独测试
// 金额一律为整数（分），避免浮点误差
//
// 项目有两种形态：
//   qtyMode = "check" 勾选型：选中即 1 份，数量固定 1
//   qtyMode = "qty"   数量型：数量 × 单价，数量最小 1
// 不传 qtyMode 时按数量型处理（兼容旧数据）。

function toInt(v) {
  const n = Number(v)
  if (!isFinite(n)) return 0
  return Math.round(n)
}

function toQtyMode(v) {
  return String(v || "").toLowerCase() === "check" ? "check" : "qty"
}

function toQty(mode, v) {
  if (mode === "check") return 1
  const n = Math.floor(Number(v) || 1)
  if (!isFinite(n) || n < 1) return 1
  return n
}

/**
 * 导出 / 展示用的项目文本
 * 勾选型：五指袜
 * 数量型：手套 2对（没有单位时退化成 “手套 ×2”）
 * 带规格：手套（连体）2对
 */
function renderItemText(name, qty, unit, qtyMode, spec) {
  const s = String(spec || "")
  const text = String(name || "") + (s ? "（" + s + "）" : "")
  const mode = toQtyMode(qtyMode)
  if (mode === "check") return text
  const n = toQty(mode, qty)
  const u = String(unit || "")
  return u ? text + " " + n + u : text + " ×" + n
}

/**
 * @param {Object} input
 * @param {"formula"|"fixed"} input.priceMode
 * @param {number} input.fixedCents      priceMode=fixed 时生效
 * @param {Array}  input.lines           [{ itemId, name, category, unitCents, qty, unit, qtyMode }]
 * @param {number} input.adjustCents     人工临时加价
 * @returns {{baseCents,itemsCents,adjustCents,totalCents,detail:Array}}
 */
function calcPrice(input) {
  const mode = input.priceMode === "fixed" ? "fixed" : "formula"
  const adjustCents = toInt(input.adjustCents)
  const lines = input.lines || []

  const detail = []
  let baseCents = 0
  let itemsCents = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const qtyMode = toQtyMode(line.qtyMode || line.qty_mode)
    const qty = toQty(qtyMode, line.qty)
    const unit = qtyMode === "qty" ? String(line.unit || "") : ""
    const unitCents = toInt(line.unitCents)
    const amountCents = unitCents * qty

    // 单价为 0 的项目同样保留在明细里，客户选择了就要能看到
    // 注意：所有字段必须强制转成 JS 原始类型。
    // goja 里从 Go 结构取到的值是包装对象，直接塞进 detail 会让
    // JSON.stringify 的结果膨胀几十倍（实测 373 字节 -> 25316 字节），
    // 进而触发 PocketBase JSON 字段的 maxSize 校验。
    detail.push({
      item_id: String(line.itemId || ""),
      name: String(line.name || ""),
      category: String(line.category || "main"),
      unit_cents: Number(unitCents) || 0,
      qty: Number(qty) || 1,
      unit: unit,
      qty_mode: qtyMode,
      spec: String(line.spec || ""),
      // 导出文本：勾选型只有项目名，数量型拼数量与单位，选了规格就带上
      label: renderItemText(line.name, qty, unit, qtyMode, line.spec),
      amount_cents: Number(amountCents) || 0,
    })

    if (line.category === "base") baseCents += amountCents
    else itemsCents += amountCents
  }

  let totalCents
  if (mode === "fixed") {
    // 固定价覆盖「基础价 + 项目累加」，人工加价仍然叠加
    totalCents = toInt(input.fixedCents) + adjustCents
  } else {
    totalCents = baseCents + itemsCents + adjustCents
  }

  return {
    baseCents: baseCents,
    itemsCents: itemsCents,
    adjustCents: adjustCents,
    totalCents: totalCents,
    detail: detail,
  }
}

/**
 * 把任意数量级的分转换成展示用的元，仅用于导出/日志
 */
function centsToYuan(cents) {
  const n = toInt(cents)
  const sign = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  const yuan = Math.floor(abs / 100)
  let fen = String(abs % 100)
  if (fen.length < 2) fen = "0" + fen
  fen = fen.replace(/0+$/, "")
  if (!fen) return sign + yuan
  return sign + yuan + "." + fen
}

module.exports = {
  calcPrice: calcPrice,
  centsToYuan: centsToYuan,
  renderItemText: renderItemText,
  toInt: toInt,
}
