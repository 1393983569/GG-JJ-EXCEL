import type { MeasureField, MeasureGroup } from './pb'

// 与 pb_hooks/lib/measure_text.js 保持一致的渲染逻辑，
// 用于快照 text 缺失（历史订单）时在前端兜底展示。

function toIntSafe(v: any): number {
  const n = Number(v)
  return isFinite(n) ? Math.floor(n) : 0
}

function hasValue(data: Record<string, any> | undefined | null, key: string): boolean {
  if (!data) return false
  const v = data[key]
  return v !== null && v !== undefined && String(v).trim() !== ''
}

export function formatMeasureValue(field: MeasureField, value: any): string {
  if (value === null || value === undefined || value === '') return ''
  let text = String(value)
  if (field.type === 'number') {
    const n = Number(value)
    if (!isFinite(n)) return ''
    const decimals = toIntSafe(field.decimals)
    text = decimals > 0 ? n.toFixed(decimals) : String(Math.round(n))
    if (decimals > 0 && text.indexOf('.') >= 0) {
      text = text.replace(/0+$/, '').replace(/\.$/, '')
    }
  }
  return field.unit ? text + String(field.unit) : text
}

/** 输出形如：身高: 164cm，体重: 70kg，手指长（中指: 9cm, 大拇指: 6cm） */
export function renderMeasureText(
  fields: MeasureField[],
  groups: MeasureGroup[],
  data: Record<string, any> | undefined | null
): string {
  const groupName: Record<string, string> = {}
  ;(groups || []).forEach((g) => {
    groupName[g.id] = g.name
  })

  const list = (fields || []).filter(
    (f) => f && f.in_export !== false && f.is_active !== false && hasValue(data, f.key)
  )
  list.sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))

  const parts: string[] = []
  let i = 0
  while (i < list.length) {
    const f = list[i]
    const groupId = f.group || ''
    if (f.wrap_parens && groupId) {
      const bucket = [f]
      let j = i + 1
      while (j < list.length && list[j].wrap_parens && (list[j].group || '') === groupId) {
        bucket.push(list[j])
        j++
      }
      const inner = bucket.map((it) => `${it.label}: ${formatMeasureValue(it, (data as any)[it.key])}`)
      parts.push(`${groupName[groupId] || f.label}（${inner.join(', ')}）`)
      i = j
    } else {
      parts.push(`${f.label}: ${formatMeasureValue(f, (data as any)[f.key])}`)
      i++
    }
  }
  return parts.join('，')
}
