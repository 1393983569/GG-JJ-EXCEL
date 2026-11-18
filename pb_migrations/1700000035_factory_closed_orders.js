/// <reference path="../pb_data/types.d.ts" />

// 关闭订单（status=cancelled）仍要给工厂看到，列表里置灰标「订单关闭」，
// 所以工厂的读取规则只排除待确认，不再排除已取消。
migrate(
  (app) => {
    const orders = app.findCollectionByNameOrId("orders")
    const base =
      '(@request.auth.collectionName = "staff" && @request.auth.role_code != "agent" && @request.auth.role_code != "factory")' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "agent" && agent = @request.auth.id)' +
      ' || customer = @request.auth.id' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "factory" && factory = @request.auth.id && status != "pending")'
    orders.listRule = base
    orders.viewRule = base
    app.save(orders)
  },
  (app) => {
    const orders = app.findCollectionByNameOrId("orders")
    orders.listRule =
      '(@request.auth.collectionName = "staff" && @request.auth.role_code != "agent" && @request.auth.role_code != "factory")' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "agent" && agent = @request.auth.id)' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "factory" && factory = @request.auth.id && status != "pending" && status != "cancelled")' +
      ' || customer = @request.auth.id'
    orders.viewRule = orders.listRule
    app.save(orders)
  }
)
