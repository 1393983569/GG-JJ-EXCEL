/// <reference path="../pb_data/types.d.ts" />

// 审核后的生产项目逐个控制「给不给工厂看」。
//
// 打版费这类不在工厂现场做的项目，工厂没必要看到，工单上留着只会引起误会。
// order_items 上加 factory_visible，工厂读 stage=final 时多一个条件：
// 审核员/管理员照旧能看到全部（要能随时改），工厂只拿到标了可见的项目。
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("order_items")
    if (!items.fields.getByName("factory_visible")) {
      items.fields.add(new BoolField({ name: "factory_visible" }))
    }

    const rule =
      '((stage = "customer" || stage = "agent") && (order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer"))))' +
      ' || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin" || (@request.auth.role_code = "factory" && order.factory = @request.auth.id && factory_visible = true)))'
    items.listRule = rule
    items.viewRule = rule
    app.save(items)

    // bool 字段没有默认值，老记录读出来是 false：
    // 这里统一补成可见，避免历史订单的项目对工厂凭空消失
    const all = app.findAllRecords("order_items")
    for (let i = 0; i < all.length; i++) {
      all[i].set("factory_visible", true)
      app.save(all[i])
    }
  },
  (app) => {
    const items = app.findCollectionByNameOrId("order_items")
    const rule =
      '((stage = "customer" || stage = "agent") && (order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer"))))' +
      ' || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin" || (@request.auth.role_code = "factory" && order.factory = @request.auth.id)))'
    items.listRule = rule
    items.viewRule = rule
    items.fields.removeByName("factory_visible")
    app.save(items)
  }
)
