/// <reference path="../pb_data/types.d.ts" />

// 量体档案：一份档案可被多个订单复用
// data 为 { fieldKey: value } 的 JSON，与 measure_fields.key 对应
migrate(
  (app) => {
    const customersId = app.findCollectionByNameOrId("customers").id

    const collection = new Collection({
      name: "measurements",
      type: "base",
      fields: [
        // 尺码编号，如 SZ-0001，用于复用标识
        { name: "code", type: "text", required: true, max: 32 },
        {
          name: "customer",
          type: "relation",
          collectionId: customersId,
          maxSelect: 1,
        },
        { name: "name", type: "text", max: 50 },
        { name: "phone", type: "text", max: 20 },
        { name: "gender", type: "text", max: 10 },
        { name: "data", type: "json", maxSize: 64000 },
        // 面料 / 颜色 / 厚度，如「黑色紧身衣 0.4」
        { name: "fabric", type: "text", max: 200 },
        { name: "remark", type: "text", max: 2000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_measurements_code` ON `measurements` (`code`)",
        "CREATE INDEX `idx_measurements_phone` ON `measurements` (`phone`)",
      ],
      listRule: '@request.auth.collectionName = "staff" || customer = @request.auth.id',
      viewRule: '@request.auth.collectionName = "staff" || customer = @request.auth.id',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.collectionName = "staff" || customer = @request.auth.id',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(collection)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("measurements"))
  }
)
