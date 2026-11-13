// 客户备注是富文本 HTML（多行文字 / 加粗 / 字号 / 颜色 / 图片），
// 后台和 H5 订单详情都会原样渲染，所以入库前必须按白名单过滤：
// 客户完全可以绕过 H5 直接调接口写 <img onerror=...> 这类内容。
//
// 只放行编辑器产出的标签与属性。没有标签的内容当普通文本原样保留（含历史数据），
// 前端按文本渲染，不会因为过滤把老备注改坏。
const TAG_OK = /^(b|strong|i|em|u|s|br|p|div|span|font|img)$/
const ATTR_OK = /^(src|alt|color|size|width|height)$/
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
const BAD_TAGS = /<(script|style|iframe|object|embed|svg|math|link|meta)\b[\s\S]*?<\/\1\s*>/gi

function sanitizeRemark(input) {
  let s = String(input === null || input === undefined ? "" : input)
  if (s.indexOf("<") < 0) return s

  s = s.replace(/<!--[\s\S]*?-->/g, "")
  s = s.replace(BAD_TAGS, "")
  s = s.replace(/<\/?(script|style|iframe|object|embed|svg|math|link|meta)\b[^>]*>/gi, "")

  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*\/?>/g, (all, tag, attrs) => {
    const t = String(tag).toLowerCase()
    // 白名单外的标签整体转义成文本，浏览器就不会把它当标签执行
    if (!TAG_OK.test(t)) return all.replace("<", "&lt;")
    if (all.charAt(1) === "/") return "</" + t + ">"

    let out = "<" + t
    let m
    ATTR_RE.lastIndex = 0
    while ((m = ATTR_RE.exec(attrs))) {
      const name = m[1].toLowerCase()
      const val = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] || ""
      if (!ATTR_OK.test(name)) continue
      if (name === "src" && !/^https?:\/\//i.test(val)) continue
      if (name === "alt" && /[<>"]/.test(val)) continue
      if (name === "color" && !/^#[0-9a-f]{3,6}$/i.test(val)) continue
      if (name === "size" && !/^[1-7]$/.test(val)) continue
      if ((name === "width" || name === "height") && !/^\d{1,4}$/.test(val)) continue
      out += " " + name + '="' + val.replace(/"/g, "&quot;") + '"'
    }
    return out + ">"
  })
}

// measurements / orders 都能被客户直接走 REST 写入，钩子里统一过滤
function sanitizeRemarkRecord(e) {
  try {
    const rec = e.record
    const raw = rec.getString("remark")
    const clean = sanitizeRemark(raw)
    if (clean !== raw) rec.set("remark", clean)
  } catch (err) {
    if (typeof console !== "undefined") console.log("[remark] sanitize error: " + err)
  }
  e.next()
}

module.exports = { sanitizeRemark: sanitizeRemark, sanitizeRemarkRecord: sanitizeRemarkRecord }
