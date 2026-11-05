import Taro from '@tarojs/taro'
import PocketBase from 'pocketbase'

export const PB_URL = process.env.TARO_APP_PB_URL || 'http://127.0.0.1:8090'

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

export type Item = {
  id: string
  name: string
  category: 'base' | 'main' | 'extra'
  sort: number
  is_active?: boolean
  /** check 勾选型（选中即 1 份）/ qty 数量型（选中后可改数量） */
  qty_mode?: 'check' | 'qty'
  /** 数量型单位：对 / 双 / 个 */
  unit?: string
  /** 效果图文件名，访问需要 file token */
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
  is_active?: boolean
}

export type MeasureGroup = { id: string; name: string; sort: number }

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
