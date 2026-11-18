/// <reference path="../pb_data/types.d.ts" />

// 品类的尺寸绑定增加 in_export：同一个尺寸字段在不同品类里可以分别决定要不要进 Word。
// catalogs.fields = [{ key, required, sort, in_export }]
migrate(
  (app) => {
    const catalogs = app.findCollectionByNameOrId("catalogs")
    const all = app.findAllRecords("catalogs")
    for (let i = 0; i < all.length; i++) {
      const rec = all[i]
      let fields = []
      try {
        const parsed = JSON.parse(String(rec.get("fields") || "[]"))
        fields = Array.isArray(parsed) ? parsed : []
      } catch (e) {
        fields = []
      }
      let changed = false
      for (let j = 0; j < fields.length; j++) {
        const f = fields[j]
        if (f && typeof f === "object" && f.in_export === undefined) {
          f.in_export = true
          changed = true
        }
      }
      if (changed) {
        rec.set("fields", fields)
        app.save(rec)
      }
    }
  },
  (app) => {
    const catalogs = app.findCollectionByNameOrId("catalogs")
    const all = app.findAllRecords("catalogs")
    for (let i = 0; i < all.length; i++) {
      const rec = all[i]
      let fields = []
      try {
        const parsed = JSON.parse(String(rec.get("fields") || "[]"))
        fields = Array.isArray(parsed) ? parsed : []
      } catch (e) {
        fields = []
      }
      for (let j = 0; j < fields.length; j++) {
        const f = fields[j]
        if (f && typeof f === "object") delete f.in_export
      }
      rec.set("fields", fields)
      app.save(rec)
    }
  }
)
