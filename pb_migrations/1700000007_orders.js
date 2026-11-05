/// <reference path="../pb_data/types.d.ts" />

// 订单一律不存价格字段，价格全部落在 order_prices（一单一版本一行）。
// 这样"代理看不到工厂价"是数据层隔离，而不是前端隐藏。
migrate(
  (app) => {
    const customersId = app.findCollectionByNameOrId("customers").id
    const measurementsId = app.findCollectionByNameOrId("measurements").id
    const pvId = app.findCollectionByNameOrId("price_versions").id
    const staffId = app.findCollectionByNameOrId("staff").id

    const orders = new Collection({
      name: "orders",
      type: "base",
      fields: [
        { name: "order_no", type: "text", required: true, max: 32 },
        {
          name: "customer",
          type: "relation",
          collectionId: customersId,
          maxSelect: 1,
        },
        {
          name: "measurement",
          type: "relation",
          collectionId: measurementsId,
          maxSelect: 1,
        },
        // { data: {...}, text: "身高: 164cm，体重: 70kg，..." }
        { name: "measurement_snapshot", type: "json", maxSize: 64000 },
        // [{ item_id, name, qty }] 不含单价，避免带出成本价
        { name: "items_snapshot", type: "json", maxSize: 16000 },
        { name: "contact_name", type: "text", max: 50 },
        { name: "phone", type: "text", max: 20 },
        { name: "address", type: "text", max: 500 },
        // 注意：固定价/临时加价是「单个价格版本」的事，统一放在 order_prices 上
        {
          name: "status",
          type: "select",
          values: ["pending", "confirmed", "producing", "shipped", "done", "cancelled"],
          maxSelect: 1,
          required: true,
        },
        { name: "remark", type: "text", max: 2000 },
        { name: "is_deleted", type: "bool" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_orders_no` ON `orders` (`order_no`)",
        "CREATE INDEX `idx_orders_customer` ON `orders` (`customer`)",
        "CREATE INDEX `idx_orders_measurement` ON `orders` (`measurement`)",
      ],
      listRule: '@request.auth.collectionName = "staff" || customer = @request.auth.id',
      viewRule: '@request.auth.collectionName = "staff" || customer = @request.auth.id',
      createRule: '@request.auth.id != ""',
      updateRule: '@request.auth.collectionName = "staff" || customer = @request.auth.id',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(orders)

    const orderPrices = new Collection({
      name: "order_prices",
      type: "base",
      fields: [
        {
          name: "order",
          type: "relation",
          collectionId: orders.id,
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
        // formula 按项目累加 / fixed 该版本固定价覆盖（仅后台可设置）
        { name: "price_mode", type: "select", values: ["formula", "fixed"], maxSelect: 1, required: true },
        { name: "fixed_cents", type: "number", onlyInt: true, min: 0 },
        { name: "base_cents", type: "number", onlyInt: true },
        { name: "items_cents", type: "number", onlyInt: true },
        { name: "adjust_cents", type: "number", onlyInt: true },
        { name: "total_cents", type: "number", onlyInt: true },
        // [{ name, unit_cents, qty, amount_cents }] 该版本的明细快照
        { name: "detail_json", type: "json", maxSize: 16000 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_order_prices_order_version` ON `order_prices` (`order`, `version`)",
      ],
      listRule:
        '(@request.auth.can_view_all_prices = true || version = @request.auth.price_version) && (@request.auth.collectionName = "staff" || order.customer = @request.auth.id)',
      viewRule:
        '(@request.auth.can_view_all_prices = true || version = @request.auth.price_version) && (@request.auth.collectionName = "staff" || order.customer = @request.auth.id)',
      // 只能由服务端 hook 写入
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(orderPrices)

    const adjustments = new Collection({
      name: "order_adjustments",
      type: "base",
      fields: [
        {
          name: "order",
          type: "relation",
          collectionId: orders.id,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        // 作用于哪个价格版本
        {
          name: "version",
          type: "relation",
          collectionId: pvId,
          maxSelect: 1,
          required: true,
        },
        { name: "amount_cents", type: "number", onlyInt: true, required: true },
        { name: "reason", type: "text", max: 500 },
        {
          name: "operator",
          type: "relation",
          collectionId: staffId,
          maxSelect: 1,
        },
        // 复核用：加价前后的总额
        { name: "total_before_cents", type: "number", onlyInt: true },
        { name: "total_after_cents", type: "number", onlyInt: true },
      ],
      indexes: [
        "CREATE INDEX `idx_order_adjustments_order` ON `order_adjustments` (`order`)",
      ],
      listRule:
        '(@request.auth.can_view_all_prices = true || version = @request.auth.price_version) && (@request.auth.collectionName = "staff" || order.customer = @request.auth.id)',
      viewRule:
        '(@request.auth.can_view_all_prices = true || version = @request.auth.price_version) && (@request.auth.collectionName = "staff" || order.customer = @request.auth.id)',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(adjustments)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("order_adjustments"))
    app.delete(app.findCollectionByNameOrId("order_prices"))
    app.delete(app.findCollectionByNameOrId("orders"))
  }
)
