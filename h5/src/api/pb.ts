import Taro from '@tarojs/taro'
import PocketBase from 'pocketbase'

function sameOrigin(): string {
  try {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return ''
    return location.origin
  } catch (e) {
    return ''
  }
}

/**
 * 后端地址解析，顺序：
 * 1. .env 里的 TARO_APP_PB_URL；
 * 2. 没配置（或配置成空）时走同源，适用于和 PocketBase 部署在同一域名的情况；
 * 3. 最后退回本机 8090（仅 `npm run dev:h5` + `pocketbase serve` 的默认组合可用）。
 *
 * 手机通过局域网 IP 打开 H5 时，配置里的 127.0.0.1 指的是手机自己，
 * 这里统一换成当前访问的主机名，避免请求发不出去。
 */
function resolveBase(): string {
  const env = String(process.env.TARO_APP_PB_URL || '')
    .trim()
    .replace(/\/+$/, '')
  if (!env) return sameOrigin() || 'http://127.0.0.1:8090'

  const host = typeof location !== 'undefined' ? location.hostname : ''
  if (!host || host === 'localhost' || host === '127.0.0.1') return env
  return env.replace(/([a-z]+:\/\/)(127\.0\.0\.1|localhost)(?=[:/]|$)/, '$1' + host)
}

export const PB_URL = resolveBase()

export const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

const STORAGE_KEY = 'pb_auth'

const saved = Taro.getStorageSync(STORAGE_KEY)
if (saved) {
  try {
    pb.authStore.loadFromCookie(saved)
  } catch (e) {
    // 忽略无效缓存
  }
}

pb.authStore.onChange(() => {
  try {
    Taro.setStorageSync(STORAGE_KEY, pb.authStore.exportToCookie({ httpOnly: false }))
  } catch (e) {
    // 忽略
  }
})

export type PriceLine = {
  item_id?: string
  name: string
  category?: string
  unit_cents: number
  qty: number
  /** 数量型单位（对/双/个），勾选型为空 */
  unit?: string
  /** check 勾选型 / qty 数量型 */
  qty_mode?: 'check' | 'qty'
  /** 导出文本：五指袜 / 手套 2对 */
  label?: string
  amount_cents: number
}

export type PriceVersion = { id: string; name: string; code: string; sort: number }

export type ItemPrice = { id: string; item: string; version: string; price_cents: number }

/** 项目绑定的定制参数：key 指向 measure_fields.key */
export type ItemField = {
  key: string
  required?: boolean
  sort?: number
}

export type Item = {
  id: string
  name: string
  category: 'base' | 'main' | 'extra'
  sort: number
  /** 品类：衣服 / 床垫 / 袜子…，空按衣服算。要填的尺寸看品类 */
  catalog?: string
  is_active?: boolean
  /** check 勾选型（选中即 1 份）/ qty 数量型（选中后可改数量） */
  qty_mode?: 'check' | 'qty'
  /** 数量型单位：对 / 双 / 个 */
  unit?: string
  /** 规格选项，如 ["分体","连体"]；非空时客户必须选一个 */
  options?: string[]
  /** 效果图文件名，访问需要 file token */
  image?: string
  /** 下单页是否显示（代理可在 /api/gg/items/prices 的 overrides 里覆盖） */
  h5_visible?: boolean
  /** 下单页默认勾选 */
  h5_default?: boolean
  /** 是否计入合计：false 时照样下单，只是客户版价格按 0 算 */
  in_price?: boolean
  /** H5 展示名：总部配的别名，留空显示项目名 */
  alias?: string
  /** 代理自定义效果图的地址（服务端带文件 token 下发），有就用它替代 image */
  icon?: string
  /** PocketBase 记录自带字段，拼文件 URL 时需要 */
  collectionId?: string
  collectionName?: string
}

export type MeasureField = {
  id: string
  group?: string
  key: string
  label: string
  unit?: string
  type: 'number' | 'text' | 'select'
  options?: string[]
  required?: boolean
  decimals?: number
  sort: number
  is_active?: boolean
}

export type MeasureGroup = { id: string; name: string; sort: number }

/** 品类字典（只下发给 H5 启用中的，顺序即首页与 tab 顺序） */
export type Catalog = {
  name: string
  sort: number
  /** 这个品类固定要量的尺寸（品类下一套，项目共用） */
  fields?: ItemField[]
}

export type Measurement = {
  id: string
  code: string
  name?: string
  phone?: string
  gender?: string
  data: Record<string, any>
  fabric?: string
  remark?: string
}

const FIELD_LABELS: Record<string, string> = {
  username: '手机号',
  phone: '手机号',
  email: '邮箱',
  password: '密码',
  passwordConfirm: '确认密码',
  display_name: '称呼',
}

/**
 * 把报错转成能定位问题的中文。
 * 请求根本没到后端（后端没起、地址配错、手机访问了 127.0.0.1）时，
 * SDK 只会抛一句 "Something went wrong."，对客户和排查都没有意义。
 */
export function errorText(e: any, fallback = '操作失败'): string {
  const status = typeof e?.status === 'number' ? e.status : 0
  const data = e?.response?.data || e?.data
  if (data && typeof data === 'object') {
    const first = Object.keys(data)[0]
    if (first && data[first] && data[first].message) {
      return (FIELD_LABELS[first] || first) + '：' + data[first].message
    }
  }
  // status 0：请求没拿到任何 HTTP 响应，联网层就失败了
  if (!status) return '连不上后端 ' + PB_URL + '，请确认后端已启动、当前设备能访问该地址'

  const msg = String(e?.message || '')
  if (!msg || /something went wrong|failed to fetch|load failed/i.test(msg)) {
    return fallback + '（HTTP ' + status + '）'
  }
  return msg
}

/** 分转元显示 */
export function yuan(cents?: number): string {
  if (cents === undefined || cents === null || isNaN(cents)) return '0'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const y = Math.floor(abs / 100)
  const f = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '')
  return sign + y + (f ? '.' + f : '')
}
