/// <reference path="../pb_data/types.d.ts" />

// 「量体档案」的删除一律做假删除：orders.measurement 还指着它，
// 真删会让订单变成断链，后续改状态/导出都取不到数据。
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("measurements")
    if (!col.fields.getByName("is_deleted")) {
      col.fields.add(new BoolField({ name: "is_deleted" }))
    }
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId("measurements")
    col.fields.removeByName("is_deleted")
    app.save(col)
  }
)
