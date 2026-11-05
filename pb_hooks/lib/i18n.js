// 报错文案中文化。
// PocketBase 内置的错误提示全是英文，H5 / 后台都是把 message 原样弹给客户看，
// 所以在这里统一翻成中文。入口是 main.pb.js 里的全局中间件。

// 与 PocketBase 原文完全一致的顶层提示
const TEXTS = {
  "Failed to authenticate.": "手机号或密码错误。",
  "Failed to create record.": "创建失败，请检查填写内容。",
  "Failed to update record.": "保存失败，请检查填写内容。",
  "Failed to delete record.": "删除失败，请稍后再试。",
  "Failed to load records.": "加载数据失败，请稍后再试。",
  "An error occurred while loading the submitted data.": "提交的数据格式不正确。",
  "An error occurred while validating the submitted data.": "提交的数据没有通过校验，请检查填写内容。",
  "The requested resource wasn't found.": "请求的内容不存在。",
  "Missing collection context.": "请求的集合不存在。",
  "Missing or invalid authentication.": "登录已失效，请重新登录。",
  "Cannot be blank.": "不能为空。",
  "Invalid value.": "填写内容无效。",
  "Must be a valid email address.": "邮箱格式不正确。",
  "You are not allowed to perform this request.": "没有权限执行此操作。",
  "Only superusers can perform this action.": "仅超级管理员可执行此操作。",
  "The email is invalid or already in use.": "邮箱无效或已被使用。",
  "Invalid or expired OTP.": "验证码无效或已过期。",
  "The password reset token is invalid or expired.": "重置密码的链接无效或已过期。",
  "Too many requests.": "操作太频繁，请稍后再试。",
}

// 带变量的提示
const RULES = [
  [/^Must be at least (\d+) character\(s\)\.$/, "至少 $1 个字符。"],
  [/^Must be at most (\d+) character\(s\)\.$/, "最多 $1 个字符。"],
  [/^Must be between (\d+) and (\d+) character\(s\)\.$/, "长度需在 $1 ~ $2 个字符之间。"],
  [/^The request requires .*authorization token.*$/, "登录已失效，请重新登录。"],
  [/^Failed to (.+)\.$/, "操作失败，请稍后再试。"],
]

// 字段名（PocketBase 的字段 key）对应的中文
const FIELD_LABELS = {
  username: "手机号",
  email: "邮箱",
  phone: "手机号",
  password: "密码",
  passwordConfirm: "确认密码",
  display_name: "称呼",
}

function hasEnglish(text) {
  return /[A-Za-z]/.test(String(text || ""))
}

function fill(tpl, matched) {
  let out = tpl
  for (let i = 1; i < matched.length; i++) {
    out = out.split("$" + i).join(matched[i])
  }
  return out
}

// 按字段错误码翻译（PocketBase 的 code，比 message 稳定）
function byCode(code, params) {
  const p = params || {}
  if (code === "validation_required") return "不能为空。"
  if (code === "validation_not_unique") return "已存在，请更换。"
  if (code === "validation_invalid_value") return "填写内容无效。"
  if (code === "validation_is_email") return "邮箱格式不正确。"
  if (code === "validation_is_url") return "链接格式不正确。"
  if (code === "validation_min_text_constraint") return "长度不能少于 " + p.min + " 个字符。"
  if (code === "validation_max_text_constraint") return "长度不能超过 " + p.max + " 个字符。"
  if (code === "validation_min_select_constraint") return "至少需要选择 " + p.min + " 项。"
  if (code === "validation_max_select_constraint") return "最多只能选择 " + p.max + " 项。"
  if (code === "validation_min_files_constraint") return "至少要上传 " + p.min + " 个文件。"
  if (code === "validation_max_files_constraint") return "最多只能上传 " + p.max + " 个文件。"
  if (code === "validation_filesize_constraint") return "文件大小超出限制。"
  return ""
}

// 按 HTTP 状态兜底，保证不会再有英文漏给客户
function fallback(status) {
  if (status === 400) return "请求有误，请检查填写内容。"
  if (status === 401) return "登录已失效，请重新登录。"
  if (status === 403) return "没有权限执行此操作。"
  if (status === 404) return "请求的内容不存在。"
  if (status === 405) return "请求方式不正确。"
  if (status === 413) return "上传的内容过大。"
  if (status === 429) return "操作太频繁，请稍后再试。"
  if (status >= 500) return "服务器处理请求时出错，请稍后再试。"
  return "请求失败，请稍后再试。"
}

/**
 * 翻译单条提示；已经是中文的原样返回。
 * @param {string} text
 * @returns {string}
 */
function translate(text) {
  const s = String(text == null ? "" : text).trim()
  if (!s) return ""
  if (TEXTS[s]) return TEXTS[s]

  const unique = s.match(/^The (.+) is invalid or already in use\.$/)
  if (unique) {
    const label = FIELD_LABELS[unique[1]] || "内容"
    return "该" + label + "无效或已被使用。"
  }

  for (let i = 0; i < RULES.length; i++) {
    const matched = s.match(RULES[i][0])
    if (matched) return fill(RULES[i][1], matched)
  }
  return s
}

// 字段级错误：{ 字段名: { code, message, params } }
function translateData(data) {
  let plain = {}
  try {
    plain = JSON.parse(JSON.stringify(data || {}))
  } catch (e) {
    return {}
  }
  if (!plain || typeof plain !== "object") return {}

  const keys = Object.keys(plain)
  for (let i = 0; i < keys.length; i++) {
    const item = plain[keys[i]]
    if (!item || typeof item !== "object") continue

    let msg = translate(item.message)
    if (!msg || hasEnglish(msg)) {
      msg = byCode(String(item.code || ""), item.params) || "填写内容无效。"
    }
    item.message = msg
  }
  return plain
}

// PocketBase 会给没有句号的提示补一个英文句号，中文里换成「。」
function polish(msg) {
  if (!/[\u4e00-\u9fa5]/.test(msg)) return msg
  if (msg.charAt(msg.length - 1) !== ".") return msg
  return msg.slice(0, -1) + "。"
}

/**
 * 把 PocketBase 抛出的 ApiError 直接写成中文响应。
 * @returns {boolean} true 表示已响应，false 表示不是 ApiError，调用方原样抛出
 */
function respond(e, err) {
  const api = err && err.value
  const status = api && typeof api.status === "number" ? api.status : 0
  if (!status) return false

  let message = polish(translate(api.message))
  if (!message || hasEnglish(message)) message = fallback(status)

  // 500 的真实原因只写进服务端日志，客户端只看中文提示
  if (status >= 500) {
    try {
      console.log("[i18n] " + status + " " + api.message)
    } catch (e1) {}
  }

  e.json(status, { status: status, message: message, data: translateData(api.data) })
  return true
}

module.exports = { translate, translateData, respond }
