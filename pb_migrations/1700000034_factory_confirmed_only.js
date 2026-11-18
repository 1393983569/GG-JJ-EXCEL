/// <reference path="../pb_data/types.d.ts" />

// 工厂只接已确认之后的生产单：待确认 / 已取消不在工厂列表里出现。
// 前端列表也加了同样的过滤，但数据层收紧才是根上的隔离。
migrate(
  (app) => {
    const orders = app.findCollectionByNameOrId("orders")
    const base =
      '(@request.auth.collectionName = "staff" && @request.auth.role_code != "agent" && @request.auth.role_code != "factory")' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "agent" && agent = @request.auth.id)' +
      ' || customer = @request.auth.id'
    const factory =
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "factory" && factory = @request.auth.id && status != "pending" && status != "cancelled")'
    orders.listRule = base + factory
    orders.viewRule = orders.listRule
    app.save(orders)
  },
  (app) => {
    const orders = app.findCollectionByNameOrId("orders")
    orders.listRule =
      '(@request.auth.collectionName = "staff" && @request.auth.role_code != "agent" && @request.auth.role_code != "factory")' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "agent" && agent = @request.auth.id)' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "factory" && factory = @request.auth.id)' +
      ' || customer = @request.auth.id'
    orders.viewRule = orders.listRule
    app.save(orders)
  }
)
