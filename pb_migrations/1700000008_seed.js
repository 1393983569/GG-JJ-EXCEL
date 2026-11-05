/// <reference path="../pb_data/types.d.ts" />

// 初始数据：三个价格版本、默认角色、默认量体字段、默认定制项目（客户版价格）
// 工厂版 / 代理版价格需在后台按实际成本填写
migrate(
  (app) => {
    // ---------------- 价格版本
    const pvCol = app.findCollectionByNameOrId("price_versions")
    const pvIds = {}
    const versions = [
      { code: "customer", name: "客户版", sort: 10 },
      { code: "factory", name: "工厂版", sort: 20 },
      { code: "agent", name: "代理版", sort: 30 },
    ]
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i]
      const r = new Record(pvCol)
      r.set("name", v.name)
      r.set("code", v.code)
      r.set("sort", v.sort)
      r.set("is_active", true)
      app.save(r)
      pvIds[v.code] = r.id
    }

    // ---------------- 角色
    const roleCol = app.findCollectionByNameOrId("roles")
    const roles = [
      {
        code: "admin",
        name: "超级管理员",
        version: "customer",
        all: true,
        menus: ["orders", "measurements", "items", "measure_fields", "price_versions", "roles", "users"],
      },
      {
        code: "factory",
        name: "工厂",
        version: "factory",
        all: false,
        menus: ["orders", "measurements"],
      },
      {
        code: "agent",
        name: "代理",
        version: "agent",
        all: false,
        menus: ["orders", "measurements", "items"],
      },
      {
        code: "customer",
        name: "客户",
        version: "customer",
        all: false,
        menus: [],
      },
    ]
    for (let i = 0; i < roles.length; i++) {
      const v = roles[i]
      const r = new Record(roleCol)
      r.set("name", v.name)
      r.set("code", v.code)
      r.set("price_version", pvIds[v.version])
      r.set("can_view_all_prices", v.all)
      r.set("menus", v.menus)
      r.set("is_active", true)
      app.save(r)
    }

    // ---------------- 量体字段分组
    const groupCol = app.findCollectionByNameOrId("measure_field_groups")
    const groupIds = {}
    const groups = [
      { key: "body", name: "体型", sort: 10 },
      { key: "finger", name: "手指长", sort: 20 },
      { key: "upper", name: "上肢", sort: 30 },
      { key: "torso", name: "躯干", sort: 40 },
      { key: "lower", name: "下肢", sort: 50 },
      { key: "length", name: "长度", sort: 60 },
    ]
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      const r = new Record(groupCol)
      r.set("name", g.name)
      r.set("sort", g.sort)
      r.set("is_active", true)
      app.save(r)
      groupIds[g.key] = r.id
    }

    // ---------------- 量体字段（顺序与导出模板一致）
    const fieldCol = app.findCollectionByNameOrId("measure_fields")
    const fields = [
      { key: "height", label: "身高", unit: "cm", type: "number", group: "body", sort: 10 },
      { key: "weight", label: "体重", unit: "kg", type: "number", group: "body", sort: 20 },
      { key: "gender", label: "性别", unit: "", type: "select", group: "body", sort: 30, options: ["男", "女"] },
      { key: "finger_middle", label: "中指", unit: "cm", type: "number", group: "finger", sort: 40, wrap: true },
      { key: "finger_thumb", label: "大拇指", unit: "cm", type: "number", group: "finger", sort: 50, wrap: true },
      { key: "finger_little", label: "小拇指", unit: "cm", type: "number", group: "finger", sort: 60, wrap: true },
      { key: "wrist", label: "手腕围", unit: "cm", type: "number", group: "upper", sort: 70 },
      { key: "forearm", label: "前臂围", unit: "cm", type: "number", group: "upper", sort: 80 },
      { key: "upper_arm", label: "上臂围", unit: "cm", type: "number", group: "upper", sort: 90 },
      { key: "head_circumference", label: "头围", unit: "cm", type: "number", group: "torso", sort: 100 },
      { key: "neck", label: "颈围", unit: "cm", type: "number", group: "torso", sort: 110 },
      { key: "chest", label: "胸围", unit: "cm", type: "number", group: "torso", sort: 120 },
      { key: "waist", label: "腰围", unit: "cm", type: "number", group: "torso", sort: 130 },
      { key: "hip", label: "臀围", unit: "cm", type: "number", group: "torso", sort: 140 },
      { key: "thigh", label: "大腿围", unit: "cm", type: "number", group: "lower", sort: 150 },
      { key: "knee", label: "膝盖围", unit: "cm", type: "number", group: "lower", sort: 160 },
      { key: "calf", label: "小腿围", unit: "cm", type: "number", group: "lower", sort: 170 },
      { key: "ankle", label: "脚踝围", unit: "cm", type: "number", group: "lower", sort: 180 },
      { key: "foot_length", label: "脚长", unit: "cm", type: "number", group: "lower", sort: 190 },
      { key: "throat_to_crotch", label: "咽喉-裆部", unit: "cm", type: "number", group: "length", sort: 200 },
      { key: "head_length", label: "头长", unit: "cm", type: "number", group: "length", sort: 210 },
      { key: "shoulder", label: "肩宽", unit: "cm", type: "number", group: "length", sort: 220 },
      { key: "arm_length", label: "手臂长", unit: "cm", type: "number", group: "length", sort: 230 },
      { key: "leg_length", label: "腿长", unit: "cm", type: "number", group: "length", sort: 240 },
      { key: "head_to_crotch", label: "头顶到裆部", unit: "cm", type: "number", group: "length", sort: 250 },
    ]
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      const r = new Record(fieldCol)
      r.set("key", f.key)
      r.set("label", f.label)
      r.set("unit", f.unit)
      r.set("type", f.type)
      r.set("group", groupIds[f.group])
      r.set("sort", f.sort)
      r.set("decimals", 0)
      r.set("required", false)
      r.set("in_export", true)
      r.set("wrap_parens", f.wrap === true)
      r.set("is_active", true)
      if (f.options) r.set("options", f.options)
      app.save(r)
    }

    // ---------------- 定制项目 + 客户版价格（单位：分）
    const itemCol = app.findCollectionByNameOrId("items")
    const priceCol = app.findCollectionByNameOrId("item_prices")
    const items = [
      { name: "基础价", category: "base", price: 30000, sort: 10 },
      { name: "打板费", category: "main", price: 3000, sort: 20 },
      { name: "手套", category: "main", price: 2000, sort: 30 },
      { name: "五指袜", category: "main", price: 4500, sort: 40 },
      { name: "头套", category: "main", price: 5000, sort: 50 },
      { name: "工艺费", category: "extra", price: 6500, sort: 60 },
      { name: "立体裆", category: "extra", price: 3000, sort: 70 },
      { name: "股沟", category: "extra", price: 3000, sort: 80 },
      { name: "JJ套", category: "extra", price: 3000, sort: 90 },
      { name: "义乳口袋", category: "extra", price: 5000, sort: 100 },
      { name: "挂脖义乳胸", category: "extra", price: 120000, sort: 110 },
      { name: "隐藏式拉链", category: "extra", price: 3000, sort: 120 },
      { name: "前侧+胯部拼接", category: "extra", price: 6000, sort: 130 },
    ]
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const r = new Record(itemCol)
      r.set("name", it.name)
      r.set("category", it.category)
      r.set("sort", it.sort)
      r.set("is_active", true)
      app.save(r)

      const p = new Record(priceCol)
      p.set("item", r.id)
      p.set("version", pvIds["customer"])
      p.set("price_cents", it.price)
      app.save(p)
    }
  },
  (app) => {
    // 回滚只删除种子数据，集合本身由各自的迁移负责
    const pvCol = app.findCollectionByNameOrId("price_versions")
    const codes = ["customer", "factory", "agent"]
    for (let i = 0; i < codes.length; i++) {
      try {
        const r = app.findFirstRecordByData("price_versions", "code", codes[i])
        app.delete(r)
      } catch (e) {}
    }
  }
)
