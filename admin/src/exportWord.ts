import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import JSZip from 'jszip'
import dayjs from 'dayjs'
import {
  pb,
  type Catalog,
  type Item,
  type ItemField,
  type MeasureField,
  type MeasureGroup,
  type Order,
} from './pb'
import { renderMeasureText } from './measureText'

export type OrderExportData = {
  order: Order
  customerText: string
  productionText: string
  itemsCustomer: any[]
  itemsFinal: any[]
}

const FONT = { ascii: 'Arial', eastAsia: '微软雅黑', hAnsi: 'Arial' }
const LABEL_COLOR = 'FF0000'
const FIXED_TEXT_COLOR = '0000FF'

function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null)
}

function itemQtyText(it: any): string {
  if (it.qty_mode === 'qty') return `${it.qty || 1}${it.unit || ''}`
  if ((it.qty || 1) > 1) return `×${it.qty}`
  return ''
}

function catalogName(name?: string): string {
  return name || '衣服'
}

/** 只读当前账号有权访问的数据；查不到的集合直接跳过 */
export async function loadOrderExportData(id: string): Promise<OrderExportData> {
  const order = await pb.collection('orders').getOne<Order>(id, { expand: 'agent,factory' })
  const [fs, gs, catalogs, masterItems, specCustomer, specProduction, itemsCustomer, itemsFinal] =
    await Promise.all([
      safe(() => pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' })),
      safe(() => pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' })),
      safe(() => pb.collection('catalogs').getFullList<Catalog>({ sort: 'sort' })),
      safe(async () => {
        try {
          return await pb.collection('items').getFullList<Item>({ filter: 'is_deleted != true' })
        } catch (e) {
          return await pb.collection('items').getFullList<Item>()
        }
      }),
      safe(() => pb.collection('order_specs_customer').getFirstListItem(`order="${id}"`)),
      safe(() => pb.collection('order_specs_production').getFirstListItem(`order="${id}"`)),
      safe(() =>
        pb.collection('order_items').getFullList({ filter: `order="${id}" && stage="customer"`, sort: 'sort' })
      ),
      safe(() =>
        pb.collection('order_items').getFullList({ filter: `order="${id}" && stage="final"`, sort: 'sort' })
      ),
    ])

  const catalog = catalogName(order.catalog)
  const itemMap = new Map<string, Item>()
  ;(masterItems || []).forEach((it) => itemMap.set(it.id, it))

  // 每项定制项目自己带 catalog：只留当前订单品类的，且没关掉「导出到 Word」的
  const keepItem = (row: any): boolean => {
    const master = row.item ? itemMap.get(row.item) : undefined
    if (!master) return catalog === '衣服'
    return catalogName(master.catalog) === catalog && master.in_export !== false
  }

  // 尺寸同样按品类裁剪：catalogs.fields 里的 in_export 决定这个品类导不导出该字段。
  // 没配过品类字段的老订单退回全局字段开关。
  const bindings = (catalogs || []).find((c) => c.name === catalog)?.fields
  let exportFields = fs || []
  if (Array.isArray(bindings) && bindings.length) {
    const byKey = new Map<string, ItemField>()
    bindings.forEach((b) => b && b.key && byKey.set(b.key, b))
    exportFields = (fs || [])
      .filter((f) => {
        const b = byKey.get(f.key)
        return !!b && b.in_export !== false && f.in_export !== false && f.is_active !== false
      })
      .map((f) => ({ ...f, sort: Number(byKey.get(f.key)?.sort) || f.sort }))
  }

  const renderSize = (spec: any) =>
    spec?.data ? renderMeasureText(exportFields, gs || [], spec.data) : spec?.text || ''

  // 历史订单可能只有量体档案没冻结到客户尺寸快照
  let customerSpec: any = specCustomer
  if (!customerSpec?.data && order.measurement) {
    const m: any = await safe(() => pb.collection('measurements').getOne(order.measurement!))
    if (m) customerSpec = { data: m.data || {}, text: '' }
  }

  return {
    order,
    customerText: renderSize(customerSpec),
    productionText: renderSize(specProduction),
    itemsCustomer: (itemsCustomer || []).filter(keepItem),
    itemsFinal: (itemsFinal || []).filter(keepItem),
  }
}

function textRun(text: string, color?: string, bold = false) {
  return new TextRun({ text, color, bold, size: 21, font: FONT })
}

function labelParas(labels: string[]) {
  return labels.map(
    (label) =>
      new Paragraph({
        children: [textRun(label, LABEL_COLOR, true)],
        spacing: { after: 40 },
      })
  )
}

function valuePara(text: string, color?: string) {
  return new Paragraph({
    children: [textRun(text, color)],
    spacing: { after: 40 },
  })
}

function cell(width: number, children: Paragraph[]) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children,
  })
}

function row(labels: string[], values: Paragraph[]) {
  return new TableRow({ children: [cell(1800, labelParas(labels)), cell(8400, values)] })
}

function itemsText(list: any[]): string {
  return list
    .map((it) => {
      const qty = itemQtyText(it)
      return `${it.name || ''}${it.spec ? `（${it.spec}）` : ''}${qty ? ` ${qty}` : ''}`
    })
    .join(' ')
}

function buildDocument(data: OrderExportData, fixedText: string): Document {
  const { order } = data
  const items = data.itemsFinal.length ? data.itemsFinal : data.itemsCustomer
  const roleCode = String((pb.authStore.record as any)?.role_code || '')

  // 代理看客户原始尺寸；审核/管理员/工厂看生产数据，没有生产数据时回退到客户原始尺寸
  const sizeRows =
    roleCode === 'agent' || !data.productionText
      ? [row(['客户原始尺寸'], [valuePara(data.customerText)])]
      : [row(['生产数据'], [valuePara(data.productionText)])]

  return new Document({
    title: '订单导出',
    sections: [
      {
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: [1800, 8400],
            rows: [
              row(['地址'], [
                valuePara(`${order.contact_name || ''} ${order.phone || ''}`.trim()),
                valuePara(order.address || ''),
              ]),
              ...sizeRows,
              row(['固定文字', '可以配置：'], [valuePara(fixedText, FIXED_TEXT_COLOR)]),
              row(['项目：'], [valuePara(itemsText(items))]),
              row(['订单编号'], [valuePara(order.order_no || '')]),
            ],
          }),
        ],
      },
    ],
  })
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

function orderFileName(order: Order): string {
  const name = safeFileName(order.contact_name || '') || '客户'
  const phone = safeFileName(order.phone || '') || safeFileName(order.order_no || '') || '订单'
  return `${name}${phone}.docx`
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 前端生成 Word：单张直接下载，批量打包 zip；文件名均为“客户名称+电话” */
export async function exportOrdersToWord(ids: string[], fixedText: string): Promise<void> {
  if (!ids.length) return
  const list: OrderExportData[] = []
  for (const id of ids) {
    list.push(await loadOrderExportData(id))
  }

  if (list.length === 1) {
    const blob = await Packer.toBlob(buildDocument(list[0], fixedText))
    downloadBlob(blob, orderFileName(list[0].order))
    return
  }

  const zip = new JSZip()
  const used = new Map<string, number>()
  for (const data of list) {
    const blob = await Packer.toBlob(buildDocument(data, fixedText))
    const base = orderFileName(data.order).replace(/\.docx$/, '')
    const count = (used.get(base) || 0) + 1
    used.set(base, count)
    zip.file(count === 1 ? `${base}.docx` : `${base}（${count}）.docx`, blob)
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(zipBlob, `订单批量导出_${dayjs().format('YYYYMMDD_HHmm')}.zip`)
}
