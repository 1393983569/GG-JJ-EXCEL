/// <reference path="../pb_data/types.d.ts" />

// 重要：PocketBase 的每个 hook / router 回调都在**独立作用域**中编译，
// 访问不到本文件顶层定义的函数和变量。所以业务逻辑全部放在
// pb_hooks/lib/core.js 里，这里只做注册 + require。
//
// 如果在这里直接调用同文件定义的函数，运行时会报 "xxx is not defined"。

// 全局兜底：PocketBase 内置的报错都是英文，统一改写成中文再返回给客户端
routerUse((e) => {
  try {
    return e.next()
  } catch (err) {
    if (require(`${__hooks}/lib/i18n.js`).respond(e, err)) return
    throw err
  }
})

onRecordCreateRequest((e) => {
  require(`${__hooks}/lib/core.js`).onOrderCreateRequest(e)
}, "orders")

// 客户自助注册：价格版本与价格可见范围由服务端强制，忽略客户端传值
onRecordCreateRequest((e) => {
  require(`${__hooks}/lib/core.js`).prepareCustomerCreate(e)
}, "customers")

// 备注是富文本 HTML，客户可以直接调接口写入，入库前按白名单过滤
onRecordCreateRequest((e) => {
  require(`${__hooks}/lib/remark.js`).sanitizeRemarkRecord(e)
}, "measurements")

onRecordUpdateRequest((e) => {
  require(`${__hooks}/lib/remark.js`).sanitizeRemarkRecord(e)
}, "measurements")

onRecordUpdateRequest((e) => {
  require(`${__hooks}/lib/remark.js`).sanitizeRemarkRecord(e)
}, "orders")

// 下单走自定义路由：服务端负责拆表（原始尺寸/项目）、算价、写日志
routerAdd("POST", "/api/gg/orders", (c) => {
  return require(`${__hooks}/lib/core.js`).handleCreateOrder(c)
})

// 代理核对：改尺寸/项目/成交价后提交，进入待审核
routerAdd("POST", "/api/gg/orders-agent-confirm", (c) => {
  return require(`${__hooks}/lib/core.js`).handleAgentConfirm(c)
})

// 审核：通过/驳回、改生产尺寸、增删项目、重算价格
routerAdd("POST", "/api/gg/orders-review", (c) => {
  return require(`${__hooks}/lib/core.js`).handleReview(c)
})

// 满意度打分（审核员 / 代理 / 管理员）
routerAdd("POST", "/api/gg/orders-score", (c) => {
  return require(`${__hooks}/lib/core.js`).handleScore(c)
})

// 调价 / 固定价（审核员 / 管理员）
routerAdd("POST", "/api/gg/orders-adjust", (c) => {
  return require(`${__hooks}/lib/core.js`).handleAdjust(c)
})

// 项目单价维护（全局客户价 + 账号价）
routerAdd("POST", "/api/gg/item-prices", (c) => {
  return require(`${__hooks}/lib/core.js`).handleUpsertPrice(c)
})

// 客户 H5 取价：按客户所属代理返回客户价，没有代理就用全局客户价
routerAdd("GET", "/api/gg/items/prices", (c) => {
  return require(`${__hooks}/lib/core.js`).handleItemPrices(c)
})

// 审核指派工厂：派单后才有工厂成本行
routerAdd("POST", "/api/gg/orders-assign-factory", (c) => {
  return require(`${__hooks}/lib/core.js`).handleAssignFactory(c)
})

// 生产项目逐个设置工厂可见（有些项目不需要给工厂看）
routerAdd("POST", "/api/gg/orders-item-visibility", (c) => {
  return require(`${__hooks}/lib/core.js`).handleItemVisibility(c)
})

// 手机号 + 订单号后四位查历史尺码
routerAdd("GET", "/api/gg/measure/lookup", (c) => {
  return require(`${__hooks}/lib/core.js`).handleLookup(c)
})

// 代理链接自检：只回答有效/无效，不暴露代理信息
routerAdd("GET", "/api/gg/agent/check", (c) => {
  return require(`${__hooks}/lib/core.js`).handleAgentCheck(c)
})

// 角色变了就同步 role_code（权限规则真正判断的字段）
onRecordCreateRequest((e) => {
  require(`${__hooks}/lib/core.js`).syncStaffRole(e)
}, "staff")

onRecordUpdateRequest((e) => {
  require(`${__hooks}/lib/core.js`).syncStaffRole(e)
}, "staff")

// 角色标识（code）是权限规则的判断依据，改了会让所有规则失配
onRecordUpdateRequest((e) => {
  let before = null
  try {
    before = $app.findRecordById("roles", e.record.id)
  } catch (err) {
    return e.next()
  }
  if (before.getString("code") !== e.record.getString("code")) {
    throw new ForbiddenError("角色标识不能修改")
  }
  e.next()
}, "roles")

onRecordDeleteRequest((e) => {
  let rec = null
  try {
    rec = $app.findRecordById("roles", e.record.id)
  } catch (err) {
    return e.next()
  }
  if (rec.getString("code") === "admin") {
    throw new ForbiddenError("超级管理员角色不能删除")
  }
  e.next()
}, "roles")

// 项目只允许假删除（is_deleted）：真删会连带删掉 item_prices，历史订单对不上
onRecordDeleteRequest((e) => {
  throw new ForbiddenError("项目不能直接删除，请在「定制项目」里点删除做停用处理")
}, "items")

// 代理归属只在下单时确定：任何后台改派一律拒绝
onRecordUpdateRequest((e) => {
  let before = null
  try {
    before = $app.findRecordById("orders", e.record.id)
  } catch (err) {
    return e.next()
  }
  if (before.getString("agent") !== e.record.getString("agent")) {
    throw new ForbiddenError("代理归属不能修改，请通过代理专属链接重新下单")
  }
  e.next()
}, "orders")
