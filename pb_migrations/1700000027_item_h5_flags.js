/// <reference path="../pb_data/types.d.ts" />

// 项目在下单页（H5）的三个开关 + 代理自定义。
//
// items.h5_visible   H5 是否显示
// items.h5_default   H5 默认勾选（原来写死「基础价默认选中」，改成按项目配）
// items.in_price     是否计入 H5 合计（不计价的项目照样下单、照样生产，只是客户版价格按 0 算）
//
// staff.item_overrides 代理给自己名下的客户改这些属性：
//   { "<itemId>": { "alias": "显瘦打底衣", "h5_visible": false, "h5_default": true, "in_price": false } }
//   只存和全局不同的部分，缺省就跟随 items 上的全局值。
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("h5_visible")) {
      items.fields.add(new BoolField({ name: "h5_visible" }))
    }
    if (!items.fields.getByName("h5_default")) {
      items.fields.add(new BoolField({ name: "h5_default" }))
    }
    if (!items.fields.getByName("in_price")) {
      items.fields.add(new BoolField({ name: "in_price" }))
    }
    app.save(items)

    // bool 字段没有默认值，读出来是 false：
    // 老项目补成「可见 + 计价」，基础价补成「默认选中」，保持原来下单页的表现
    const all = app.findAllRecords("items")
    for (let i = 0; i < all.length; i++) {
      const rec = all[i]
      rec.set("h5_visible", true)
      rec.set("in_price", true)
      rec.set("h5_default", rec.getString("category") === "base")
      app.save(rec)
    }

    const staff = app.findCollectionByNameOrId("staff")
    if (!staff.fields.getByName("item_overrides")) {
      staff.fields.add(new JSONField({ name: "item_overrides", maxSize: 64000 }))
    }
    app.save(staff)
  },
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("h5_visible")
    items.fields.removeByName("h5_default")
    items.fields.removeByName("in_price")
    app.save(items)

    const staff = app.findCollectionByNameOrId("staff")
    staff.fields.removeByName("item_overrides")
    app.save(staff)
  }
)
