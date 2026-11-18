/// <reference path="../pb_data/types.d.ts" />

// 多品类：衣服、床垫、袜子共用一套下单流程。
//
//   items.catalog   品类名（衣服 / 床垫 / 袜子…），空 = 衣服
//   items.fields    这个项目需要的定制参数 [{ key, required, sort }]，key 指向 measure_fields.key
//                   空数组 = 不需要任何参数（基础价、改衣、配件）
//   orders.catalog  下单时按项目冗余，列表筛选与导出裁列用
//   orders.batch_no 一次结算拆成多张单时共用同一个批次号
//
// 为什么参数绑在项目上、而不是单独建「分类 → 字段」表：
// 一个品类需要哪些参数 = 该品类下可见项目的并集，算出来的东西不用存第二份，
// 改项目就是改品类，不会出现「分类说要、项目说不要」的两套数据打架。
//
// 尺码库（measurements.data）不绑品类：一份档案存全部 key，下单时只取本单项目声明的那些。
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("catalog")) {
      items.fields.add(new TextField({ name: "catalog", max: 50 }))
    }
    if (!items.fields.getByName("fields")) {
      items.fields.add(new JSONField({ name: "fields", maxSize: 64000 }))
    }
    app.save(items)

    const orders = app.findCollectionByNameOrId("orders")
    if (!orders.fields.getByName("catalog")) {
      orders.fields.add(new TextField({ name: "catalog", max: 50 }))
    }
    if (!orders.fields.getByName("batch_no")) {
      orders.fields.add(new TextField({ name: "batch_no", max: 40 }))
    }
    app.save(orders)

    // ---------------------------------------------- 回填
    // 现有项目全是服装：绑定当前全部启用字段，字段集合与改造前完全一致。
    // required 统一 false：改造前一个必填都没有，别在这一步开始拦单。
    const bindings = []
    const fieldRows = app.findAllRecords("measure_fields")
    for (let i = 0; i < fieldRows.length; i++) {
      const f = fieldRows[i]
      if (!f.getBool("is_active")) continue
      bindings.push({
        key: f.getString("key"),
        required: false,
        sort: f.getInt("sort"),
      })
    }
    bindings.sort(function (a, b) {
      return a.sort - b.sort
    })

    const itemRows = app.findAllRecords("items")
    for (let i = 0; i < itemRows.length; i++) {
      const it = itemRows[i]
      if (!it.getString("catalog")) it.set("catalog", "衣服")
      let own = []
      try {
        const parsed = JSON.parse(String(it.get("fields") || "[]"))
        own = Array.isArray(parsed) ? parsed : []
      } catch (e) {
        own = []
      }
      if (!own.length) it.set("fields", bindings)
      app.save(it)
    }
  },
  (app) => {
    const orders = app.findCollectionByNameOrId("orders")
    orders.fields.removeByName("batch_no")
    orders.fields.removeByName("catalog")
    app.save(orders)

    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("fields")
    items.fields.removeByName("catalog")
    app.save(items)
  }
)
