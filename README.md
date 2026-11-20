# 定制紧身衣订单系统（PocketBase 后端）

客户量体录入 → 自动计价 → 订单管理 → Word/Excel 导出。

## 目录

```
pb_migrations/   集合定义与初始数据（首次启动自动执行）
pb_hooks/
  main.pb.js     钩子与自定义接口（算价、调价、查历史量体）
  lib/pricing.js       计价引擎（纯函数）
  lib/measure_text.js  量体文本渲染（驱动 Word 导出）
tests/           计价与渲染的单元测试
```

## 启动

1. 从 https://github.com/pocketbase/pocketbase/releases 下载 **v0.23 或更高** 的对应平台可执行文件，放到本目录。
2. 首次启动创建超级管理员：

```bash
./pocketbase superuser create admin@example.com yourpassword
```

3. 启动服务（会自动执行 `pb_migrations` 建表并写入初始数据）：

```bash
./pocketbase serve --http=0.0.0.0:8090
```

4. 打开 `http://127.0.0.1:8090/_/` 进入后台。

## 已内置的初始数据

- 价格版本：客户版 / 工厂版 / 代理版
- 角色：超级管理员（可看全部价格）、工厂（工厂版）、代理（代理版）、客户（客户版）
- 量体字段 25 项，按「体型 / 手指长 / 上肢 / 躯干 / 下肢 / 长度」分组，顺序与导出模板一致
- 定制项目 13 项（含客户版价格）

工厂版 / 代理版价格需在后台 `item_prices` 中按实际成本补录。

## 关键设计

**订单表不存任何价格字段。** 价格落在 `order_prices`，一单 × 一版本 = 一行。API 规则：

```
(@request.auth.can_view_all_prices = true || version = @request.auth.price_version)
&& (@request.auth.collectionName = "staff" || order.customer = @request.auth.id)
```

代理 / 客户的 token 里 `price_version` 不同，查询时在 SQL 层就过滤掉了其他版本的价格行——不是前端隐藏。

**金额一律整数（分）**，字段名以 `_cents` 结尾。计价逻辑只在服务端，客户端提交订单时只传 `measurement` + `items_snapshot`（项目 ID 与数量），不传金额。

**量体数据双份快照**：订单创建时同时冻结 `data`（结构化）和 `text`（渲染好的中文段落）。以后改字段名，历史订单的描述不会跟着变。

**量体字段的 `key` 创建后不可修改**。历史数据靠 `key` 定位，`label` 可以随便改。后台「删除字段」只能置 `is_active=false`。

## 接口

### 查历史量体（客户端）

```
GET /api/gg/measure/lookup?phone=13800000000&suffix=1234
```

- `suffix` 为订单号后四位
- 同手机号连续 5 次失败锁定 10 分钟
- 只返回命中订单所关联的量体档案

### 调价 / 固定价（后台）

```
POST /api/gg/orders/{id}/adjust
Authorization: <staff token>
{ "version": "<price_version_id>", "amount_cents": 5000, "reason": "客户加做背部拉链", "price_mode": "formula" }
```

- 仅 `staff` 集合的账号可调用
- 固定价：传 `price_mode: "fixed"` + `fixed_cents`
- 每次调用都会写一条 `order_adjustments` 流水（加价前总额、加价后总额、操作人、原因）

## 前端

### 环境要求

Node 18 以上。本机已装 **v20.19.1**（`C:\Program Files\nodejs`），直接用系统 node 即可，不需要额外配置。

> 如果终端里 `node -v` 显示 v12，说明当前 shell 会话用的是旧 PATH，重开终端或重启 IDE 就好。

安装依赖时 `h5/` 需要加 `--legacy-peer-deps`（Taro 的 peer 依赖声明较宽松）。

### 后台管理端 `admin/`（React 18 + Ant Design 5 + Vite）

```bash
cd admin
npm run dev      # http://localhost:5173
npm run build    # 输出到 ../pb_public，PocketBase serve 时直接托管
```

页面：登录、订单管理、订单详情（含调价）、量体档案、定制项目（三版价格）、量体字段配置、角色权限、后台账号。

### 客户端 `h5/`（Taro 4 + React）

```bash
cd h5
npm run dev:h5     # 开发服务，默认 http://localhost:10087
npm run build:h5   # 构建，输出到 h5/dist
```

开发模式额外依赖 `@pmmmwh/react-refresh-webpack-plugin`（React 热更新），生产构建不需要，已列入 devDependencies。

后端地址在 `.env.development` / `.env.production` 的 `TARO_APP_PB_URL` 中配置。

页面：首页、登录/注册（手机号 + 密码）、填写量体（含「用历史尺码」）、下单（选项目 + 实时总价）。

### 首个后台账号

PocketBase 启动后，进入 `http://127.0.0.1:8090/_/`，在 `staff` 集合里新建一条记录：

- `username`：登录名
- `password`：密码
- `role`：选角色（admin / reviewer / agent / factory）
- **`role_code`**：必须手填，与角色 code 一致（如 `admin`）。所有权限规则都依赖这个字段
- `price_version`：对应价格版本
- `menus`：可见菜单

客户则在 H5 端自助注册，注册后自动绑定客户版价格。

## 角色与数据隔离

同一订单里同时存在「客户原始尺寸」和「生产尺寸」，而不同角色只能看到其中一份。PocketBase 只有记录级权限，无法隐藏同一行的某些字段，因此拆表：

| 集合 | 内容 | 谁能看到 |
|---|---|---|
| `order_specs_customer` | 客户原始尺寸 | 客户、代理、审核、管理员（**工厂不可见**） |
| `order_specs_production` | 审核后生产尺寸 + 生产备注 | 工厂、审核、管理员（**客户/代理不可见**） |
| `order_internal_remarks` | 管理员/审核员改写后的客户备注 | 审核、管理员（**客户/代理/工厂不可见**，客户和代理仍看 `orders.remark` 原文） |
| `order_items` | 项目，`stage=customer/final` | 按 stage 与角色区分；`final` 可逐个设 `factory_visible=false`（工厂看不到） |
| `staff_item_settings` | 账号维度的项目配置：别名、H5 三项开关、排序、效果图 | 内部全部；代理只看自己账号的行 |
| `order_reviews` | 满意度打分 | 审核、代理、管理员（**客户/工厂不可见**） |
| `order_logs` | 操作日志 | 审核、管理员 |
| `order_prices` | 各版本价格 | 按 `price_version` 记录级隔离 |

`orders` 表本身不含尺寸、项目、价格、满意度，只有基础信息和状态。

订单流转：`pending`（客户提交）→ 审核员 `approved` + 写生产尺寸/项目 → 重算三版价格 → `confirmed`。

## 接口

```
POST /api/gg/orders            下单（客户 token）
POST /api/gg/orders-review     审核通过/驳回（reviewer、admin）
POST /api/gg/orders-remark     改写客户备注，仅内部可见（reviewer、admin；传空串恢复原文）
POST /api/gg/orders-score      满意度打分（reviewer、agent、admin）
POST /api/gg/orders-complete   工厂完结订单（status=done，仅指派给自己的单；完结后可打分）
POST /api/gg/orders-adjust     调价 / 固定价（reviewer、admin）
POST /api/gg/orders-item-visibility  生产项目设置工厂可见（reviewer、admin）
POST /api/gg/item-prices       项目单价维护（按版本隔离）
GET  /api/gg/measure/lookup    手机号 + 订单号后四位查历史尺码
```

注意：下单不再直接调 `/api/collections/orders/records`，必须走 `/api/gg/orders`，由服务端拆表、算价、写日志。

## 测试

```bash
node tests/pricing.test.js
```

覆盖：基础累加、0 元项保留、数量倍数、固定价覆盖、加价叠加、负数减价、量体文本拼接与括号合并。

## 待办

- [ ] 前端（客户端 H5 + 后台管理端）
- [ ] Word 导出模板（只需一个 `{measure_text}` 占位符）
- [ ] Excel 批量导出
- [ ] 定制项目图片上传与批量维护
