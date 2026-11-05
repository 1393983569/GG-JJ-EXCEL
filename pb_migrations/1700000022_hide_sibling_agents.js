/// <reference path="../pb_data/types.d.ts" />

// 代理之间不能互相看见对方存在。
// price_versions 原来对 staff 全开放，代理能列出「代理版-张三」「代理版-李四」，
// 等于告诉客户「这两个代理是同一套系统里的」。
// 改成：内部人员看全部，代理只看自己绑定的那一版。
migrate(
  (app) => {
    const col = app.findCollectionByNameOrId("price_versions")
    col.listRule =
      '@request.auth.collectionName = "staff" && (@request.auth.can_view_all_prices = true || @request.auth.role_code != "agent" || id = @request.auth.price_version)'
    col.viewRule = col.listRule
    app.save(col)
  },
  (app) => {
    const col = app.findCollectionByNameOrId("price_versions")
    col.listRule = '@request.auth.collectionName = "staff"'
    col.viewRule = col.listRule
    app.save(col)
  }
)
