/// <reference path="../pb_data/types.d.ts" />

// PocketBase 的 new Collection() 不会自动带 created/updated，
// 需要在迁移里显式声明 autodate 字段，否则：
//   - 列表按 -created 排序无效
//   - 订单下单时间、量体更新时间显示为空
//   - 导出里的时间字段取不到
migrate(
  (app) => {
    const tables = [
      "price_versions",
      "roles",
      "customers",
      "staff",
      "items",
      "item_prices",
      "measure_field_groups",
      "measure_fields",
      "measurements",
      "orders",
      "order_prices",
      "order_adjustments",
    ]

    for (let i = 0; i < tables.length; i++) {
      let col
      try {
        col = app.findCollectionByNameOrId(tables[i])
      } catch (e) {
        continue
      }

      if (!col.fields.getByName("created")) {
        col.fields.add(
          new AutodateField({
            name: "created",
            onCreate: true,
            onUpdate: false,
          })
        )
      }

      if (!col.fields.getByName("updated")) {
        col.fields.add(
          new AutodateField({
            name: "updated",
            onCreate: true,
            onUpdate: true,
          })
        )
      }

      app.save(col)
    }
  },
  (app) => {
    // 回滚不删除时间字段，避免影响已写入的数据
  }
)
