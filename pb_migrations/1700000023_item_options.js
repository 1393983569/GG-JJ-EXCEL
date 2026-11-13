/// <reference path="../pb_data/types.d.ts" />

// 定制项目的「规格」：一个项目下配多个规格，客户下单时选一个。
//   例：手套 → 分体 / 连体；袖口 → 圆领 / V领
//
// items.options 存字符串数组（如 ["分体","连体"]），空数组表示这个项目没有规格。
// order_items.spec 存客户选中的规格快照，后台改配置不影响已下的单。
//
// 规格不单独定价：价格仍按 item_prices（项目 × 版本）。
// 规格之间差价很大时，直接按规格拆成两个项目更省事，别在这张表上叠价格维度。
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("options")) {
      items.fields.add(new JSONField({ name: "options", maxSize: 2000 }))
    }
    app.save(items)

    const orderItems = app.findCollectionByNameOrId("order_items")
    if (!orderItems.fields.getByName("spec")) {
      orderItems.fields.add(new TextField({ name: "spec", max: 50 }))
    }
    app.save(orderItems)
  },
  (app) => {
    const orderItems = app.findCollectionByNameOrId("order_items")
    orderItems.fields.removeByName("spec")
    app.save(orderItems)

    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("options")
    app.save(items)
  }
)
