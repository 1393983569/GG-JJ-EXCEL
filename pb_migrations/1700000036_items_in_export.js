/// <reference path="../pb_data/types.d.ts" />

// 定制项目是否进 Word 导出。
// bool 字段没有默认值，老项目补成 true，保持升级前「全部导出」的表现。
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("in_export")) {
      items.fields.add(new BoolField({ name: "in_export" }))
    }
    app.save(items)

    const all = app.findAllRecords("items")
    for (let i = 0; i < all.length; i++) {
      const rec = all[i]
      if (!rec.getBool("in_export")) {
        rec.set("in_export", true)
        app.save(rec)
      }
    }
  },
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("in_export")
    app.save(items)
  }
)
