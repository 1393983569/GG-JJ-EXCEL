/// <reference path="../pb_data/types.d.ts" />

// 客户备注隔离：orders.remark 是客户原文，客户和代理继续看这一份；
// 管理员/审核员改写后的备注单独存这里。PocketBase 只有记录级权限，
// 拆表才能做到「同一张订单，不同角色看到不同备注」。
migrate(
  (app) => {
    const ordersId = app.findCollectionByNameOrId("orders").id
    const staffId = app.findCollectionByNameOrId("staff").id
    const isInternal =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'

    const remarks = new Collection({
      name: "order_internal_remarks",
      type: "base",
      fields: [
        {
          name: "order",
          type: "relation",
          collectionId: ordersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "remark", type: "text", max: 5000 },
        {
          name: "operator",
          type: "relation",
          collectionId: staffId,
          maxSelect: 1,
        },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_internal_remarks_order` ON `order_internal_remarks` (`order`)",
      ],
      // 客户、代理、工厂都看不见；写入只走 /api/gg/orders-remark，由服务端校验角色
      listRule: isInternal,
      viewRule: isInternal,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(remarks)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("order_internal_remarks"))
    } catch (e) {}
  }
)
