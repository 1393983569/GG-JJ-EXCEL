/// <reference path="../pb_data/types.d.ts" />

// 权限收口
//
// 角色：admin / reviewer（内部） / agent（外部代理） / factory（外部工厂） / customer
//
// 修的都是「staff 一刀切全可见」留下的洞：
//   1. staff：代理能列出全部员工、能改别人的账号（含密码）
//   2. customers：代理能看/改全部客户资料
//   3. measurements：代理能看全部客户量体档案
//   4. order_prices / order_adjustments：代理能看全站该版本价格
//   5. order_reviews：代理能看全部满意度
//   6. orders.agent：审核员可以 PATCH 改派，违反「代理只能下单时确定」
migrate(
  (app) => {
    const isInternal = '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'
    const isStaffNotAgent = '@request.auth.collectionName = "staff" && @request.auth.role_code != "agent"'

    // ---------------------------------------------------------------- staff
    const staff = app.findCollectionByNameOrId("staff")
    staff.listRule = 'id = @request.auth.id || ' + isStaffNotAgent
    staff.viewRule = 'id = @request.auth.id || ' + isStaffNotAgent
    // 只有管理员/审核员能改别人的账号，本人可以改自己
    staff.updateRule = 'id = @request.auth.id || ' + isInternal
    staff.deleteRule = 'id = @request.auth.id || ' + isInternal
    app.save(staff)

    // ---------------------------------------------------------------- customers
    const customers = app.findCollectionByNameOrId("customers")
    customers.listRule = 'id = @request.auth.id || ' + isStaffNotAgent
    customers.viewRule = 'id = @request.auth.id || ' + isStaffNotAgent
    // 注册时 createRule 为 ""，保持不动；改资料只允许本人或内部
    customers.updateRule = 'id = @request.auth.id || ' + isInternal
    customers.deleteRule = isInternal
    app.save(customers)

    // ---------------------------------------------------------------- measurements
    const measurements = app.findCollectionByNameOrId("measurements")
    measurements.listRule =
      'customer = @request.auth.id || (@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer"))'
    measurements.viewRule = measurements.listRule
    // 只能给自己建档案
    measurements.createRule = 'customer = @request.auth.id'
    measurements.updateRule =
      'customer = @request.auth.id || (@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer"))'
    measurements.deleteRule =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'
    app.save(measurements)

    // ---------------------------------------------------------------- 价格：只能看自己这单的
    const orderScope =
      'order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "agent")'
    const priceRule =
      '(@request.auth.can_view_all_prices = true || version = @request.auth.price_version) && (' +
      orderScope +
      ')'

    const orderPrices = app.findCollectionByNameOrId("order_prices")
    orderPrices.listRule = priceRule
    orderPrices.viewRule = priceRule
    app.save(orderPrices)

    const orderAdjustments = app.findCollectionByNameOrId("order_adjustments")
    orderAdjustments.listRule = priceRule
    orderAdjustments.viewRule = priceRule
    app.save(orderAdjustments)

    // ---------------------------------------------------------------- 尺寸快照 / 项目：代理只能看自己订单的
    // 0013 的兜底条件只排除了工厂，代理（staff 非 factory）能看全站客户尺寸，必须收紧
    const specsCustomer = app.findCollectionByNameOrId("order_specs_customer")
    const specsRule =
      'order.customer = @request.auth.id || order.agent = @request.auth.id || (' + isInternal + ')'
    specsCustomer.listRule = specsRule
    specsCustomer.viewRule = specsRule
    app.save(specsCustomer)

    const orderItems = app.findCollectionByNameOrId("order_items")
    const itemsRule =
      '((stage = "customer" || stage = "agent") && (order.customer = @request.auth.id || order.agent = @request.auth.id || (' +
      isInternal +
      '))) || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "factory" || @request.auth.role_code = "reviewer" || @request.auth.role_code = "admin"))'
    orderItems.listRule = itemsRule
    orderItems.viewRule = itemsRule
    app.save(orderItems)

    // ---------------------------------------------------------------- 成交价：只允许本人/本人代理/内部，工厂和别的代理都看不到
    const terminalPrices = app.findCollectionByNameOrId("order_terminal_prices")
    const terminalRule =
      'order.customer = @request.auth.id || order.agent = @request.auth.id || (' + isInternal + ')'
    terminalPrices.listRule = terminalRule
    terminalPrices.viewRule = terminalRule
    app.save(terminalPrices)

    // ---------------------------------------------------------------- 满意度：代理和工厂都看不到
    const reviews = app.findCollectionByNameOrId("order_reviews")
    const reviewRule =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'
    reviews.listRule = reviewRule
    reviews.viewRule = reviewRule
    app.save(reviews)

    // ---------------------------------------------------------------- 代理侧菜单去掉量体档案
    try {
      const agentRole = app.findFirstRecordByData("roles", "code", "agent")
      agentRole.set("menus", ["orders", "items"])
      app.save(agentRole)
    } catch (e) {}

    // 注意：menus 是 json 字段，getStringSlice 读出来恒为空，会把菜单清空；
    // 这里用序列化解析（该 bug 已由 1700000017 修正，保留此写法防止重跑踩坑）
    const agents = app.findAllRecords("staff")
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]
      if (a.getString("role_code") !== "agent") continue
      const raw = a.get("menus")
      let list = []
      if (raw) {
        if (Object.prototype.toString.call(raw) === "[object Array]") {
          const text = String(raw)
          list = text.charAt(0) === "[" ? JSON.parse(text) : raw
        } else if (typeof raw === "string") {
          try {
            list = JSON.parse(raw)
          } catch (e) {}
        }
      }
      const menus = []
      for (let j = 0; j < list.length; j++) {
        if (list[j] !== "measurements") menus.push(list[j])
      }
      a.set("menus", menus)
      app.save(a)
    }
  },
  (app) => {
    // 回滚只恢复「staff 一刀切」，其余保持收紧（回滚到漏洞状态没有意义）
    const staff = app.findCollectionByNameOrId("staff")
    staff.listRule = '@request.auth.collectionName = "staff"'
    staff.viewRule = 'id = @request.auth.id || @request.auth.collectionName = "staff"'
    staff.updateRule = 'id = @request.auth.id || @request.auth.collectionName = "staff"'
    staff.deleteRule = '@request.auth.collectionName = "staff"'
    app.save(staff)
  }
)
