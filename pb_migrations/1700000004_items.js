/// <reference path="../pb_data/types.d.ts" />

// 定制项目 + 各版本单价（一项目 × 一版本 = 一行）
// 价格行按 price_version 做记录级隔离，代理/客户查不到其他版本的价格行。
migrate(
  (app) => {
    const pvId = app.findCollectionByNameOrId("price_versions").id

    const items = new Collection({
      name: "items",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true, max: 100 },
        // base 基础价 / main 主要定制项 / extra 补充项
        { name: "category", type: "select", values: ["base", "main", "extra"], maxSelect: 1, required: true },
        {
          name: "image",
          type: "file",
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"],
          thumbs: ["200x200", "600x0"],
        },
        { name: "sort", type: "number", onlyInt: true, min: 0 },
        { name: "is_active", type: "bool" },
        { name: "remark", type: "text", max: 500 },
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.collectionName = "staff"',
      updateRule: '@request.auth.collectionName = "staff"',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(items)

    const itemPrices = new Collection({
      name: "item_prices",
      type: "base",
      fields: [
        {
          name: "item",
          type: "relation",
          collectionId: items.id,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        {
          name: "version",
          type: "relation",
          collectionId: pvId,
          maxSelect: 1,
          required: true,
        },
        // 金额一律整数（分）
        { name: "price_cents", type: "number", onlyInt: true, min: 0 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_item_prices_item_version` ON `item_prices` (`item`, `version`)",
      ],
      listRule: '@request.auth.can_view_all_prices = true || version = @request.auth.price_version',
      viewRule: '@request.auth.can_view_all_prices = true || version = @request.auth.price_version',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(itemPrices)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("item_prices"))
    app.delete(app.findCollectionByNameOrId("items"))
  }
)
