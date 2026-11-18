// 定制参数的裁剪：纯函数，不碰 $app，方便 node 直接跑测试。
//
// 要量哪些尺寸是品类定好的（catalogs.fields = [{ key, required, sort }]），
// 订单只属于一个品类，所以这里只剩一件事：按订单品类的绑定裁剪字段定义。
// 尺码档案是全品类共用的一份，床垫单绝不能把档案里三个月前的胸围印到生产单上。

// bindings 不是数组时返回全部（给没有品类信息的老订单兜底）
function pickFields(defs, bindings) {
  if (!Array.isArray(bindings)) return defs || []
  const want = {}
  const sortMap = {}
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i] || {}
    const key = String(b.key || "")
    if (!key) continue
    want[key] = true
    sortMap[key] = Number(b.sort) || 0
  }
  const out = []
  for (let i = 0; i < (defs || []).length; i++) {
    const f = defs[i]
    if (!want[f.key]) continue
    out.push({
      key: f.key,
      label: f.label,
      unit: f.unit,
      type: f.type,
      decimals: f.decimals,
      // 排序以品类上的绑定为准：同一个字段在袜子单和衣服单里可以不同先后
      sort: sortMap[f.key] || f.sort,
      in_export: f.in_export,
      wrap_parens: f.wrap_parens,
      is_active: f.is_active,
      group_id: f.group_id,
      group_name: f.group_name,
    })
  }
  return out
}

module.exports = { pickFields: pickFields }
