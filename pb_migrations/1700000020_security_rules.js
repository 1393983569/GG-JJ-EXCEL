/// <reference path="../pb_data/types.d.ts" />

// 权限收口（越权修复）：
//   1. staff 更新/删除只允许 admin：原来本人可改，agent 可把自己 role 改成 admin
//   2. customers 更新只允许内部：原来本人可改，客户可给自己加 can_view_all_prices 看工厂价
//   3. orders 禁止直接通过 Records API 创建：下单只走 /api/gg/orders（hook 内 $app.save 不受规则限制）
//   4. items / 量体字段配置只允许内部：原来任意 staff（含代理）可改，且这些配置是全局的
migrate(
  (app) => {
    const isInternal =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'
    const isAdmin = '@request.auth.collectionName = "staff" && @request.auth.role_code = "admin"'

    const staff = app.findCollectionByNameOrId("staff")
    staff.updateRule = isAdmin
    staff.deleteRule = isAdmin
    app.save(staff)

    const customers = app.findCollectionByNameOrId("customers")
    customers.updateRule = isInternal
    app.save(customers)

    // 历史脏数据：客户不应该有任何价格版本特权，统一拉回客户版
    function relIdSafe(rec, name) {
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
    let customerPv = ""
    let customerRole = ""
    try {
      customerPv = app.findFirstRecordByData("price_versions", "code", "customer").id
    } catch (e) {}
    try {
      customerRole = app.findFirstRecordByData("roles", "code", "customer").id
    } catch (e) {}
    const allCustomers = app.findAllRecords("customers")
    for (let i = 0; i < allCustomers.length; i++) {
      const c = allCustomers[i]
      let dirty = false
      if (c.getBool("can_view_all_prices")) {
        c.set("can_view_all_prices", false)
        dirty = true
      }
      if (customerPv && relIdSafe(c, "price_version") !== customerPv) {
        c.set("price_version", customerPv)
        dirty = true
      }
      if (customerRole && relIdSafe(c, "role") !== customerRole) {
        c.set("role", customerRole)
        dirty = true
      }
      if (dirty) app.save(c)
    }

    // 历史脏数据：代理/工厂不应有全价格权限，价格版本也应回到角色绑定的版本
    const rolePv = {}
    const allRoles = app.findAllRecords("roles")
    for (let i = 0; i < allRoles.length; i++) {
      rolePv[allRoles[i].id] = {
        code: allRoles[i].getString("code"),
        price_version: relIdSafe(allRoles[i], "price_version"),
      }
    }
    const allStaff = app.findAllRecords("staff")
    for (let i = 0; i < allStaff.length; i++) {
      const s = allStaff[i]
      const code = s.getString("role_code")
      if (code !== "agent" && code !== "factory") continue
      let dirty = false
      if (s.getBool("can_view_all_prices")) {
        s.set("can_view_all_prices", false)
        dirty = true
      }
      const rp = rolePv[relIdSafe(s, "role")]
      if (rp && rp.price_version && relIdSafe(s, "price_version") !== rp.price_version) {
        s.set("price_version", rp.price_version)
        dirty = true
      }
      if (dirty) app.save(s)
    }

    const orders = app.findCollectionByNameOrId("orders")
    orders.createRule = null
    app.save(orders)

    const items = app.findCollectionByNameOrId("items")
    items.createRule = isInternal
    items.updateRule = isInternal
    items.deleteRule = isInternal
    app.save(items)

    const groups = app.findCollectionByNameOrId("measure_field_groups")
    groups.createRule = isInternal
    groups.updateRule = isInternal
    groups.deleteRule = isInternal
    app.save(groups)

    const fields = app.findCollectionByNameOrId("measure_fields")
    fields.createRule = isInternal
    fields.updateRule = isInternal
    fields.deleteRule = isInternal
    app.save(fields)
  },
  (app) => {
    // 回滚不恢复越权规则（回滚到漏洞状态没有意义）
  }
)
