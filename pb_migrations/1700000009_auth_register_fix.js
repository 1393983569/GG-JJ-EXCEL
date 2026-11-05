/// <reference path="../pb_data/types.d.ts" />

// 后台/客户端都用「账号（手机号）+ 密码」登录，不需要邮箱。
// PocketBase 的 auth 集合默认 email 必填、password 最少 10 位，
// 这里把两者放开，否则客户端注册会一直返回 400。
migrate(
  (app) => {
    const names = ["customers", "staff"]
    for (let i = 0; i < names.length; i++) {
      const col = app.findCollectionByNameOrId(names[i])

      const email = col.fields.getByName("email")
      if (email) {
        email.required = false
      }

      const password = col.fields.getByName("password")
      if (password) {
        password.min = 8
      }

      app.save(col)
    }
  },
  (app) => {
    // 回滚不需要恢复（放开限制不影响已有数据）
  }
)
