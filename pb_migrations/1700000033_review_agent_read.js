/// <reference path="../pb_data/types.d.ts" />

// 代理也要能看到自己客户订单的贴合度打分：
// 否则代理提交后 load() 读不到 order_reviews，页面还是显示「未打分」。
migrate(
  (app) => {
    const reviews = app.findCollectionByNameOrId("order_reviews")
    reviews.listRule =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer" || (@request.auth.role_code = "agent" && order.agent = @request.auth.id))'
    reviews.viewRule = reviews.listRule
    app.save(reviews)
  },
  (app) => {
    const reviews = app.findCollectionByNameOrId("order_reviews")
    const rule =
      '@request.auth.collectionName = "staff" && (@request.auth.role_code = "admin" || @request.auth.role_code = "reviewer")'
    reviews.listRule = rule
    reviews.viewRule = rule
    app.save(reviews)
  }
)
