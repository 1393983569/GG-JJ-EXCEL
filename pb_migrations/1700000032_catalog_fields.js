/// <reference path="../pb_data/types.d.ts" />

// 定制参数从项目挪到品类。
//
// 一个品类 = 一套打版方案，要量哪些尺寸是这个品类固定的事：
//   衣服 → 身高/体重/胸围…（通用的设必填，手指长这种设选填）
//   床垫 → 身高
//   袜子 → 脚长
// 项目只负责名称、价格、规格，不再各自声明尺寸。
//
// 回填：把该品类下所有项目绑定的字段取并集写到品类上（迁移前每个项目都是全量，
// 所以结果就是当前的衣服字段集），然后把 items.fields 退场。
migrate(
  (app) => {
    const catalogs = app.findCollectionByNameOrId("catalogs")
    if (!catalogs.fields.getByName("fields")) {
      catalogs.fields.add(new JSONField({ name: "fields", maxSize: 64000 }))
    }
    app.save(catalogs)

    // 按品类合并项目上的绑定：key 去重，必填取或，排序取最小
    const merged = {}
    const itemRows = app.findAllRecords("items")
    for (let i = 0; i < itemRows.length; i++) {
      const it = itemRows[i]
      const cat = it.getString("catalog") || "衣服"
      let list = []
      try {
        const parsed = JSON.parse(String(it.get("fields") || "[]"))
        list = Array.isArray(parsed) ? parsed : []
      } catch (e) {
        list = []
      }
      if (!merged[cat]) merged[cat] = {}
      for (let j = 0; j < list.length; j++) {
        const b = list[j] || {}
        const key = String(b.key || "")
        if (!key) continue
        const sort = Number(b.sort) || 0
        const cur = merged[cat][key]
        if (!cur) {
          merged[cat][key] = { key: key, required: b.required === true, sort: sort }
        } else {
          if (sort < cur.sort) cur.sort = sort
          if (b.required === true) cur.required = true
        }
      }
    }

    const catRows = app.findAllRecords("catalogs")
    for (let i = 0; i < catRows.length; i++) {
      const rec = catRows[i]
      const name = rec.getString("name")
      const map = merged[name] || {}
      const keys = Object.keys(map)
      const list = []
      for (let k = 0; k < keys.length; k++) list.push(map[keys[k]])
      list.sort(function (a, b) {
        return a.sort - b.sort
      })
      rec.set("fields", list)
      app.save(rec)
    }

    // 项目上的绑定退场：再留一份就是两个来源，迟早对不上
    const items = app.findCollectionByNameOrId("items")
    items.fields.removeByName("fields")
    app.save(items)
  },
  (app) => {
    const items = app.findCollectionByNameOrId("items")
    if (!items.fields.getByName("fields")) {
      items.fields.add(new JSONField({ name: "fields", maxSize: 64000 }))
      app.save(items)
    }
    const catalogs = app.findCollectionByNameOrId("catalogs")
    catalogs.fields.removeByName("fields")
    app.save(catalogs)
  }
)
