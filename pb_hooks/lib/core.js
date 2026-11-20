// 业务逻辑集中在这里。
// PB 的 hook 回调是独立作用域编译的，handler 里访问不到 main.pb.js 顶层函数，
// 必须通过 require 引入本模块。
const pricing = require(`${__hooks}/lib/pricing.js`)
const measureText = require(`${__hooks}/lib/measure_text.js`)
const remark = require(`${__hooks}/lib/remark.js`)
// 项目 × 定制参数的绑定：并集与裁剪，纯逻辑（可单测）
const fieldBind = require(`${__hooks}/lib/fields.js`)

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

// 一次结算拆成多张单时共用，前端按它把同一批订单折叠成一行
function genBatchNo() {
  return "B" + todayPrefix() + "-" + (Math.floor(Math.random() * 9000) + 1000)
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

// 参数文本：只渲染本单项目声明的字段（bindings）。
// 不传 bindings 时保持旧行为（全部启用字段），给没有绑定信息的历史调用兜底。
// 尺码档案是全品类共用的，床垫单不能把档案里三个月前的胸围印到生产单上。
function renderSpecText(data, bindings) {
  try {
    const list = fieldBind.pickFields(loadFieldDefs(), bindings)
    return measureText.renderMeasureText(list, data || {})
  } catch (e) {
    console.log("[spectext] " + errText(e))
    return ""
  }
}

function fieldLabel(key) {
  const defs = loadFieldDefs()
  for (let i = 0; i < defs.length; i++) {
    if (defs[i].key === key) return defs[i].label || key
  }
  return key
}

// 一单一品类：代理核对 / 审核改项目时不许混进别的品类，
// 否则工厂指派、审核字段、导出模板都会错位
function checkSingleCatalog(rawItems) {
  let catalog = ""
  for (let i = 0; i < (rawItems || []).length; i++) {
    const cfg = itemConfig(rawItems[i].item_id || "")
    if (!cfg) continue
    const one = cfg.catalog || "衣服"
    if (!catalog) catalog = one
    else if (one !== catalog) return "一张订单只能有一个品类（" + catalog + " / " + one + "），请分开下单"
  }
  return ""
}

// 品类固定的参数集：这套尺寸是这个品类（打版方案）定好的，和选哪个项目无关
function catalogFields(name) {
  if (!name) return []
  try {
    const rec = $app.findFirstRecordByFilter("catalogs", "name = {:n}", { n: name })
    return asJson(rec.get("fields"), [])
  } catch (e) {
    return []
  }
}

// 订单要的参数由订单的品类决定；改造前的老订单没有品类，返回 undefined 让
// renderSpecText 退回「全部启用字段」，历史订单的文本不变。
function orderBindings(orderId) {
  let catalog = ""
  try {
    catalog = $app.findRecordById("orders", orderId).getString("catalog")
  } catch (e) {
    catalog = ""
  }
  if (!catalog) return undefined
  return catalogFields(catalog)
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
      // 客户选中的规格（手套 分体/连体），没规格的项目为空
      spec: r.getString("spec"),
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
      options: asJson(rec.get("options"), []),
      // 一个品类一张订单，要量什么尺寸由品类说了算
      catalog: rec.getString("catalog") || "衣服",
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
        // 代理核对 / 审核改项目时不带规格，沿用客户当初选的
        spec: it.spec || "",
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

  // 规格：客户端传的优先；代理核对 / 审核改项目时通常不带，沿用订单里已固化的
  let spec = String(raw.spec || "").trim()
  if (!spec) spec = String(cfg.spec || "").trim()
  // cfg.options 是数组 = 按项目当前配置校验；没有这个 key 说明是订单快照，原样沿用
  if (Array.isArray(cfg.options) && cfg.options.indexOf(spec) < 0) spec = ""

  return {
    item_id: String(raw.item_id || ""),
    name: String(cfg.name || raw.name || ""),
    category: String(raw.category || "main"),
    qty: qty,
    qty_mode: mode,
    unit: mode === "qty" ? String(cfg.unit || "") : "",
    spec: spec,
  }
}

// 下单前的规格校验：配了规格的项目必须选一个，且必须是配置里的值
function checkItemSpecs(rawItems) {
  for (let i = 0; i < rawItems.length; i++) {
    const cfg = itemConfig(rawItems[i].item_id || "")
    if (!cfg) continue
    const opts = Array.isArray(cfg.options) ? cfg.options : []
    if (!opts.length) continue
    const spec = String(rawItems[i].spec || "").trim()
    if (!spec) return "请选择「" + cfg.name + "」的规格"
    if (opts.indexOf(spec) < 0) return "「" + cfg.name + "」的规格无效，请重新选择"
  }
  return ""
}

// 写入 order_items（项目名 / 数量 / 单位 / 类型 都在这张表快照）
// metaMap 优先用订单里已有的快照，新订单传 null 走项目当前配置
// visibleMap：重审时沿用上次的「工厂可见」，没记录的项目默认给工厂看
function saveOrderItems(orderId, stage, rawItems, metaMap, visibleMap) {
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
    rec.set("spec", it.spec)
    rec.set("sort", sort)
    rec.set("factory_visible", !(visibleMap && visibleMap[itemId] === false))
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

// 单价表：全局价 key = 项目|版本，账号价 key = 账号|项目|版本
function buildUnitMap() {
  const map = {}
  const all = $app.findAllRecords("item_prices")
  for (let i = 0; i < all.length; i++) {
    const p = all[i]
    map[relId(p, "item") + "|" + relId(p, "version")] = p.getInt("price_cents")
  }
  const own = $app.findAllRecords("staff_item_prices")
  for (let i = 0; i < own.length; i++) {
    const p = own[i]
    map[relId(p, "staff") + "|" + relId(p, "item") + "|" + relId(p, "version")] = p.getInt("price_cents")
  }
  return map
}

// 账号价优先，没配就回落到全局价；都没配返回 undefined（按 0 算）
function unitPrice(unitMap, itemId, versionId, ownerId) {
  if (ownerId) {
    const own = unitMap[ownerId + "|" + itemId + "|" + versionId]
    if (own !== undefined) return own
  }
  return unitMap[(itemId || "") + "|" + versionId]
}

// freeIds：不计价的项目（H5 上取消勾选「计入价格」），单价按 0 算但明细照留
function buildLines(items, versionId, unitMap, ownerId, freeIds) {
  const lines = []
  for (let i = 0; i < items.length; i++) {
    const s = items[i]
    const unit = unitPrice(unitMap, s.item_id || "", versionId, ownerId)
    const free = !!(freeIds && freeIds[s.item_id || ""])
    lines.push({
      itemId: s.item_id || "",
      name: s.name || "",
      category: s.category || "main",
      unitCents: free || unit === undefined ? 0 : unit,
      qty: s.qty || 1,
      unit: s.unit || "",
      qtyMode: s.qty_mode || "check",
      spec: s.spec || "",
    })
  }
  return lines
}

// 这一行价格归谁：客户价和代理成本都归这单的代理，工厂成本归派单的工厂
function priceOwnerId(order, code) {
  if (code === "customer" || code === "agent") return relId(order, "agent")
  if (code === "factory") return relId(order, "factory")
  return ""
}

// 账号维度的项目配置（staff_item_settings），按项目 id 索引。
// 总部是「虚拟代理」，不占行：没配的项一律回落到 items 上的默认值。
function loadShopSettings(staffId) {
  const map = {}
  if (!staffId) return map
  let rows = []
  try {
    rows = $app.findRecordsByFilter(
      "staff_item_settings",
      "staff = {:s}",
      "",
      500,
      0,
      { s: staffId }
    )
  } catch (e) {
    rows = []
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const itemId = relId(r, "item")
    if (!itemId) continue
    map[itemId] = {
      recordId: r.id,
      alias: r.getString("alias"),
      h5_visible: r.getBool("h5_visible"),
      h5_default: r.getBool("h5_default"),
      in_price: r.getBool("in_price"),
      sort: r.getInt("sort"),
      // file 字段和 relation 一样存的是数组，getString 取不到
      image: relId(r, "image"),
    }
  }
  return map
}

// 客户版不计价的项目：items.in_price = false，代理在自己账号的项目配置里还可以改
function freeItemIds(order) {
  const map = {}
  const all = $app.findAllRecords("items")
  for (let i = 0; i < all.length; i++) {
    if (all[i].getBool("in_price")) continue
    map[all[i].id] = true
  }
  const agentId = relId(order, "agent")
  if (!agentId) return map
  const shop = loadShopSettings(agentId)
  for (const itemId in shop) {
    if (shop[itemId].in_price) delete map[itemId]
    else map[itemId] = true
  }
  return map
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
  const agentId = relId(order, "agent")
  const factoryId = relId(order, "factory")
  // 「不计价」只对客户版生效：客户不付钱，工厂/代理的成本照常算
  const freeIds = freeItemIds(order)

  for (let v = 0; v < versions.length; v++) {
    const version = versions[v]
    if (!version.getBool("is_active")) continue

    const existing = findOrderPrice(order.id, version.id)
    const code = version.getString("code")

    const ownerId = priceOwnerId(order, code)
    // 代理成本行要挂在代理名下，工厂成本行要派了单才有
    const skip = (code === "agent" && !agentId) || (code === "factory" && !factoryId)
    // 没有归属方就不留行：散客没有代理成本，没派单就没有工厂成本
    // 但已经手工加价/定过价的行不删，避免把账丢掉（规则本来也不让无归属的人看到）
    if (skip) {
      if (existing && !existing.getInt("adjust_cents") && existing.getString("price_mode") !== "fixed") {
        $app.delete(existing)
      }
      continue
    }

    const mode = existing ? existing.getString("price_mode") || "formula" : "formula"
    const fixedCents = existing ? existing.getInt("fixed_cents") : 0
    const adjustCents = existing ? existing.getInt("adjust_cents") : 0

    const result = pricing.calcPrice({
      priceMode: mode,
      fixedCents: fixedCents,
      lines: buildLines(items, version.id, unitMap, ownerId, code === "customer" ? freeIds : null),
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
// 一单一品类：items 可以跨品类，服务端按品类拆成多张订单，共用一个 batch_no。
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

  // 配了规格的项目必须选规格，别等到生产时才发现客户没说清
  const specErr = checkItemSpecs(rawItems)
  if (specErr) return c.json(400, { message: specErr })

  // 带了代理标识就必须匹配得上：篡改链接不允许静默降级成「无代理」直接进审核
  const agentCode = String(body.agent || "").trim()
  const agent = findAgentByCode(agentCode)
  if (agentCode && !agent) {
    return c.json(400, { message: "代理链接无效或已失效，请通过代理提供的链接重新进入" })
  }
  // 代理底价由管理员在账号上分配的价格版本决定，没分配就下单只会得到一堆 0
  if (agent && !relId(agent, "price_version")) {
    return c.json(400, { message: "该代理还没有分配价格，请联系管理员" })
  }

  // 按品类分组：一个品类一张单，工厂指派、审核、导出都建立在一单一个品类上
  const groups = []
  const groupMap = {}
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i]
    const cfg = itemConfig(raw.item_id || "")
    if (!cfg) return c.json(400, { message: "项目不存在或已停用，请刷新后重新选择" })
    const catalog = cfg.catalog || "衣服"
    if (!groupMap[catalog]) {
      groupMap[catalog] = { catalog: catalog, items: [] }
      groups.push(groupMap[catalog])
    }
    groupMap[catalog].items.push(raw)
  }

  // 必填校验一次做完：缺哪些字段一次性返回，不让客户改一个报一个
  const data = asJson(measurement.get("data"), {})
  const missing = []
  for (let i = 0; i < groups.length; i++) {
    const bindings = catalogFields(groups[i].catalog)
    for (let j = 0; j < bindings.length; j++) {
      const b = bindings[j]
      if (!b.required) continue
      const v = data[b.key]
      if (v !== null && v !== undefined && String(v).trim() !== "") continue
      missing.push({ key: b.key, label: fieldLabel(b.key), catalog: groups[i].catalog })
    }
  }
  if (missing.length) {
    const names = []
    for (let i = 0; i < missing.length; i++) {
      if (names.indexOf(missing[i].label) < 0) names.push(missing[i].label)
    }
    return c.json(400, { message: "请先补填：" + names.join("、"), missing: missing })
  }

  // 客户归属第一个给他下单的代理：之后不带链接进来，H5 的价格也按这个代理算
  if (agent && !relId(customer, "agent")) {
    try {
      customer.set("agent", agent.id)
      $app.save(customer)
    } catch (e) {
      console.log("[customer] bind agent failed: " + errText(e))
    }
  }

  const batchNo = groups.length > 1 ? genBatchNo() : ""
  const created = []
  let first = null
  for (let i = 0; i < groups.length; i++) {
    const one = createOrderForGroup(
      customer,
      measurement,
      data,
      groups[i],
      body,
      agent,
      batchNo,
      // 跨品类拆单后「成交价」没有归属，只允许单品类订单带过来
      groups.length === 1 ? body.terminal_price_cents : undefined
    )
    if (!first) first = one
    created.push({ id: one.id, order_no: one.getString("order_no"), catalog: groups[i].catalog })
  }

  return c.json(200, {
    id: first.id,
    order_no: first.getString("order_no"),
    batch_no: batchNo,
    orders: created,
  })
}

// 单张订单：品类内的一套项目 + 本单参数快照 + 价格
function createOrderForGroup(customer, measurement, data, group, body, agent, batchNo, terminalCents) {
  const orderCol = $app.findCollectionByNameOrId("orders")
  const order = new Record(orderCol)
  order.set("order_no", genOrderNo())
  if (batchNo) order.set("batch_no", batchNo)
  order.set("catalog", group.catalog)
  order.set("customer", customer.id)
  order.set("measurement", measurement.id)
  order.set("agent", agent ? agent.id : "")
  order.set("contact_name", body.contact_name || customer.getString("display_name") || "")
  order.set("phone", body.phone || customer.getString("phone") || "")
  order.set("address", body.address || "")
  order.set("remark", remark.sanitizeRemark(body.remark))
  order.set("status", "pending")
  // 代理的客户先由代理核对，审核员直接下的单还是直接进审核
  order.set("review_status", agent ? "agent_pending" : "pending")
  order.set("is_deleted", false)
  $app.save(order)

  // 客户原始参数快照：data 存全量（尺码库共用一份档案），text 只渲染本单品类要的字段
  const spec = new Record($app.findCollectionByNameOrId("order_specs_customer"))
  spec.set("order", order.id)
  spec.set("data", data)
  spec.set("text", renderSpecText(data, catalogFields(group.catalog)))
  spec.set("fabric", measurement.getString("fabric"))
  spec.set("remark", measurement.getString("remark"))
  $app.save(spec)

  // 客户选择的项目（stage=customer）
  // 类型（勾选型/数量型）与单位在这里按项目当前配置固化，
  // 之后后台改配置只影响新订单。
  saveOrderItems(order.id, "customer", group.items, null)

  recalcOrderPrices(order)
  if (terminalCents !== undefined) setTerminalPrice(order.id, terminalCents)
  writeLog(order.id, "", "create", {
    by: "customer",
    agent: agent ? agent.id : "",
    catalog: group.catalog,
    batch_no: batchNo,
  })

  return order
}

// 兜底：通过 Records API 直接创建订单时也要有单号
function onOrderCreateRequest(e) {
  try {
    const rec = e.record
    if (rec && !rec.getString("order_no")) rec.set("order_no", genOrderNo())
    if (rec) rec.set("remark", remark.sanitizeRemark(rec.getString("remark")))
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
  // 改项目时不许跨品类，先拦在改状态之前，避免订单被改了一半
  const catalogErr = checkSingleCatalog(asJson(body.items, []))
  if (catalogErr) return c.json(400, { message: catalogErr })

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
  // 生产单只印本单项目要的参数：共用尺码档案时，别把别的品类的旧值带给工厂
  prod.set("text", renderSpecText(prodData, orderBindings(orderId)))
  prod.set("production_remark", body.production_remark || "")
  prod.set("reject_reason", "")
  $app.save(prod)

  // 最终项目：不传则沿用客户选择
  const finalItems = asJson(body.items, null)
  if (finalItems && finalItems.length) {
    // 先清掉旧的 final，顺手记住哪些项目上次设了「不给工厂看」，
    // 重审时不该把隐藏的项目又露出来
    const visibleMap = {}
    try {
      const olds = $app.findRecordsByFilter(
        "order_items",
        "order = {:o} && stage = 'final'",
        "",
        1000,
        0,
        { o: orderId }
      )
      for (let i = 0; i < olds.length; i++) {
        visibleMap[relId(olds[i], "item")] = olds[i].getBool("factory_visible")
        $app.delete(olds[i])
      }
    } catch (e) {}

    // 沿用订单里已固化的类型/单位，后台改配置不影响这张单
    saveOrderItems(orderId, "final", finalItems, orderItemConfig(orderId), visibleMap)
  }

  recalcOrderPrices(order)
  writeLog(orderId, staff.id, "approve", {
    items_changed: !!(finalItems && finalItems.length),
    production_remark: body.production_remark || "",
  })

  return c.json(200, { review_status: "approved" })
}

// ---------------------------------------------------------------- 内部客户备注

// POST /api/gg/orders-remark
// body: { order_id, remark }
// 管理员/审核员改写后的备注单独存表；客户和代理仍然只读 orders.remark 原文。
// remark 传空串表示恢复成客户原文（删掉隔离记录）。
function handleInternalRemark(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["reviewer", "admin"])) {
    return c.json(403, { message: "仅审核员或管理员可修改客户备注" })
  }

  const body = reqInfo(c).body || {}
  const orderId = body.order_id || ""
  if (!orderId) return c.json(400, { message: "缺少订单 ID" })
  if (body.remark === undefined || body.remark === null) {
    return c.json(400, { message: "缺少备注内容" })
  }

  const clean = remark.sanitizeRemark(body.remark)
  if (clean.length > 5000) return c.json(400, { message: "备注最多 5000 个字符" })

  try {
    $app.findRecordById("orders", orderId)
  } catch (e) {
    return c.json(404, { message: "订单不存在" })
  }

  let rec = null
  try {
    rec = $app.findFirstRecordByFilter("order_internal_remarks", "order = {:o}", { o: orderId })
  } catch (e) {
    rec = null
  }

  if (!clean) {
    if (rec) $app.delete(rec)
    writeLog(orderId, staff.id, "remark_reset", { by: "internal" })
    return c.json(200, { remark: "" })
  }

  if (!rec) rec = new Record($app.findCollectionByNameOrId("order_internal_remarks"))
  rec.set("order", orderId)
  rec.set("remark", clean)
  rec.set("operator", staff.id)
  $app.save(rec)
  writeLog(orderId, staff.id, "remark_update", { by: "internal" })

  return c.json(200, { remark: clean })
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
  const catalogErr = checkSingleCatalog(rawItems)
  if (catalogErr) return c.json(400, { message: catalogErr })

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
    spec.set("agent_text", renderSpecText(agentData, orderBindings(orderId)))
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

  let order
  try {
    order = $app.findRecordById("orders", orderId)
  } catch (e) {
    return c.json(404, { message: "订单不存在" })
  }
  if (order.getString("status") !== "done") {
    return c.json(400, { message: "订单完成后才能打分" })
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

// POST /api/gg/orders-complete
// body: { order_id }
// 工厂完结生产单：写完 done 后审核员/代理才能打分
function handleFactoryComplete(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["factory"])) {
    return c.json(403, { message: "仅工厂账号可完结订单" })
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

  if (relId(order, "factory") !== staff.id) {
    return c.json(403, { message: "只能完结指派给自己的订单" })
  }

  const status = order.getString("status")
  if (status === "done") return c.json(400, { message: "订单已完结" })
  if (status === "cancelled") return c.json(400, { message: "订单已关闭，不能完结" })
  if (status === "pending") return c.json(400, { message: "订单尚未确认，不能完结" })

  order.set("status", "done")
  $app.save(order)
  writeLog(orderId, staff.id, "factory_complete", { from: status })

  return c.json(200, { status: "done" })
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

  // 底价由管理员配的项目价累加得出，审核员只能在此基础上加价（可填负数减价），
  // 每次加价必须写清原因，事后对账要能看懂这一笔是怎么来的
  const deltaCents = Math.round(Number(body.amount_cents))
  if (!isFinite(deltaCents) || !deltaCents) {
    return c.json(400, { message: "请填写加价金额" })
  }
  const reason = String(body.reason || "").trim()
  if (!reason) return c.json(400, { message: "请填写加价备注，如：这个颜色特殊" })

  const totalBefore = price.getInt("total_cents")
  const newAdjust = price.getInt("adjust_cents") + deltaCents

  const items = effectiveItems(order.id)
  const unitMap = buildUnitMap()
  const code = versionCode(versionId)
  const result = pricing.calcPrice({
    priceMode: price.getString("price_mode") || "formula",
    fixedCents: price.getInt("fixed_cents"),
    // 加价只改这一行的调整额，单价还是按这一行的账号价重算
    lines: buildLines(items, versionId, unitMap, priceOwnerId(order, code), code === "customer" ? freeItemIds(order) : null),
    adjustCents: newAdjust,
  })

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
  adj.set("reason", reason)
  adj.set("operator", staff.id)
  adj.set("total_before_cents", totalBefore)
  adj.set("total_after_cents", result.totalCents)
  $app.save(adj)

  writeLog(order.id, staff.id, "adjust", {
    version: versionId,
    amount_cents: deltaCents,
    reason: reason,
  })

  return c.json(200, { total_cents: result.totalCents, adjust_cents: newAdjust })
}

// ---------------------------------------------------------------- 项目价格

function versionCode(versionId) {
  try {
    return $app.findRecordById("price_versions", versionId).getString("code")
  } catch (e) {
    return ""
  }
}

function findVersionByCode(code) {
  try {
    return $app.findFirstRecordByData("price_versions", "code", code)
  } catch (e) {
    return null
  }
}

// POST /api/gg/item-prices
// body: { item, version, price_cents, staff? }
//   不带 staff → 全局客户价（只有内部能改）
//   带 staff   → 该账号的价；代理只能改自己的「客户价」，成本由内部定
function handleUpsertPrice(c) {
  const staff = currentStaff(c)
  if (!staff) return c.json(403, { message: "仅后台账号可维护价格" })

  const body = reqInfo(c).body || {}
  const itemId = body.item || ""
  const versionId = body.version || ""
  const ownerId = String(body.staff || "")
  const priceCents = Math.round(Number(body.price_cents))

  if (!itemId || !versionId) return c.json(400, { message: "缺少项目或价格版本" })
  if (!isFinite(priceCents) || priceCents < 0) {
    return c.json(400, { message: "价格必须是不小于 0 的整数（分）" })
  }

  const internal =
    staff.getBool("can_view_all_prices") || isRole(staff, ["admin", "reviewer"])

  if (ownerId) {
    if (isRole(staff, ["factory"])) return c.json(403, { message: "工厂不能修改价格" })
    if (!internal) {
      // 代理只能改自己账号、且只能改「给客户的价格」，成本价是内部定的
      if (ownerId !== staff.id || versionCode(versionId) !== "customer") {
        return c.json(403, { message: "只能修改自己的客户价" })
      }
    }
    let owner = null
    try {
      owner = $app.findRecordById("staff", ownerId)
    } catch (e) {
      owner = null
    }
    if (!owner) return c.json(400, { message: "账号不存在" })

    let rec = null
    try {
      rec = $app.findFirstRecordByFilter(
        "staff_item_prices",
        "staff = {:s} && item = {:i} && version = {:v}",
        { s: ownerId, i: itemId, v: versionId }
      )
    } catch (e) {
      rec = null
    }
    if (!rec) {
      rec = new Record($app.findCollectionByNameOrId("staff_item_prices"))
      rec.set("staff", ownerId)
      rec.set("item", itemId)
      rec.set("version", versionId)
    }
    rec.set("price_cents", priceCents)
    $app.save(rec)

    return c.json(200, { id: rec.id, staff: ownerId, price_cents: priceCents })
  }

  // 全局客户价：只有内部能改
  if (!internal) return c.json(403, { message: "无权修改该价格版本" })

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

// GET /api/gg/items/prices?agent=code
// 客户看到的价：客户已归属的代理 > 链接里的代理 > 全局客户价
function handleItemPrices(c) {
  const customer = currentCustomer(c)
  if (!customer) return c.json(403, { message: "请先登录客户账号" })

  const q = reqInfo(c).query || {}
  let agent = null
  const bound = relId(customer, "agent")
  if (bound) {
    try {
      agent = $app.findRecordById("staff", bound)
    } catch (e) {
      agent = null
    }
  }
  if (!agent) agent = findAgentByCode(String(q.agent || "").trim())

  const version = findVersionByCode("customer")
  if (!version) return c.json(200, { prices: {} })

  const unitMap = buildUnitMap()
  const all = $app.findAllRecords("items")
  // 代理账号上的项目配置；总部就是空，全部回落到 items
  const shop = agent ? loadShopSettings(agent.id) : {}
  const settingsCol = $app.findCollectionByNameOrId("staff_item_settings")
  const prices = {}
  const items = {}
  for (let i = 0; i < all.length; i++) {
    const it = all[i]
    if (!it.getBool("is_active") || it.get("is_deleted") === true) continue
    const cents = unitPrice(unitMap, it.id, version.id, agent ? agent.id : "")
    if (cents !== undefined) prices[it.id] = cents

    const own = shop[it.id] || null
    // 图片：代理传了自己的图就用（文件本身是公开可读的，不需要额外 token）
    const icon =
      own && own.image
        ? "/api/files/" + settingsCol.id + "/" + own.recordId + "/" + own.image
        : ""
    items[it.id] = {
      // 客户看到的名字：代理别名 > 总部别名 > 项目原名
      name: String((own && own.alias) || it.getString("alias") || it.getString("name")),
      h5_visible: own ? own.h5_visible : it.getBool("h5_visible"),
      h5_default: own ? own.h5_default : it.getBool("h5_default"),
      in_price: own ? own.in_price : it.getBool("in_price"),
      // 0 / 没配 = 跟随总部排序
      sort: own && own.sort ? own.sort : it.getInt("sort"),
      icon: icon,
      // 品类：H5 拿它分 tab；要填什么尺寸看 catalogs.fields，项目上不再声明
      catalog: it.getString("catalog") || "衣服",
    }
  }
  // 品类字典：H5 首页与下单页 tab 的顺序、以及哪些品类还在卖，都以这里为准。
  // 字典里停用的品类，项目即使还挂着它也进不了 H5。
  const catalogs = []
  const catRows = $app.findAllRecords("catalogs")
  for (let i = 0; i < catRows.length; i++) {
    const c = catRows[i]
    if (!c.getBool("is_active")) continue
    // fields 下发给 H5：下单页按品类渲染尺寸表单、算必填
    catalogs.push({
      name: c.getString("name"),
      sort: c.getInt("sort"),
      fields: asJson(c.get("fields"), []),
    })
  }
  catalogs.sort(function (a, b) {
    return a.sort - b.sort
  })

  return c.json(200, { prices: prices, items: items, catalogs: catalogs })
}

// POST /api/gg/orders-assign-factory
// body: { order_id, factory }
// 审核指派工厂后才有工厂成本行，工厂也才能看到这张单
function handleAssignFactory(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["reviewer", "admin"])) {
    return c.json(403, { message: "仅审核员或管理员可指派工厂" })
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

  const factoryId = String(body.factory || "")
  if (factoryId) {
    let f = null
    try {
      f = $app.findRecordById("staff", factoryId)
    } catch (e) {
      f = null
    }
    if (!f || f.getString("role_code") !== "factory") {
      return c.json(400, { message: "工厂账号不存在" })
    }
  }

  order.set("factory", factoryId)
  $app.save(order)
  // 重新读一次，确保计价拿到落库后的归属关系
  recalcOrderPrices($app.findRecordById("orders", orderId))
  writeLog(orderId, staff.id, "assign_factory", { factory: factoryId })

  return c.json(200, { factory: factoryId })
}

// POST /api/gg/orders-item-visibility
// body: { order_item_id, factory_visible }
// 审核后的生产项目逐个设置「给不给工厂看」：隐藏的项目工厂接口层就查不到
function handleItemVisibility(c) {
  const staff = currentStaff(c)
  if (!staff || !isRole(staff, ["reviewer", "admin"])) {
    return c.json(403, { message: "仅审核员或管理员可设置" })
  }

  const body = reqInfo(c).body || {}
  const recordId = String(body.order_item_id || "")
  if (!recordId) return c.json(400, { message: "缺少项目记录 ID" })

  let rec = null
  try {
    rec = $app.findRecordById("order_items", recordId)
  } catch (e) {
    return c.json(404, { message: "项目不存在" })
  }
  if (rec.getString("stage") !== "final") {
    return c.json(400, { message: "只有审核后的生产项目可以设置工厂可见" })
  }

  const visible = body.factory_visible !== false
  rec.set("factory_visible", visible)
  $app.save(rec)
  writeLog(relId(rec, "order"), staff.id, "item_visibility", {
    name: rec.getString("name"),
    factory_visible: visible,
  })

  return c.json(200, { factory_visible: visible })
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
  // 代理底价来自账号上分配的价格版本：建号时就必须分配，
  // 否则只能由审核员手工造价格（这正是要干掉的流程）
  if (rec.getString("role_code") === "agent" && !relId(rec, "price_version")) {
    throw new BadRequestError("请先给代理分配价格版本")
  }
  e.next()
}

module.exports = {
  syncStaffRole: syncStaffRole,
  prepareCustomerCreate: prepareCustomerCreate,
  handleCreateOrder: handleCreateOrder,
  handleAgentConfirm: handleAgentConfirm,
  handleReview: handleReview,
  handleInternalRemark: handleInternalRemark,
  handleScore: handleScore,
  handleFactoryComplete: handleFactoryComplete,
  handleAdjust: handleAdjust,
  handleUpsertPrice: handleUpsertPrice,
  handleItemPrices: handleItemPrices,
  handleAssignFactory: handleAssignFactory,
  handleItemVisibility: handleItemVisibility,
  handleAgentCheck: handleAgentCheck,
  handleLookup: handleLookup,
  onOrderCreateRequest: onOrderCreateRequest,
}
