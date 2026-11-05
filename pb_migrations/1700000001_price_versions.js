/// <reference path="../pb_data/types.d.ts" />

// 价格版本：客户版 / 工厂版 / 代理版（可扩展）
migrate(
  (app) => {
    const collection = new Collection({
      name: "price_versions",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true, max: 50 },
        { name: "code", type: "text", required: true, max: 32 },
        { name: "sort", type: "number", onlyInt: true, min: 0 },
        { name: "is_active", type: "bool" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_price_versions_code` ON `price_versions` (`code`)",
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
    app.delete(app.findCollectionByNameOrId("price_versions"))
  }
)
