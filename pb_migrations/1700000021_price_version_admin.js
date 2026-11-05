/// <reference path="../pb_data/types.d.ts" />

// 每个代理可以有自己的价格版本：
//   管理端「定制项目」里新建 price_versions 记录 → 给这一列录价
//   → 「后台账号」把该代理的 price_version 指向它
// 权限规则本来就只看 staff.price_version，不需要再加表或改规则。
migrate(
  (app) => {
    const isAdmin =
      '@request.auth.collectionName = "staff" && @request.auth.role_code = "admin"'
    const col = app.findCollectionByNameOrId("price_versions")
    // 只能新增和改名：删版本会连带影响 item_prices / order_prices，留给 PB 后台
    col.createRule = isAdmin
    col.updateRule = isAdmin
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId("price_versions")
    col.createRule = null
    col.updateRule = null
    app.save(col)
  }
)
