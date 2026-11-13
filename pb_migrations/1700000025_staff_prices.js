/// <reference path="../pb_data/types.d.ts" />

// 项目价从「价格版本」下沉到「账号」
//
// 原来 item_prices(item, version) 一套版本一份价，多个工厂/代理只能共用一个版本，
// 想区分就得每来一个工厂/代理新建一个版本，项目表格的列数会跟着涨。
//
// 现在：
//   item_prices        只放全局客户价（version=客户版），散客和没自定价的代理客户用它
//   staff_item_prices  某个账号在这个版本下的项目价
//                       version=工厂版 → 该工厂的成本
//                       version=代理版 → 该代理的成本（内部定）
//                       version=客户版 → 该代理给自己客户定的价
//
// 另补两个归属：customers.agent（客户归谁）、orders.factory（这单给哪个工厂做）
migrate(
  (app) => {
    const staffId = app.findCollectionByNameOrId("staff").id
    const itemsId = app.findCollectionByNameOrId("items").id
    const pvId = app.findCollectionByNameOrId("price_versions").id

    const staffPrices = new Collection({
      name: "staff_item_prices",
      type: "base",
      fields: [
        {
          name: "staff",
          type: "relation",
          collectionId: staffId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        {
          name: "item",
          type: "relation",
          collectionId: itemsId,
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
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_staff_item_prices` ON `staff_item_prices` (`staff`, `item`, `version`)",
      ],
      // 内部看全部；工厂/代理只看自己账号的价；客户（H5）一律看不到成本价
      listRule:
        '@request.auth.collectionName = "staff" && (@request.auth.can_view_all_prices = true || staff = @request.auth.id)',
      viewRule:
        '@request.auth.collectionName = "staff" && (@request.auth.can_view_all_prices = true || staff = @request.auth.id)',
      // 写入统一走 /api/gg/item-prices，规则里收口改不了权限
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(staffPrices)

    // 客户归属代理：第一次通过代理链接下单时写入，决定 H5 看到哪套客户价
    const customers = app.findCollectionByNameOrId("customers")
    if (!customers.fields.getByName("agent")) {
      customers.fields.add(
        new RelationField({ name: "agent", collectionId: staffId, maxSelect: 1 })
      )
    }
    app.save(customers)

    // 订单指派工厂：审核指派后工厂才能看到这张单（和它的成本）
    const orders = app.findCollectionByNameOrId("orders")
    if (!orders.fields.getByName("factory")) {
      orders.fields.add(
        new RelationField({ name: "factory", collectionId: staffId, maxSelect: 1 })
      )
    }
    // 工厂只能看派给自己的单；代理还是只看自己的单；其余 staff 全可见
    orders.listRule =
      '(@request.auth.collectionName = "staff" && @request.auth.role_code != "agent" && @request.auth.role_code != "factory")' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "agent" && agent = @request.auth.id)' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "factory" && factory = @request.auth.id)' +
      ' || customer = @request.auth.id'
    orders.viewRule = orders.listRule
    app.save(orders)

    // 全局价只有内部能读：代理的兜底价不能直接暴露给代理/工厂
    const itemPrices = app.findCollectionByNameOrId("item_prices")
    itemPrices.listRule =
      '@request.auth.collectionName = "staff" && (@request.auth.can_view_all_prices = true || @request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'
    itemPrices.viewRule = itemPrices.listRule
    app.save(itemPrices)

    // 版本只是标签，价格已经按账号隔离，不需要再对代理隐藏别的版本
    const versions = app.findCollectionByNameOrId("price_versions")
    versions.listRule = '@request.auth.collectionName = "staff"'
    versions.viewRule = versions.listRule
    app.save(versions)

    // 订单价格行按「谁看哪一行」收口：
    //   客户 → 自己单的客户价行
    //   代理 → 自己单的客户价 + 代理成本行（不看工厂）
    //   工厂 → 派给自己的单的工厂成本行
    const priceRule =
      '@request.auth.can_view_all_prices = true' +
      ' || (@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer"))' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "agent" && order.agent = @request.auth.id && version.code != "factory")' +
      ' || (@request.auth.collectionName = "staff" && @request.auth.role_code = "factory" && order.factory = @request.auth.id && version.code = "factory")' +
      ' || (order.customer = @request.auth.id && version.code = "customer")'

    const orderPrices = app.findCollectionByNameOrId("order_prices")
    orderPrices.listRule = priceRule
    orderPrices.viewRule = priceRule
    app.save(orderPrices)

    const orderAdjustments = app.findCollectionByNameOrId("order_adjustments")
    orderAdjustments.listRule = priceRule
    orderAdjustments.viewRule = priceRule
    app.save(orderAdjustments)

    // 生产尺寸同样只给指派到的工厂
    const specsProduction = app.findCollectionByNameOrId("order_specs_production")
    specsProduction.listRule =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin" || (@request.auth.role_code = "factory" && order.factory = @request.auth.id))'
    specsProduction.viewRule = specsProduction.listRule
    app.save(specsProduction)

    // 生产数据（stage=final）同样只给指派到的工厂
    const orderItems = app.findCollectionByNameOrId("order_items")
    const itemsRule =
      '((stage = "customer" || stage = "agent") && (order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer"))))' +
      ' || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin" || (@request.auth.role_code = "factory" && order.factory = @request.auth.id)))'
    orderItems.listRule = itemsRule
    orderItems.viewRule = itemsRule
    app.save(orderItems)
  },
  (app) => {
    // 回滚只把规则退回到「按版本可见」的老口径，账号价表本身保留，避免误删数据
    const itemPrices = app.findCollectionByNameOrId("item_prices")
    itemPrices.listRule =
      '@request.auth.can_view_all_prices = true || version = @request.auth.price_version'
    itemPrices.viewRule = itemPrices.listRule
    app.save(itemPrices)

    const orders = app.findCollectionByNameOrId("orders")
    orders.listRule =
      '(@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || agent = @request.auth.id)) || customer = @request.auth.id'
    orders.viewRule = orders.listRule
    app.save(orders)
  }
)
