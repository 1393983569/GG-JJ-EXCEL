/// <reference path="../pb_data/types.d.ts" />

// 1700000015 里用 getStringSlice 读 staff.menus（json 字段）读成了空数组，
// 把已有账号的菜单清空了，导致登录后左侧菜单空白。这里按角色模板回填。
migrate(
  (app) => {
    // json 字段在 JSVM 里可能是 JSONRaw（[]byte），必须走序列化再解析
    function readJsonArray(rec, name) {
      const raw = rec.get(name)
      if (!raw) return []
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw)
        } catch (e) {
          return []
        }
      }
      if (Object.prototype.toString.call(raw) === "[object Array]") {
        const text = String(raw)
        if (text.charAt(0) === "[") {
          try {
            return JSON.parse(text)
          } catch (e) {
            return []
          }
        }
        return raw
      }
      return []
    }

    const staffs = app.findAllRecords("staff")
    for (let i = 0; i < staffs.length; i++) {
      const s = staffs[i]
      let menus = readJsonArray(s, "menus")
      const roleCode = s.getString("role_code")

      if (!menus.length) {
        let roleMenus = []
        const roleId = s.getString("role")
        if (roleId) {
          try {
            roleMenus = readJsonArray(app.findRecordById("roles", roleId), "menus")
          } catch (e) {}
        }
        menus = roleMenus
      }

      // 代理不需要量体档案
      if (roleCode === "agent") {
        const filtered = []
        for (let j = 0; j < menus.length; j++) {
          if (menus[j] !== "measurements") filtered.push(menus[j])
        }
        menus = filtered
      }

      s.set("menus", menus)
      app.save(s)
    }
  },
  (app) => {}
)
