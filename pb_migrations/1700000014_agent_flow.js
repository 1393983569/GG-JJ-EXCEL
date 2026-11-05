/// <reference path="../pb_data/types.d.ts" />

// 代理流程：客户下单 -> 待代理确认 -> 待审核 -> 待生产
//
// 只加必要的东西：
//   1. orders.review_status 增加 agent_pending（待代理确认）
//   2. order_specs_customer 增加 agent_data / agent_text（代理调整后的尺寸，
//      客户原始 data 保持不动，审核员才能三列对比）
//   3. order_items.stage 增加 agent（代理调整后的项目）
//   4. 新集合 order_terminal_prices：成交价单独存，工厂看不到
//      （PocketBase 只能做记录级权限，放 orders 表上工厂就会看到）
migrate(
  (app) => {
    const orders = app.findCollectionByNameOrId("orders")
    // 代理是外部角色，只能看自己名下的订单；其他 staff 维持全可见
    orders.listRule =
      '(@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || agent = @request.auth.id)) || customer = @request.auth.id'
    orders.viewRule = orders.listRule
    app.save(orders)

    const reviewStatus = orders.fields.getByName("review_status")
    if (reviewStatus && String(reviewStatus.values).indexOf("agent_pending") < 0) {
      reviewStatus.values = ["pending", "agent_pending", "approved", "rejected"]
      app.save(orders)
    }

    const specsCustomer = app.findCollectionByNameOrId("order_specs_customer")
    if (!specsCustomer.fields.getByName("agent_data")) {
      specsCustomer.fields.add(new JSONField({ name: "agent_data", maxSize: 64000 }))
    }
    if (!specsCustomer.fields.getByName("agent_text")) {
      specsCustomer.fields.add(new TextField({ name: "agent_text", max: 8000 }))
    }
    app.save(specsCustomer)

    const orderItems = app.findCollectionByNameOrId("order_items")
    const stage = orderItems.fields.getByName("stage")
    if (stage && String(stage.values).indexOf("agent") < 0) {
      stage.values = ["customer", "agent", "final"]
      // agent 阶段跟 customer 一样：代理能看自己订单，工厂看不到
      orderItems.listRule =
        '(stage != "final" && (order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory"))) || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "factory" || @request.auth.role_code = "reviewer" || @request.auth.role_code = "admin"))'
      orderItems.viewRule = orderItems.listRule
      app.save(orderItems)
    }

    // findCollectionByNameOrId 找不到时会抛错，不能用返回值判空
    let hasTerminalPrices = true
    try {
      app.findCollectionByNameOrId("order_terminal_prices")
    } catch (e) {
      hasTerminalPrices = false
    }

    if (!hasTerminalPrices) {
      const terminalPrices = new Collection({
        name: "order_terminal_prices",
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
          // 成交价（元转分），下单时固化，之后改项目单价不影响历史订单
          { name: "amount_cents", type: "number", onlyInt: true, min: 0 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX `idx_terminal_prices_order` ON `order_terminal_prices` (`order`)",
        ],
        // 工厂看不到终端售价
        listRule:
          'order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory")',
        viewRule:
          'order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory")',
        createRule: null,
        updateRule: null,
        deleteRule: null,
      })
      app.save(terminalPrices)
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("order_terminal_prices"))
    } catch (e) {}
  }
)
