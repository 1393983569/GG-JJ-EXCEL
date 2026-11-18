/// <reference path="../pb_data/types.d.ts" />

// 品类字典：衣服 / 床垫 / 袜子…
//
// 之前品类是 items 上的自由文本，新建项目打字打错就会多出一个品类，
// H5 首页还会凭空多一张入口卡片。这里改成字典表：
//   - 后台只能从字典里选，不能现敲；
//   - 字典管顺序（H5 首页/下单页 tab 的顺序）和停用（暂时不卖的品类直接隐藏）；
//   - 改名时顺手把 items.catalog 一起刷掉。
//
// items.catalog 仍然是字符串，不做 relation：订单里存的是下单时的快照，
// 品类改名不该影响历史订单，也不值得为此动一遍订单模型。
migrate(
  (app) => {
    const catalogs = new Collection({
      name: "catalogs",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true, max: 50 },
        { name: "sort", type: "number", onlyInt: true, min: 0 },
        { name: "is_active", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_catalogs_name` ON `catalogs` (`name`)"],
      // 客户也要读（H5 靠它排品类顺序），只有内部能改
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.collectionName = "staff"',
      updateRule: '@request.auth.collectionName = "staff"',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(catalogs)

    // 种子：把现有项目里出现过的品类收进来，衣服永远排第一
    const names = ["衣服"]
    const itemRows = app.findAllRecords("items")
    for (let i = 0; i < itemRows.length; i++) {
      const c = itemRows[i].getString("catalog") || "衣服"
      if (names.indexOf(c) < 0) names.push(c)
    }
    for (let i = 0; i < names.length; i++) {
      const rec = new Record(catalogs)
      rec.set("name", names[i])
      rec.set("sort", (i + 1) * 10)
      rec.set("is_active", true)
      app.save(rec)
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("catalogs"))
    } catch (e) {}
  }
)
