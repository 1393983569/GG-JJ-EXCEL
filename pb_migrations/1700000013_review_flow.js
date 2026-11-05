/// <reference path="../pb_data/types.d.ts" />

// 引入审核流程 + 角色化数据隔离。
//
// 核心：PocketBase 只有记录级权限，无法隐藏"同一行里的某些字段"。
// 所以把敏感数据拆成独立集合，用记录级 Rules 让"看不见"变成 SQL 层查不到：
//   order_specs_customer  客户原始尺寸   -> 客户 / 代理 / 审核 / 管理员
//   order_specs_production 审核后生产尺寸 -> 工厂 / 审核 / 管理员
//   order_items(stage)     项目原始/最终  -> 按 stage 区分
//   order_reviews          满意度打分     -> 审核 / 代理 / 管理员
//   order_logs             操作日志       -> 审核 / 管理员
//
// 旧字段 measurement_snapshot / items_snapshot 直接删除（测试数据，不迁移）。
migrate(
  (app) => {
    // 放在回调内部，避免依赖文件顶层作用域（PB 的 JSVM 作用域隔离）
    function relIdSafe(rec, name) {
      try {
        const arr = rec.getStringSlice(name)
        if (arr && arr.length > 0) return arr[0]
      } catch (e) {}
      try {
        return rec.getString(name) || ""
      } catch (e) {
        return ""
      }
    }

    const ordersId = app.findCollectionByNameOrId("orders").id
    const staffId = app.findCollectionByNameOrId("staff").id
    const itemsId = app.findCollectionByNameOrId("items").id

    // ------------------------------------------------ staff 冗余角色标识
    // 规则表达式里无法跨多层关联判断角色，这里冗余一个 role_code 便于比较
    const staff = app.findCollectionByNameOrId("staff")
    if (!staff.fields.getByName("role_code")) {
      staff.fields.add(new TextField({ name: "role_code", max: 32 }))
    }
    app.save(staff)

    // ------------------------------------------------ orders 字段调整
    const orders = app.findCollectionByNameOrId("orders")

    // fields.add 需要 Field 实例，传普通对象会报错
    if (!orders.fields.getByName("agent")) {
      orders.fields.add(new RelationField({ name: "agent", collectionId: staffId, maxSelect: 1 }))
    }
    if (!orders.fields.getByName("review_status")) {
      orders.fields.add(
        new SelectField({
          name: "review_status",
          values: ["pending", "approved", "rejected"],
          maxSelect: 1,
        })
      )
    }
    if (!orders.fields.getByName("reviewer")) {
      orders.fields.add(new RelationField({ name: "reviewer", collectionId: staffId, maxSelect: 1 }))
    }
    if (!orders.fields.getByName("reviewed_at")) {
      orders.fields.add(new DateField({ name: "reviewed_at" }))
    }

    // 删掉旧的内联快照字段（客户原始尺寸/项目已拆到独立集合）
    orders.fields.removeByName("measurement_snapshot")
    orders.fields.removeByName("items_snapshot")

    // 客户只读，代理只读；能改订单的只有审核员和管理员
    orders.updateRule =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin")'
    orders.deleteRule =
      '@request.auth.collectionName = "staff" && @request.auth.role_code = "admin"'
    // 代理只能看到分配给自己的订单
    orders.listRule =
      'customer = @request.auth.id || agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "agent")'
    orders.viewRule = orders.listRule

    app.save(orders)

    // ------------------------------------------------ 客户原始尺寸
    const specsCustomer = new Collection({
      name: "order_specs_customer",
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
        { name: "data", type: "json", maxSize: 64000 },
        { name: "text", type: "text", max: 8000 },
        { name: "fabric", type: "text", max: 200 },
        { name: "remark", type: "text", max: 2000 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_specs_customer_order` ON `order_specs_customer` (`order`)",
      ],
      // 工厂看不到客户原始尺寸
      listRule:
        'order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory")',
      viewRule:
        'order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory")',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(specsCustomer)

    // ------------------------------------------------ 审核后生产尺寸
    const specsProduction = new Collection({
      name: "order_specs_production",
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
        { name: "data", type: "json", maxSize: 64000 },
        { name: "text", type: "text", max: 8000 },
        { name: "fabric", type: "text", max: 200 },
        { name: "production_remark", type: "text", max: 2000 },
        { name: "reject_reason", type: "text", max: 500 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_specs_production_order` ON `order_specs_production` (`order`)",
      ],
      // 客户和代理都看不到生产尺寸
      listRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code = "factory" || @request.auth.role_code = "reviewer" || @request.auth.role_code = "admin")',
      viewRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code = "factory" || @request.auth.role_code = "reviewer" || @request.auth.role_code = "admin")',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(specsProduction)

    // ------------------------------------------------ 订单项目（分阶段）
    const orderItems = new Collection({
      name: "order_items",
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
        // customer 客户原始选择 / final 审核后最终项目
        { name: "stage", type: "select", values: ["customer", "final"], maxSelect: 1, required: true },
        { name: "item", type: "relation", collectionId: itemsId, maxSelect: 1 },
        { name: "name", type: "text", max: 100 },
        { name: "category", type: "text", max: 20 },
        { name: "qty", type: "number", onlyInt: true, min: 0 },
        { name: "sort", type: "number", onlyInt: true },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX `idx_order_items_order_stage` ON `order_items` (`order`, `stage`)"],
      listRule:
        '(stage = "customer" && (order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory"))) || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "factory" || @request.auth.role_code = "reviewer" || @request.auth.role_code = "admin"))',
      viewRule:
        '(stage = "customer" && (order.customer = @request.auth.id || order.agent = @request.auth.id || (@request.auth.collectionName = "staff" && @request.auth.role_code != "factory"))) || (stage = "final" && @request.auth.collectionName = "staff" && (@request.auth.role_code = "factory" || @request.auth.role_code = "reviewer" || @request.auth.role_code = "admin"))',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(orderItems)

    // ------------------------------------------------ 满意度打分
    const reviews = new Collection({
      name: "order_reviews",
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
        { name: "score", type: "number", onlyInt: true, min: 1, max: 10 },
        { name: "remark", type: "text", max: 500 },
        { name: "operator", type: "relation", collectionId: staffId, maxSelect: 1 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX `idx_order_reviews_order` ON `order_reviews` (`order`)"],
      // 客户和工厂都看不到满意度
      listRule:
        '@request.auth.collectionName = "staff" && @request.auth.role_code != "factory"',
      viewRule:
        '@request.auth.collectionName = "staff" && @request.auth.role_code != "factory"',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(reviews)

    // ------------------------------------------------ 操作日志
    const logs = new Collection({
      name: "order_logs",
      type: "base",
      fields: [
        {
          name: "order",
          type: "relation",
          collectionId: ordersId,
          maxSelect: 1,
          cascadeDelete: true,
        },
        { name: "operator", type: "relation", collectionId: staffId, maxSelect: 1 },
        { name: "action", type: "text", max: 50 },
        { name: "detail", type: "json", maxSize: 8000 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE INDEX `idx_order_logs_order` ON `order_logs` (`order`)"],
      listRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin")',
      viewRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code = "reviewer" || @request.auth.role_code = "admin")',
      createRule: null,
      updateRule: null,
      deleteRule: null,
    })
    app.save(logs)

    // ------------------------------------------------ 新增审核员角色 + 回填 role_code
    let reviewerRoleId = ""
    try {
      reviewerRoleId = app.findFirstRecordByData("roles", "code", "reviewer").id
    } catch (e) {
      const pv = app.findFirstRecordByData("price_versions", "code", "customer")
      const role = new Record(app.findCollectionByNameOrId("roles"))
      role.set("name", "审核员")
      role.set("code", "reviewer")
      role.set("price_version", pv.id)
      role.set("can_view_all_prices", true)
      role.set("menus", ["orders", "measurements", "items"])
      role.set("is_active", true)
      app.save(role)
      reviewerRoleId = role.id
    }

    // 已有角色补上菜单（审核员/工厂等按需求收敛）
    const menuByCode = {
      admin: ["orders", "measurements", "items", "measure_fields", "price_versions", "roles", "users"],
      reviewer: ["orders", "measurements", "items"],
      agent: ["orders", "measurements"],
      factory: ["orders"],
      customer: [],
    }
    try {
      const allRoles = app.findAllRecords("roles")
      for (let i = 0; i < allRoles.length; i++) {
        const r = allRoles[i]
        const code = r.getString("code")
        if (menuByCode[code]) r.set("menus", menuByCode[code])
        app.save(r)
      }
    } catch (e) {}

    // 已有 staff 账号回填 role_code
    try {
      const allStaff = app.findAllRecords("staff")
      for (let i = 0; i < allStaff.length; i++) {
        const s = allStaff[i]
        if (s.getString("role_code")) continue
        const roleId = relIdSafe(s, "role")
        if (!roleId) continue
        try {
          const r = app.findRecordById("roles", roleId)
          s.set("role_code", r.getString("code"))
          app.save(s)
        } catch (e) {}
      }
    } catch (e) {}
  },
  (app) => {
    // 回滚只删新建集合，orders 字段不回滚（避免丢数据）
    const names = [
      "order_logs",
      "order_reviews",
      "order_items",
      "order_specs_production",
      "order_specs_customer",
    ]
    for (let i = 0; i < names.length; i++) {
      try {
        app.delete(app.findCollectionByNameOrId(names[i]))
      } catch (e) {}
    }
  }
)

