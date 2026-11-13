/// <reference path="../pb_data/types.d.ts" />

// 账号维度的项目配置单独建表，替掉 staff.item_overrides 那个 JSON 字段。
//
// 一个账号 × 一个项目 = 一行：别名、H5 三项开关、排序、效果图。
// 总部不占行：总部就是「虚拟代理」，配置仍放在 items 上（alias / h5_visible /
// h5_default / in_price / sort / image），代理没配的项自动跟随总部。
//
// 顺带把角色的菜单换成新的「我的店铺 / 总部店铺」（shop），
// 代理不再进字典页（items）。
migrate(
  (app) => {
    const staffId = app.findCollectionByNameOrId("staff").id
    const itemsId = app.findCollectionByNameOrId("items").id

    const settings = new Collection({
      name: "staff_item_settings",
      type: "base",
      fields: [
        {
          name: "staff",
          type: "relation",
          collectionId: staffId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        {
          name: "item",
          type: "relation",
          collectionId: itemsId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "alias", type: "text", max: 100 },
        { name: "h5_visible", type: "bool" },
        { name: "h5_default", type: "bool" },
        { name: "in_price", type: "bool" },
        // 0 表示跟随总部的排序
        { name: "sort", type: "number", onlyInt: true },
        {
          name: "image",
          type: "file",
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_staff_item_settings` ON `staff_item_settings` (`staff`, `item`)",
      ],
      // 内部看全部；代理只看自己账号的行（H5 取图走服务端下发的文件 token）
      listRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || staff = @request.auth.id)',
      viewRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || staff = @request.auth.id)',
      createRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || staff = @request.auth.id)',
      updateRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || staff = @request.auth.id)',
      deleteRule:
        '@request.auth.collectionName = "staff" && (@request.auth.role_code != "agent" || staff = @request.auth.id)',
    })
    app.save(settings)

    // ---------------------------------------------- 旧 JSON 覆盖值搬进新表
    // JSON 里只记了「改过的项」，没记的项当时是跟随总部：
    // 搬迁时缺的开关按总部当前值补齐，行为不变。
    function parseOverrides(raw) {
      if (!raw) return {}
      let text = ""
      try {
        text = typeof raw === "string" ? raw : String(raw)
      } catch (e) {
        return {}
      }
      if (!text || text.charAt(0) !== "{") return {}
      try {
        const obj = JSON.parse(text)
        return obj && typeof obj === "object" ? obj : {}
      } catch (e) {
        return {}
      }
    }

    const itemDefaults = {}
    const allItems = app.findAllRecords("items")
    for (let i = 0; i < allItems.length; i++) {
      itemDefaults[allItems[i].id] = {
        visible: allItems[i].getBool("h5_visible"),
        isDefault: allItems[i].getBool("h5_default"),
        inPrice: allItems[i].getBool("in_price"),
      }
    }

    const staffRows = app.findAllRecords("staff")
    for (let s = 0; s < staffRows.length; s++) {
      const staffRec = staffRows[s]
      const ov = parseOverrides(staffRec.get("item_overrides"))
      const keys = Object.keys(ov)
      for (let k = 0; k < keys.length; k++) {
        const itemId = keys[k]
        const one = ov[itemId]
        if (!one || !itemDefaults[itemId]) continue
        const def = itemDefaults[itemId]
        const rec = new Record(settings)
        rec.set("staff", staffRec.id)
        rec.set("item", itemId)
        if (one.alias) rec.set("alias", String(one.alias))
        rec.set("h5_visible", one.h5_visible === undefined ? def.visible : one.h5_visible === true)
        rec.set("h5_default", one.h5_default === undefined ? def.isDefault : one.h5_default === true)
        rec.set("in_price", one.in_price === undefined ? def.inPrice : one.in_price !== false)
        app.save(rec)
      }
    }

    // 旧字段退场：写入统一走 staff_item_settings，避免两套数据打架
    const staff = app.findCollectionByNameOrId("staff")
    staff.fields.removeByName("item_overrides")
    app.save(staff)

    // ---------------------------------------------- 角色菜单：新增 shop
    // 代理：进「我的店铺」，不进字典；内部：字典 + 总部店铺都保留
    try {
      const roles = app.findAllRecords("roles")
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i]
        const code = role.getString("code")
        const menus = role.get("menus")
        let list = []
        try {
          list = typeof menus === "string" ? JSON.parse(menus) : JSON.parse(String(menus))
        } catch (e) {
          list = []
        }
        if (!Array.isArray(list)) list = []
        if (code === "agent") {
          list = list.filter(function (m) { return m !== "items" })
        }
        if (code === "agent" || code === "admin" || code === "reviewer") {
          if (list.indexOf("shop") < 0) list.push("shop")
        }
        role.set("menus", list)
        app.save(role)
      }
    } catch (e) {
      console.log("[staff_item_settings] role menus update failed: " + String(e))
    }
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("staff_item_settings"))
    } catch (e) {}
    const staff = app.findCollectionByNameOrId("staff")
    if (!staff.fields.getByName("item_overrides")) {
      staff.fields.add(new JSONField({ name: "item_overrides", maxSize: 64000 }))
    }
    app.save(staff)
  }
)
