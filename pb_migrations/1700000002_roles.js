/// <reference path="../pb_data/types.d.ts" />

// 角色：绑定价格版本 + 菜单权限
// 实际用户（staff/customers）上会冗余 price_version / menus / can_view_all_prices，
// 规则只用冗余字段，避免多层关联展开。
migrate(
  (app) => {
    const pvId = app.findCollectionByNameOrId("price_versions").id

    const collection = new Collection({
      name: "roles",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true, max: 50 },
        { name: "code", type: "text", required: true, max: 32 },
        {
          name: "price_version",
          type: "relation",
          collectionId: pvId,
          maxSelect: 1,
          required: true,
        },
        { name: "can_view_all_prices", type: "bool" },
        { name: "menus", type: "json", maxSize: 4000 },
        { name: "is_active", type: "bool" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_roles_code` ON `roles` (`code`)",
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(collection)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("roles"))
  }
)
