/// <reference path="../pb_data/types.d.ts" />

// 定制项目新增「勾选型 / 数量型」配置：
//   qty_mode = check 勾选型：选中即 1 份，没有数量、没有单位
//   qty_mode = qty   数量型：选中后可改数量，数量最小 1，展示时拼上单位
//
// order_items 里同步快照 qty_mode / unit：
// 后台改项目配置只影响之后的新订单，已存在的订单按自己的快照走。
migrate(
  (app) => {
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

    // ------------------------------------------------ items 配置字段
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("qty_mode")) {
      items.fields.add(
        new SelectField({ name: "qty_mode", values: ["check", "qty"], maxSelect: 1 })
      )
    }
    if (!items.fields.getByName("unit")) {
      items.fields.add(new TextField({ name: "unit", max: 10 }))
    }
    app.save(items)

    // 默认全部勾选型；按需求把示例项目先配好
    const seed = {
      手套: { qty_mode: "qty", unit: "对" },
      五指袜: { qty_mode: "check", unit: "" },
      打板费: { qty_mode: "check", unit: "" },
    }
    const allItems = app.findAllRecords("items")
    for (let i = 0; i < allItems.length; i++) {
      const r = allItems[i]
      const preset = seed[r.getString("name")]
      if (!r.getString("qty_mode")) {
        r.set("qty_mode", preset ? preset.qty_mode : "check")
      }
      if (preset && preset.unit && !r.getString("unit")) {
        r.set("unit", preset.unit)
      }
      app.save(r)
    }

    // ------------------------------------------------ 订单项目快照字段
    const orderItems = app.findCollectionByNameOrId("order_items")
    if (!orderItems.fields.getByName("unit")) {
      orderItems.fields.add(new TextField({ name: "unit", max: 10 }))
    }
    if (!orderItems.fields.getByName("qty_mode")) {
      orderItems.fields.add(new TextField({ name: "qty_mode", max: 20 }))
    }
    app.save(orderItems)

    // 历史订单补齐快照：数量 > 1 的按数量型保留原有数量，避免重算时被压成 1 份
    const meta = {}
    const freshItems = app.findAllRecords("items")
    for (let i = 0; i < freshItems.length; i++) {
      meta[freshItems[i].id] = {
        qty_mode: freshItems[i].getString("qty_mode") || "check",
        unit: freshItems[i].getString("unit") || "",
      }
    }
    const rows = app.findAllRecords("order_items")
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const m = meta[relIdSafe(r, "item")] || { qty_mode: "check", unit: "" }
      const qty = r.getInt("qty")
      const mode = qty > 1 ? "qty" : m.qty_mode
      r.set("qty_mode", mode)
      r.set("unit", mode === "qty" ? m.unit : "")
      app.save(r)
    }
  },
  (app) => {
    const orderItems = app.findCollectionByNameOrId("order_items")
    orderItems.fields.removeByName("unit")
    orderItems.fields.removeByName("qty_mode")
    app.save(orderItems)

    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("unit")
    items.fields.removeByName("qty_mode")
    app.save(items)
  }
)
