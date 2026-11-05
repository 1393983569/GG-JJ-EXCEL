/// <reference path="../pb_data/types.d.ts" />

// 「定制项目」的删除一律做假删除：记录保留，只置 is_deleted + is_active=false。
// 原因：order_items / order_prices 里引用了项目，历史订单还要能看；
// item_prices 又是 cascadeDelete，真删会连价格行一起没了。
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("is_deleted")) {
      items.fields.add(new BoolField({ name: "is_deleted" }))
    }
    app.save(items)
  },
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("is_deleted")
    app.save(items)
  }
)
