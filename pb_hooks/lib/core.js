// 业务逻辑集中在这里。
// PB 的 hook 回调是独立作用域编译的，handler 里访问不到 main.pb.js 顶层函数，
// 必须通过 require 引入本模块。
const pricing = require(`${__hooks}/lib/pricing.js`)
const measureText = require(`${__hooks}/lib/measure_text.js`)

// ---------------------------------------------------------------- 基础工具

function pad2(n) {
  return n < 10 ? "0" + n : String(n)
}

function todayPrefix() {
  const d = new Date()
  return "" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
}

function genOrderNo() {
  return "GG" + todayPrefix() + "-" + (Math.floor(Math.random() * 9000) + 1000)
}

function errText(err) {
  if (!err) return "unknown"
  if (err.message) return err.message
  return String(err)
}

function reqInfo(c) {
  try {
    return c.requestInfo() || {}
  } catch (e) {
    return {}
  }
}

// json 字段在 goja 里取出来可能是字符串，也可能是 types.JSONRaw（[]byte），
// 后者的 typeof 是 object、却被当成“按字节下标的数组”，用 data[key] 全取不到值，
// 必须统一序列化后再 parse 成普通对象。
function asJson(v, fallback) {
  if (v === null || v === undefined || v === "") return fallback
  if (typeof v === "string") {
    try {
      return JSON.parse(v)
    } catch (e) {
      return fallback
    }
  }
  if (typeof v === "object" && Object.prototype.toString.call(v) === "[object Array]") {
    const text = String(v)
    if (text.charAt(0) === "{" || text.charAt(0) === "[") {
      try {
        return JSON.parse(text)
      } catch (e) {
        return v
      }
    }
  }
  return v
}

// relation 字段存的是数组，getString 取不到值
function relId(rec, name) {
  if (!rec) return ""
  try {
    const arr = rec.getStringSlice(name)
    if (arr && arr.length > 0) return arr[0]
  } catch (e) {}
  try {
    return rec.getString(name) || ""
  } catch (e) {
    return ""
  }
}

function isRole(auth, codes) {
  if (!auth) return false
  let code = ""
  try {
    code = auth.getString("role_code")
  } catch (e) {}
  return codes.indexOf(code) >= 0
}

function currentStaff(c) {
  const auth = reqInfo(c).auth
  if (!auth) return null
  try {
    if (auth.collection().name !== "staff") return null
  } catch (e) {
    return null
  }
  return auth
}

function currentCustomer(c) {
  const auth = reqInfo(c).auth
  if (!auth) return null
  try {
    if (auth.collection().name !== "customers") return null
  } catch (e) {
    return null
  }
  return auth
}

function writeLog(orderId, operatorId, action, detail) {
  try {
    const rec = new Record($app.findCollectionByNameOrId("order_logs"))
    rec.set("order", orderId)
    if (operatorId) rec.set("operator", operatorId)
    rec.set("action", action)
    rec.set("detail", detail || {})
    $app.save(rec)
  } catch (e) {
    console.log("[log] " + errText(e))
  }
}

// ---------------------------------------------------------------- 量体字段

function loadFieldDefs() {
  const fields = $app.findAllRecords("measure_fields")
  const groups = $app.findAllRecords("measure_field_groups")
  const groupMap = {}
  for (let i = 0; i < groups.length; i++) groupMap[groups[i].id] = groups[i]

  const out = []
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    const gid = relId(f, "group")
    const g = gid ? groupMap[gid] : null
    out.push({
      key: f.getString("key"),
      label: f.getString("label"),
      unit: f.getString("unit"),
      type: f.getString("type"),
      decimals: f.getInt("decimals"),
      sort: f.getInt("sort"),
      in_export: f.getBool("in_export"),
      wrap_parens: f.getBool("wrap_parens"),
      is_active: f.getBool("is_active"),
      group_id: gid,
      group_name: g ? g.getString("name") : "",
    })
  }
  return out
}

function renderSpecText(data) {
  try {
    return measureText.renderMeasureText(loadFieldDefs(), data || {})
  } catch (e) {
    console.log("[spectext] " + errText(e))
    return ""
  }
}

// ---------------------------------------------------------------- 计价

function loadOrderItems(orderId, stage) {
  let recs = []
  try {
    recs = $app.findRecordsByFilter(
      "order_items",
      "order = {:o} && stage = {:s}",
      "sort",
      1000,
      0,
      { o: orderId, s: stage }
    )
  } catch (e) {
    recs = []
  }
  const out = []
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]
    out.push({
      id: r.id,
      item_id: relId(r, "item"),
      name: r.getString("name"),
      category: r.getString("category") || "main",
      qty: r.getInt("qty") || 1,
      // 下单时快照的项目配置：后台之后改配置不影响这一单
      unit: r.getString("unit"),
      qty_mode: r.getString("qty_mode") || "check",
      sort: r.getInt("sort"),
    })
  }
  return out
}

// 项目当前配置（只在「新订单」创建时读取）
function itemConfig(itemId) {
  if (!itemId) return null
  try {
    const rec = $app.findRecordById("items", itemId)
    return {
      name: rec.getString("name"),
      qty_mode: rec.getString("qty_mode") === "qty" ? "qty" : "check",
      unit: rec.getString("unit") || "",
    }
  } catch (e) {
    return null
  }
}

// 订单内已有项目快照（代理核对 / 审核时沿用，不跟随后台配置变化）
function orderItemConfig(orderId) {
  const map = {}
  const stages = ["customer", "agent", "final"]
  for (let s = 0; s < stages.length; s++) {
    const list = loadOrderItems(orderId, stages[s])
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (!it.item_id || map[it.item_id]) continue
      map[it.item_id] = {
        name: it.name,
        qty_mode: it.qty_mode === "qty" ? "qty" : "check",
        unit: it.unit || "",
      }
    }
  }
  return map
}

// 统一裁剪数量：勾选型固定 1，数量型最小 1、最大 999
function normalizeOrderItem(raw, meta) {
  const cfg = meta || { qty_mode: "check", unit: "" }
  const mode = cfg.qty_mode === "qty" ? "qty" : "check"
  let qty = Math.floor(Number(raw.qty) || 1)
  if (!isFinite(qty) || qty < 1) qty = 1
  if (mode === "check") qty = 1
  if (qty > 999) qty = 999
  return {
    item_id: String(raw.item_id || ""),
    name: String(cfg.name || raw.name || ""),
    category: String(raw.category || "main"),
    qty: qty,
    qty_mode: mode,
    unit: mode === "qty" ? String(cfg.unit || "") : "",
  }
}

// 写入 order_items（项目名 / 数量 / 单位 / 类型 都在这张表快照）
// metaMap 优先用订单里已有的快照，新订单传 null 走项目当前配置
function saveOrderItems(orderId, stage, rawItems, metaMap) {
  const itemCol = $app.findCollectionByNameOrId("order_items")
  const seen = {}
  let sort = 0
  let count = 0
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]
    const itemId = raw.item_id || ""
    if (!itemId || seen[itemId]) continue
    const cfg = (metaMap && metaMap[itemId]) || itemConfig(itemId)
    if (!cfg) continue
    seen[itemId] = true
    sort += 10
    count++

    const it = normalizeOrderItem(raw, cfg)
    const rec = new Record(itemCol)
    rec.set("order", orderId)
    rec.set("stage", stage)
    rec.set("item", itemId)
    rec.set("name", it.name)
    rec.set("category", it.category)
    rec.set("qty", it.qty)
    rec.set("unit", it.unit)
    rec.set("qty_mode", it.qty_mode)
    rec.set("sort", sort)
    $app.save(rec)
  }
  return count
}

function findOrderPrice(orderId, versionId) {
  try {
    return $app.findFirstRecordByFilter(
      "order_prices",
      "order = {:o} && version = {:v}",
      { o: orderId, v: versionId }
    )
  } catch (e) {
    return null
  }
}

function buildUnitMap() {
  const all = $app.findAllRecords("item_prices")
  const map = {}
  for (let i = 0; i < all.length; i++) {
    const p = all[i]
    map[relId(p, "item") + "|" + relId(p, "version")] = p.getInt("price_cents")
  }
  return map
}

function buildLines(items, versionId, unitMap) {
  const lines = []
  for (let i = 0; i < items.length; i++) {
    const s = items[i]
    const unit = unitMap[(s.item_id || "") + "|" + versionId]
    lines.push({
      itemId: s.item_id || "",
      name: s.name || "",
      category: s.category || "main",
      unitCents: unit === undefined ? 0 : unit,
      qty: s.qty || 1,
      unit: s.unit || "",
      qtyMode: s.qty_mode || "check",
    })
  }
  return lines
}

// 计价用哪一版项目：审核后 > 代理核对后 > 客户原始
function effectiveItems(orderId) {
  const finalItems = loadOrderItems(orderId, "final")
  if (finalItems.length) return finalItems
  const agentItems = loadOrderItems(orderId, "agent")
  if (agentItems.length) return agentItems
  return loadOrderItems(orderId, "customer")
}

function recalcOrderPrices(order) {
  const items = effectiveItems(order.id)
  const versions = $app.findAllRecords("price_versions")
  const unitMap = buildUnitMap()

  for (let v = 0; v < versions.length; v++) {
    const version = versions[v]
    if (!version.getBool("is_active")) continue

    const existing = findOrderPrice(order.id, version.id)
    const mode = existing ? existing.getString("price_mode") || "formula" : "formula"
    const fixedCents = existing ? existing.getInt("fixed_cents") : 0
    const adjustCents = existing ? existing.getInt("adjust_cents") : 0

    const result = pricing.calcPrice({
      priceMode: mode,
      fixedCents: fixedCents,
      lines: buildLines(items, version.id, unitMap),
      adjustCents: adjustCents,
    })

    const rec = existing || new Record($app.findCollectionByNameOrId("order_prices"))
    rec.set("order", order.id)
    rec.set("version", version.id)
    rec.set("price_mode", mode)
    rec.set("fixed_cents", fixedCents)
    rec.set("base_cents", result.baseCents)
    rec.set("items_cents", result.itemsCents)
    rec.set("adjust_cents", result.adjustCents)
    rec.set("total_cents", result.totalCents)
    rec.set("detail_json", result.detail)
    try {
      $app.save(rec)
    } catch (err) {
      console.log("[price] save failed: " + errText(err))
      rec.set("detail_json", JSON.stringify(result.detail))
      $app.save(rec)
    }
  }
}

// ---------------------------------------------------------------- 订单创建

// 代理专属链接里只放 staff 记录 id：
// 不再接受用户名/手机号，否则客户把链接里的数字改成手机号就能反推出代理账号
function findAgentByCode(code) {
  const key = String(code || "").trim()
  if (!key) return null
  try {
    const rec = $app.findRecordById("staff", key)
    if (rec.getString("role_code") === "agent" && rec.getBool("is_active")) return rec
  } catch (e) {}
  return null
}

// 成交价单独存一张表：工厂无权看到
function setTerminalPrice(orderId, cents) {
  if (cents === null || cents === undefined || cents === "") return
  const n = Math.round(Number(cents))
  if (!isFinite(n) || n < 0) return
  let rec = null
  try {
    rec = $app.findFirstRecordByFilter("order_terminal_prices", "order = {:o}", { o: orderId })
  } catch (e) {
    rec = null
  }
  if (!rec) rec = new Record($app.findCollectionByNameOrId("order_terminal_prices"))
  rec.set("order", orderId)
  rec.set("amount_cents", n)
  $app.save(rec)
}

// POST /api/gg/orders
// body: { measurement, contact_name, phone, address, items:[{item_id,name,qty,category}],
//         remark, agent, terminal_price_cents }
function handleCreateOrder(c) {
  const customer = currentCustomer(c)
  if (!customer) return c.json(403, { message: "请先登录客户账号" })

  const body = reqInfo(c).body || {}
  const measurementId = body.measurement || ""
  if (!measurementId) return c.json(400, { message: "请先选择量体档案" })

  let measurement
  try {
    measurement = $app.findRecordById("measurements", measurementId)
  } catch (e) {
    return c.json(404, { message: "量体档案不存在" })
  }
  if (relId(measurement, "customer") !== customer.id) {
    return c.json(403, { message: "不能使用他人的量体档案" })
  }

  const rawItems = asJson(body.items, [])
  if (!rawItems.length) return c.json(400, { message: "请至少选择一个项目" })

  // 带了代理标识就必须匹配得上：篡改链接不允许静默降级成「无代理」直接进审核
  const agentCode = String(body.agent || "").trim()
  const agent = findAgentByCode(agentCode)
  if (agentCode && !agent) {
    return c.json(400, { message: "代理链接无效或已失效，请通过代理提供的链接重新进入" })
  }

  const orderCol = $app.findCollectionByNameOrId("orders")
  const order = new Record(orderCol)
  order.set("order_no", genOrderNo())
  order.set("customer", customer.id)
  order.set("measurement", measurementId)
  order.set("agent", agent ? agent.id : "")
  order.set("contact_name", body.contact_name || customer.getString("display_name") || "")
  order.set("phone", body.phone || customer.getString("phone") || "")
  order.set("address", body.address || "")
  order.set("remark", body.remark || "")
  order.set("status", "pending")
  // 代理的客户先由代理核对，审核员直接下的单还是直接进审核
  order.set("review_status", agent ? "agent_pending" : "pending")
  order.set("is_deleted", false)
  $app.save(order)

  // 客户原始尺寸快照
  const data = asJson(measurement.get("data"), {})
  const spec = new Record($app.findCollectionByNameOrId("order_specs_customer"))
  spec.set("order", order.id)
  spec.set("data", data)
  spec.set("text", renderSpecText(data))
  spec.set("fabric", measurement.getString("fabric"))
  spec.set("remark", measurement.getString("remark"))
  $app.save(spec)

  // 客户选择的项目（stage=customer）
  // 类型（勾选型/数量型）与单位在这里按项目当前配置固化，
  // 之后后台改配置只影响新订单。
  saveOrderItems(order.id, "customer", rawItems, null)

  recalcOrderPrices(order)
  setTerminalPrice(order.id, body.terminal_price_cents)
  writeLog(order.id, "", "create", { by: "customer", agent: agent ? agent.id : "" })

  return c.json(200, { id: order.id, order_no: order.getString("order_no") })
}

// 兜底：通过 Records API 直接创建订单时也要有单号
function onOrderCreateRequest(e) {
  try {
    const rec = e.record
    if (rec && !rec.getString("order_no")) rec.set("order_no", genOrderNo())
  } catch (err) {
    console.log("[order] createRequest hook error: " + errText(err))
  }
  e.next()
}

// ---------------------------------------------------------------- 审核

// POST /api/gg/orders-review
// body: { order_id, action: approved|rejected, data?, items?, production_remark?, reject_reason? }
function handleReview(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["reviewer", "admin"])) {
    return c.json(403, { message: "仅审核员或管理员可审核" })
  }

  const body = reqInfo(c).body || {}
  const orderId = body.order_id || ""
  const action = body.action || ""
  if (!orderId) return c.json(400, { message: "缺少订单 ID" })
  if (action !== "approved" && action !== "rejected" && action !== "return") {
    return c.json(400, { message: "action 只能是 approved、rejected 或 return" })
  }

  let order
  try {
    order = $app.findRecordById("orders", orderId)
  } catch (e) {
    return c.json(404, { message: "订单不存在" })
  }

  // 退回给代理重新核对，重新开放代理编辑
  if (action === "return") {
    order.set("review_status", "agent_pending")
    order.set("reviewer", staff.id)
    $app.save(order)
    writeLog(orderId, staff.id, "return", { reason: body.reject_reason || "" })
    return c.json(200, { review_status: "agent_pending" })
  }

  order.set("review_status", action)
  order.set("reviewer", staff.id)
  order.set("reviewed_at", new Date().toISOString())
  if (action === "approved") {
    order.set("status", "confirmed")
  }
  $app.save(order)

  const prodCol = $app.findCollectionByNameOrId("order_specs_production")
  let prod = null
  try {
    prod = $app.findFirstRecordByFilter(
      "order_specs_production",
      "order = {:o}",
      { o: orderId }
    )
  } catch (e) {
    prod = null
  }
  if (!prod) prod = new Record(prodCol)

  if (action === "rejected") {
    prod.set("order", orderId)
    prod.set("reject_reason", body.reject_reason || "审核未通过")
    $app.save(prod)
    writeLog(orderId, staff.id, "reject", { reason: body.reject_reason || "" })
    return c.json(200, { review_status: "rejected" })
  }

  // 审核通过：写生产尺寸（默认沿用代理核对后的尺寸，没有代理调整就用客户原始尺寸）
  let baseData = {}
  try {
    const spec = $app.findFirstRecordByFilter(
      "order_specs_customer",
      "order = {:o}",
      { o: orderId }
    )
    baseData = asJson(spec.get("agent_data"), null) || asJson(spec.get("data"), {})
  } catch (e) {}

  const prodData = asJson(body.data, null) || baseData
  prod.set("order", orderId)
  prod.set("data", prodData)
  prod.set("text", renderSpecText(prodData))
  prod.set("production_remark", body.production_remark || "")
  prod.set("reject_reason", "")
  $app.save(prod)

  // 最终项目：不传则沿用客户选择
  const finalItems = asJson(body.items, null)
  if (finalItems && finalItems.length) {
    // 先清掉旧的 final
    try {
      const olds = $app.findRecordsByFilter(
        "order_items",
        "order = {:o} && stage = 'final'",
        "",
        1000,
        0,
        { o: orderId }
      )
      for (let i = 0; i < olds.length; i++) $app.delete(olds[i])
    } catch (e) {}

    // 沿用订单里已固化的类型/单位，后台改配置不影响这张单
    saveOrderItems(orderId, "final", finalItems, orderItemConfig(orderId))
  }

  recalcOrderPrices(order)
  writeLog(orderId, staff.id, "approve", {
    items_changed: !!(finalItems && finalItems.length),
    production_remark: body.production_remark || "",
  })

  return c.json(200, { review_status: "approved" })
}

// ---------------------------------------------------------------- 代理核对

// POST /api/gg/orders-agent-confirm
// body: { order_id, data?, items?, terminal_price_cents? }
// 代理只能改自己客户、且处于 agent_pending 的订单；底价由系统按项目重算，代理改不了
function handleAgentConfirm(c) {
  try {
    return handleAgentConfirmInner(c)
  } catch (e) {
    console.log("[agent-confirm] ERROR " + errText(e))
    return c.json(400, { message: "核对失败：" + errText(e) })
  }
}

function handleAgentConfirmInner(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["agent"])) {
    return c.json(403, { message: "仅代理可核对订单" })
  }

  const body = reqInfo(c).body || {}
  const orderId = body.order_id || ""
  if (!orderId) return c.json(400, { message: "缺少订单 ID" })

  let order
  try {
    order = $app.findRecordById("orders", orderId)
  } catch (e) {
    return c.json(404, { message: "订单不存在" })
  }
  if (relId(order, "agent") !== staff.id) {
    return c.json(403, { message: "只能核对自己客户的订单" })
  }
  if (order.getString("review_status") !== "agent_pending") {
    return c.json(400, { message: "订单已提交，不能重复修改" })
  }

  const rawItems = asJson(body.items, [])
  if (!rawItems.length) return c.json(400, { message: "请至少保留一个项目" })

  // 客户原始尺寸保持不动，代理调整单独存 agent_data，审核员才有对比依据
  const agentData = asJson(body.data, null)
  if (agentData) {
    let spec = null
    try {
      spec = $app.findFirstRecordByFilter("order_specs_customer", "order = {:o}", { o: orderId })
    } catch (e) {
      spec = null
    }
    if (!spec) spec = new Record($app.findCollectionByNameOrId("order_specs_customer"))
    spec.set("order", orderId)
    spec.set("agent_data", agentData)
    spec.set("agent_text", renderSpecText(agentData))
    $app.save(spec)
  }

  // 代理调整后的项目（stage=agent），重算价格时优先于 customer
  // 类型/单位沿用客户下单时的快照
  const meta = orderItemConfig(orderId)
  const olds = loadOrderItems(orderId, "agent")
  for (let i = 0; i < olds.length; i++) {
    try {
      const rec = $app.findRecordById("order_items", olds[i].id)
      $app.delete(rec)
    } catch (e) {}
  }

  saveOrderItems(orderId, "agent", rawItems, meta)

  setTerminalPrice(orderId, body.terminal_price_cents)

  order.set("review_status", "pending")
  $app.save(order)
  recalcOrderPrices(order)

  writeLog(orderId, staff.id, "agent_confirm", {
    items: rawItems.length,
    terminal_price_cents: Number(body.terminal_price_cents) || 0,
  })

  return c.json(200, { review_status: "pending" })
}

// POST /api/gg/orders-score
// body: { order_id, score: 1-10, remark }
function handleScore(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["reviewer", "admin", "agent"])) {
    return c.json(403, { message: "当前角色不能打分" })
  }

  const body = reqInfo(c).body || {}
  const orderId = body.order_id || ""
  const score = Math.round(Number(body.score))
  if (!orderId) return c.json(400, { message: "缺少订单 ID" })
  if (!isFinite(score) || score < 1 || score > 10) {
    return c.json(400, { message: "分数必须在 1-10 之间" })
  }

  try {
    $app.findRecordById("orders", orderId)
  } catch (e) {
    return c.json(404, { message: "订单不存在" })
  }

  const rec = new Record($app.findCollectionByNameOrId("order_reviews"))
  rec.set("order", orderId)
  rec.set("score", score)
  rec.set("remark", body.remark || "")
  rec.set("operator", staff.id)
  $app.save(rec)

  writeLog(orderId, staff.id, "score", { score: score })
  return c.json(200, { score: score })
}

// ---------------------------------------------------------------- 调价

function handleAdjust(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["reviewer", "admin"])) {
    return c.json(403, { message: "仅审核员或管理员可调价" })
  }

  const body = reqInfo(c).body || {}
  const orderId = body.order_id || ""
  if (!orderId) return c.json(400, { message: "缺少订单 ID" })

  let order
  try {
    order = $app.findRecordById("orders", orderId)
  } catch (e) {
    return c.json(404, { message: "订单不存在" })
  }

  const versionId = body.version || ""
  if (!versionId) return c.json(400, { message: "缺少价格版本" })

  // 允许 staff 按自己版本调价，或全部权限
  if (!staff.getBool("can_view_all_prices") && relId(staff, "price_version") !== versionId) {
    return c.json(403, { message: "无权修改该价格版本" })
  }

  const price = findOrderPrice(order.id, versionId)
  if (!price) return c.json(404, { message: "该版本尚无价格记录" })

  const mode = body.price_mode || price.getString("price_mode") || "formula"
  if (mode !== "formula" && mode !== "fixed") {
    return c.json(400, { message: "price_mode 只能是 formula 或 fixed" })
  }

  const fixedCents =
    body.fixed_cents !== undefined
      ? Math.round(Number(body.fixed_cents))
      : price.getInt("fixed_cents")
  const deltaCents = body.amount_cents !== undefined ? Math.round(Number(body.amount_cents)) : 0
  if (!isFinite(fixedCents) || !isFinite(deltaCents)) {
    return c.json(400, { message: "金额必须是整数（分）" })
  }

  const totalBefore = price.getInt("total_cents")
  const newAdjust = price.getInt("adjust_cents") + deltaCents

  const items = effectiveItems(order.id)
  const unitMap = buildUnitMap()
  const result = pricing.calcPrice({
    priceMode: mode,
    fixedCents: mode === "fixed" ? fixedCents : 0,
    lines: buildLines(items, versionId, unitMap),
    adjustCents: newAdjust,
  })

  price.set("price_mode", mode)
  price.set("fixed_cents", mode === "fixed" ? fixedCents : 0)
  price.set("adjust_cents", newAdjust)
  price.set("base_cents", result.baseCents)
  price.set("items_cents", result.itemsCents)
  price.set("total_cents", result.totalCents)
  price.set("detail_json", result.detail)
  try {
    $app.save(price)
  } catch (err) {
    price.set("detail_json", JSON.stringify(result.detail))
    $app.save(price)
  }

  const adj = new Record($app.findCollectionByNameOrId("order_adjustments"))
  adj.set("order", order.id)
  adj.set("version", versionId)
  adj.set("amount_cents", deltaCents)
  adj.set("reason", body.reason || "")
  adj.set("operator", staff.id)
  adj.set("total_before_cents", totalBefore)
  adj.set("total_after_cents", result.totalCents)
  $app.save(adj)

  writeLog(order.id, staff.id, "adjust", {
    version: versionId,
    amount_cents: deltaCents,
    reason: body.reason || "",
  })

  return c.json(200, { total_cents: result.totalCents, adjust_cents: newAdjust })
}

// ---------------------------------------------------------------- 项目价格

function handleUpsertPrice(c) {
  const staff = currentStaff(c)
  if (!staff) return c.json(403, { message: "仅后台账号可维护价格" })
  // 代理价由内部定，代理只能看自己的价格，不能改
  if (isRole(staff, ["agent"])) return c.json(403, { message: "代理不能修改价格" })

  const body = reqInfo(c).body || {}
  const itemId = body.item || ""
  const versionId = body.version || ""
  const priceCents = Math.round(Number(body.price_cents))

  if (!itemId || !versionId) return c.json(400, { message: "缺少项目或价格版本" })
  if (!isFinite(priceCents) || priceCents < 0) {
    return c.json(400, { message: "价格必须是不小于 0 的整数（分）" })
  }
  if (!staff.getBool("can_view_all_prices") && relId(staff, "price_version") !== versionId) {
    return c.json(403, { message: "无权修改该价格版本" })
  }

  let rec = null
  try {
    rec = $app.findFirstRecordByFilter(
      "item_prices",
      "item = {:i} && version = {:v}",
      { i: itemId, v: versionId }
    )
  } catch (e) {
    rec = null
  }

  if (!rec) {
    rec = new Record($app.findCollectionByNameOrId("item_prices"))
    rec.set("item", itemId)
    rec.set("version", versionId)
  }
  rec.set("price_cents", priceCents)
  $app.save(rec)

  return c.json(200, { id: rec.id, price_cents: priceCents })
}

// ---------------------------------------------------------------- 代理链接

// GET /api/gg/agent/check?code=xxx
// 只回答「这条链接还有没有效」，不返回代理是谁，避免被拿去反查账号
function handleAgentCheck(c) {
  const q = reqInfo(c).query || {}
  return c.json(200, { ok: !!findAgentByCode(String(q.code || "").trim()) })
}

// ---------------------------------------------------------------- 历史尺码

function handleLookup(c) {
  const q = reqInfo(c).query || {}
  const phone = String(q.phone || "").trim()
  const suffix = String(q.suffix || "").trim()

  if (!/^\d{11}$/.test(phone)) return c.json(400, { message: "手机号格式不正确" })
  if (!/^\d{4}$/.test(suffix)) return c.json(400, { message: "订单号后四位不正确" })

  const key = "gg_lookup_" + phone
  const now = Math.floor(Date.now() / 1000)
  let rec = { count: 0, lockedUntil: 0 }
  try {
    const raw = $app.store().get(key)
    if (raw) rec = JSON.parse(String(raw))
  } catch (e) {}

  if (rec.lockedUntil > now) return c.json(429, { message: "尝试次数过多，请 10 分钟后再试" })
  if (rec.lockedUntil && rec.lockedUntil <= now) rec = { count: 0, lockedUntil: 0 }

  let orders = []
  try {
    orders = $app.findRecordsByFilter(
      "orders",
      "phone = {:p} && order_no ~ {:s} && is_deleted != true",
      "-created",
      5,
      0,
      { p: phone, s: suffix }
    )
  } catch (e) {
    orders = []
  }

  if (orders.length === 0) {
    rec.count = rec.count + 1
    if (rec.count >= 5) {
      rec.lockedUntil = now + 600
      rec.count = 0
    }
    try {
      $app.store().set(key, JSON.stringify(rec))
    } catch (e) {}
    return c.json(404, { message: "未找到匹配的订单" })
  }

  try {
    $app.store().set(key, JSON.stringify({ count: 0, lockedUntil: 0 }))
  } catch (e) {}

  const list = []
  const seen = {}
  for (let i = 0; i < orders.length; i++) {
    let spec = null
    try {
      spec = $app.findFirstRecordByFilter(
        "order_specs_customer",
        "order = {:o}",
        { o: orders[i].id }
      )
    } catch (e) {
      spec = null
    }
    if (!spec) continue
    const key2 = spec.id
    if (seen[key2]) continue
    seen[key2] = true

    list.push({
      id: spec.id,
      code: orders[i].getString("order_no"),
      name: orders[i].getString("contact_name"),
      gender: "",
      fabric: spec.getString("fabric"),
      remark: spec.getString("remark"),
      data: asJson(spec.get("data"), {}),
    })
  }

  return c.json(200, { items: list })
}

// 客户自助注册：请求体可以由客户端任意构造，价格版本/价格可见范围必须服务端强制
function prepareCustomerCreate(e) {
  try {
    const rec = e.record
    try {
      const pv = $app.findFirstRecordByData("price_versions", "code", "customer")
      rec.set("price_version", pv.id)
    } catch (err) {}
    try {
      const role = $app.findFirstRecordByData("roles", "code", "customer")
      rec.set("role", role.id)
    } catch (err) {}
    rec.set("can_view_all_prices", false)
    rec.set("menus", [])
    rec.set("is_active", true)
  } catch (err) {
    console.log("[customer] prepareCreate hook error: " + errText(err))
  }
  e.next()
}

// staff.role 只是模板，权限规则里用的是 role_code，两者必须一致。
// 管理端 / PB 后台建号时只会选 role，这里统一同步，避免出现 role=代理却 role_code 为空
// （空 role_code 会让「代理只看自己订单」这类规则全部失效）。
function syncStaffRole(e) {
  const rec = e.record
  const roleId = relId(rec, "role")
  if (roleId) {
    try {
      const role = $app.findRecordById("roles", roleId)
      const code = role.getString("code")
      if (code && rec.getString("role_code") !== code) rec.set("role_code", code)
      // 菜单为空就用角色模板兜底，否则登录后左侧是空白的
      const menus = asJson(rec.get("menus"), [])
      if (!menus || !menus.length) rec.set("menus", asJson(role.get("menus"), []))
    } catch (err) {}
  }
  e.next()
}

module.exports = {
  syncStaffRole: syncStaffRole,
  prepareCustomerCreate: prepareCustomerCreate,
  handleCreateOrder: handleCreateOrder,
  handleAgentConfirm: handleAgentConfirm,
  handleReview: handleReview,
  handleScore: handleScore,
  handleAdjust: handleAdjust,
  handleUpsertPrice: handleUpsertPrice,
  handleAgentCheck: handleAgentCheck,
  handleLookup: handleLookup,
  onOrderCreateRequest: onOrderCreateRequest,
}
