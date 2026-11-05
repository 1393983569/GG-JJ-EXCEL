// 量体文本渲染：驱动 Word 导出，模板里只需要一个 {measure_text} 占位符
// 输出形如：身高: 164cm，体重: 70kg，性别: 男，手指长（中指: 9cm, 大拇指: 6cm）

function formatValue(field, value) {
  if (value === null || value === undefined || value === "") return ""
  let text = String(value)
  if (field.type === "number") {
    const n = Number(value)
    if (!isFinite(n)) return ""
    const decimals = toIntSafe(field.decimals)
    text = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n))
    // 去掉多余的 0：164.0 -> 164
    if (decimals > 0 && text.indexOf(".") >= 0) {
      text = text.replace(/0+$/, "").replace(/\.$/, "")
    }
  }
  const unit = field.unit ? String(field.unit) : ""
  return unit ? text + unit : text
}

function toIntSafe(v) {
  const n = Number(v)
  return isFinite(n) ? Math.floor(n) : 0
}

function hasValue(data, key) {
  if (!data) return false
  const v = data[key]
  return v !== null && v !== undefined && String(v).trim() !== ""
}

/**
 * @param {Array} fields 字段定义，需包含：
 *   { key, label, unit, type, decimals, sort, in_export, wrap_parens, group_id, group_name }
 * @param {Object} data  { fieldKey: value }
 * @returns {string} 供 Word 模板直接使用的中文段落
 */
function renderMeasureText(fields, data) {
  const list = []
  for (let i = 0; i < (fields || []).length; i++) {
    const f = fields[i]
    if (!f) continue
    if (f.in_export === false) continue
    if (f.is_active === false) continue
    if (!hasValue(data, f.key)) continue
    list.push(f)
  }

  list.sort(function (a, b) {
    return (Number(a.sort) || 0) - (Number(b.sort) || 0)
  })

  const parts = []
  let i = 0
  while (i < list.length) {
    const f = list[i]
    const groupId = f.group_id || ""
    if (f.wrap_parens && groupId) {
      const bucket = [f]
      let j = i + 1
      while (
        j < list.length &&
        list[j].wrap_parens &&
        (list[j].group_id || "") === groupId
      ) {
        bucket.push(list[j])
        j++
      }
      const inner = []
      for (let k = 0; k < bucket.length; k++) {
        const item = bucket[k]
        inner.push(item.label + ": " + formatValue(item, data[item.key]))
      }
      const groupName = f.group_name || f.label
      parts.push(groupName + "（" + inner.join(", ") + "）")
      i = j
    } else {
      parts.push(f.label + ": " + formatValue(f, data[f.key]))
      i++
    }
  }

  return parts.join("，")
}

module.exports = { renderMeasureText: renderMeasureText, formatValue: formatValue }
