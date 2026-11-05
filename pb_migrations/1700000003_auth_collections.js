/// <reference path="../pb_data/types.d.ts" />

// 两套认证集合：customers（客户端 H5）、staff（后台管理端）
// username = 手机号登录
migrate(
  (app) => {
    const rolesId = app.findCollectionByNameOrId("roles").id
    const pvId = app.findCollectionByNameOrId("price_versions").id

    const roleFields = [
      { name: "role", type: "relation", collectionId: rolesId, maxSelect: 1 },
      { name: "price_version", type: "relation", collectionId: pvId, maxSelect: 1 },
      { name: "can_view_all_prices", type: "bool" },
      { name: "menus", type: "json", maxSize: 4000 },
      { name: "display_name", type: "text", max: 50 },
      { name: "phone", type: "text", max: 20 },
      { name: "is_active", type: "bool" },
    ]

    const customers = new Collection({
      name: "customers",
      type: "auth",
      fields: [{ name: "username", type: "text", required: true, min: 6, max: 32 }].concat(roleFields),
      listRule: '@request.auth.collectionName = "staff"',
      viewRule: 'id = @request.auth.id || @request.auth.collectionName = "staff"',
      createRule: '',
      updateRule: 'id = @request.auth.id || @request.auth.collectionName = "staff"',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(customers)

    const staff = new Collection({
      name: "staff",
      type: "auth",
      fields: [{ name: "username", type: "text", required: true, min: 3, max: 32 }].concat(roleFields),
      listRule: '@request.auth.collectionName = "staff"',
      viewRule: '@request.auth.collectionName = "staff"',
      createRule: null,
      updateRule: 'id = @request.auth.id || @request.auth.collectionName = "staff"',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(staff)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("customers"))
    app.delete(app.findCollectionByNameOrId("staff"))
  }
)
