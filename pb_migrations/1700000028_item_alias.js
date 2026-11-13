/// <reference path="../pb_data/types.d.ts" />

// 总部的 H5 展示名：没有代理归属的直客用它。
//
// 之前别名只能挂在代理账号上（staff.item_overrides），管理员/审核员自己的直客
// 没有地方起名，只能看项目原名。这里在 items 上加 alias：
//   直客        → items.alias || items.name
//   代理的客户  → 代理 item_overrides 里的别名 || items.alias || items.name
migrate(
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("alias")) {
      items.fields.add(new TextField({ name: "alias", max: 100 }))
    }
    app.save(items)
  },
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("alias")
    app.save(items)
  }
)
