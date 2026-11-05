/// <reference path="../pb_data/types.d.ts" />

// 量体字段配置：后台可增删改，key 一经创建不可变更（历史数据靠它定位）
migrate(
  (app) => {
    const groups = new Collection({
      name: "measure_field_groups",
      type: "base",
      fields: [
        { name: "name", type: "text", required: true, max: 50 },
        { name: "sort", type: "number", onlyInt: true, min: 0 },
        { name: "is_active", type: "bool" },
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.collectionName = "staff"',
      updateRule: '@request.auth.collectionName = "staff"',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(groups)

    const fields = new Collection({
      name: "measure_fields",
      type: "base",
      fields: [
        {
          name: "group",
          type: "relation",
          collectionId: groups.id,
          maxSelect: 1,
        },
        // 机器标识，创建后禁止修改
        { name: "key", type: "text", required: true, max: 40 },
        { name: "label", type: "text", required: true, max: 50 },
        // 单位：cm / kg / 空
        { name: "unit", type: "text", max: 10 },
        { name: "type", type: "select", values: ["number", "text", "select"], maxSelect: 1, required: true },
        // type=select 时的可选项，如 ["男","女"]
        { name: "options", type: "json", maxSize: 2000 },
        { name: "required", type: "bool" },
        // 小数位，通常 0 或 1
        { name: "decimals", type: "number", onlyInt: true, min: 0, max: 3 },
        { name: "sort", type: "number", onlyInt: true, min: 0 },
        { name: "in_export", type: "bool" },
        // 导出时用括号包裹子项：手指长(中指: 9cm，大拇指: 6cm)
        { name: "wrap_parens", type: "bool" },
        { name: "is_active", type: "bool" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_measure_fields_key` ON `measure_fields` (`key`)",
      ],
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.collectionName = "staff"',
      updateRule: '@request.auth.collectionName = "staff"',
      deleteRule: '@request.auth.collectionName = "staff"',
    })
    app.save(fields)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("measure_fields"))
    app.delete(app.findCollectionByNameOrId("measure_field_groups"))
  }
)
