/// <reference path="../pb_data/types.d.ts" />

// 备注支持富文本（图片 / 加粗 / 颜色 / 字号），存到 remark 字段里的是一小段 HTML。
//
// 图片单独落在 remark_images，HTML 里只放文件 URL：
//   <img src="https://域名/api/files/remark_images/xxxx/yyyy.png" />
// 这样 remark 字段不会被 base64 撑爆，列表接口也不会一次拉几 MB。
//
// 该集合允许公开读取（viewRule 为空）：备注图片要在后台、H5 订单详情里长期直接显示，
// 走 file token 会过期。文件名带随机记录 ID，不可枚举；写入仍要求登录。
migrate(
  (app) => {
    const collection = new Collection({
      name: "remark_images",
      type: "base",
      fields: [
        {
          name: "file",
          type: "file",
          maxSelect: 1,
          required: true,
          maxSize: 5242880,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"],
        },
      ],
      listRule: null,
      viewRule: "",
      createRule: '@request.auth.id != ""',
      updateRule: null,
      deleteRule: null,
    })
    app.save(collection)

    // 富文本比纯文本长，2000 字符放不下几张图（每张 URL 约 100 字符）
    ;["measurements", "orders", "order_specs_customer"].forEach((name) => {
      const col = app.findCollectionByNameOrId(name)
      const field = col.fields.getByName("remark")
      if (field) {
        field.max = 5000
        app.save(col)
      }
    })
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("remark_images"))
  }
)
