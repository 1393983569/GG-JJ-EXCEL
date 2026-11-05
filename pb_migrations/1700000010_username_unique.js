/// <reference path="../pb_data/types.d.ts" />

// 让「手机号(username) + 密码」可以登录。
// PocketBase 官方要求：
//   1. identity 字段必须是唯一字段 —— username 需要 UNIQUE 索引
//   2. 必须在集合的 authOptions 中开启 username 认证
//   3. requireEmail 默认 true，会导致注册必须带邮箱
//
// 注意：调试期间可能已存在重复 username，直接建唯一索引会失败，
// 所以先同组去重（保留最新一条），再建索引。
migrate(
  (app) => {
    const names = ["customers", "staff"]

    for (let i = 0; i < names.length; i++) {
      const table = names[i]

      // 1) 去重：同一 username 只保留最后写入的一条（用 SQLite 内建 rowid，不依赖业务列）
      app
        .db()
        .newQuery(
          "DELETE FROM " +
            table +
            " WHERE username IS NOT NULL AND rowid NOT IN (" +
            "  SELECT MAX(rowid) FROM " +
            table +
            " GROUP BY username" +
            ")"
        )
        .execute()

      // 2) username 唯一索引
      const col = app.findCollectionByNameOrId(table)
      const idx = col.indexes || []
      const indexName = "idx_" + table + "_username"
      let exists = false
      for (let j = 0; j < idx.length; j++) {
        if (String(idx[j]).indexOf(indexName) >= 0) {
          exists = true
          break
        }
      }
      if (!exists) {
        col.indexes = idx.concat([
          "CREATE UNIQUE INDEX `" + indexName + "` ON `" + table + "` (`username`)",
        ])
      }

      // 3) 让 username 参与 identity 匹配
      //    PocketBase 0.23+ / 0.40 的结构是 options.passwordAuth.identityFields，
      //    默认只有 ["email"]，不改这里的话「手机号+密码」永远匹配不到记录。
      try {
        if (col.passwordAuth && col.passwordAuth.identityFields) {
          col.passwordAuth.identityFields = ["email", "username"]
        }
      } catch (e) {}

      // 兼容旧版本的写法，存在才设
      try {
        if (col.authOptions) {
          col.authOptions.allowUsernameAuth = true
          col.authOptions.allowEmailAuth = true
          col.authOptions.minPasswordLength = 8
          col.authOptions.requireEmail = false
        }
      } catch (e) {}

      app.save(col)
    }

    // 兜底：如果上面的 JS 属性写入在当前版本不生效，
    // 直接改 _collections.options 里的 JSON（格式是紧凑的，可安全替换）。
    try {
      app
        .db()
        .newQuery(
          "UPDATE _collections SET options = replace(options, " +
            "'\"identityFields\":[\"email\"]', " +
            "'\"identityFields\":[\"email\",\"username\"]') " +
            "WHERE name IN ('customers', 'staff')"
        )
        .execute()
    } catch (e) {}
  },
  (app) => {
    // 回滚不删除索引与认证选项，避免误伤已有数据
  }
)
