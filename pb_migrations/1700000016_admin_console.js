/// <reference path="../pb_data/types.d.ts" />

// 把「配置权限」交回管理端，但只有超级管理员能做
//
// 之前 roles.create/update/delete 全是 null（只有 PB 超级管理员能改），
// staff.createRule 也是 null，导致管理端的「角色权限」「后台账号」两个页面形同摆设。
migrate(
  (app) => {
    const isAdmin =
      '@request.auth.collectionName = "staff" && @request.auth.role_code = "admin"'

    const roles = app.findCollectionByNameOrId("roles")
    // 角色配置本身只有内部能看到，客户 H5 不需要
    roles.listRule = '@request.auth.collectionName = "staff"'
    roles.viewRule = '@request.auth.collectionName = "staff"'
    roles.createRule = isAdmin
    roles.updateRule = isAdmin
    roles.deleteRule = isAdmin
    app.save(roles)

    const priceVersions = app.findCollectionByNameOrId("price_versions")
    priceVersions.listRule = '@request.auth.collectionName = "staff"'
    priceVersions.viewRule = '@request.auth.collectionName = "staff"'
    app.save(priceVersions)

    // 后台账号只能由超级管理员创建（原来只有 PB 超管能建，管理端点了会 403）
    const staff = app.findCollectionByNameOrId("staff")
    staff.createRule = isAdmin
    app.save(staff)
  },
  (app) => {
    const roles = app.findCollectionByNameOrId("roles")
    roles.createRule = null
    roles.updateRule = null
    roles.deleteRule = null
    app.save(roles)

    const staff = app.findCollectionByNameOrId("staff")
    staff.createRule = null
    app.save(staff)
  }
)
