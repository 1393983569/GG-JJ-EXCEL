import PocketBase from 'pocketbase'

export const PB_URL = (import.meta.env.VITE_PB_URL as string) || 'http://127.0.0.1:8090'

export const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

export type Staff = {
  id: string
  username: string
  display_name?: string
  phone?: string
  role?: string
  price_version?: string
  can_view_all_prices?: boolean
  menus?: string[]
  is_active?: boolean
}

export type OrderPrice = {
  id: string
  order: string
  version: string
  price_mode: 'formula' | 'fixed'
  fixed_cents?: number
  base_cents: number
  items_cents: number
  adjust_cents: number
  total_cents: number
  detail_json?: PriceLine[]
}

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

export type Order = {
  id: string
  order_no: string
  customer?: string
  agent?: string
  measurement?: string
  contact_name?: string
  phone?: string
  address?: string
  status: string
  review_status?: 'pending' | 'approved' | 'rejected'
  reviewer?: string
  reviewed_at?: string
  remark?: string
  created: string
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
  updated: string
}

export type Item = {
  id: string
  name: string
  category: 'base' | 'main' | 'extra'
  sort: number
  is_active: boolean
  /** check 勾选型（无数量）/ qty 数量型（可选数量，需配单位） */
  qty_mode?: 'check' | 'qty'
  /** 数量型单位：对 / 双 / 个 */
  unit?: string
  /** 假删除标记：置 true 后不再出现在项目列表，历史订单保留 */
  is_deleted?: boolean
  remark?: string
  /** 效果图文件名，需要配合 pb.files.getURL + file token 访问 */
  image?: string
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
  in_export?: boolean
  wrap_parens?: boolean
  is_active?: boolean
}

export type MeasureGroup = {
  id: string
  name: string
  sort: number
  is_active?: boolean
}

export type PriceVersion = {
  id: string
  name: string
  code: string
  sort: number
  is_active?: boolean
}

export type Role = {
  id: string
  name: string
  code: string
  price_version: string
  can_view_all_prices?: boolean
  menus?: string[]
  is_active?: boolean
}

export const STATUS_MAP: Record<string, { text: string; color: string }> = {
  pending: { text: '待确认', color: 'default' },
  confirmed: { text: '已确认', color: 'processing' },
  producing: { text: '生产中', color: 'warning' },
  shipped: { text: '已发货', color: 'cyan' },
  done: { text: '已完成', color: 'success' },
  cancelled: { text: '已取消', color: 'error' },
}

/** 分转元，展示用 */
export function yuan(cents?: number): string {
  if (cents === undefined || cents === null || isNaN(cents)) return '-'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const y = Math.floor(abs / 100)
  let f = String(abs % 100).padStart(2, '0').replace(/0+$/, '')
  return sign + y + (f ? '.' + f : '')
}

/** 元转分 */
export function toCents(value: number | string | null | undefined): number {
  const n = Number(value)
  if (!isFinite(n)) return 0
  return Math.round(n * 100)
}
