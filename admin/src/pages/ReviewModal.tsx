import { useEffect, useMemo, useState } from 'react'
import { App, Alert, Button, Checkbox, Divider, Form, Input, InputNumber, Modal, Select, Space, Tabs, Tag } from 'antd'
import { pb, type MeasureField, type MeasureGroup } from '../pb'

type Props = {
  open: boolean
  orderId: string
  /** 客户原始尺寸 { fieldKey: value } */
  customerData: Record<string, any>
  /** 已保存的生产尺寸，用于二次审核时回显 */
  productionData?: Record<string, any>
  customerItems: {
    item: string
    name: string
    qty: number
    category: string
    unit?: string
    qty_mode?: string
    /** 客户选中的规格，如 分体 / 连体 */
    spec?: string
  }[]
  /** review=审核员；agent=代理核对，只能改尺寸/项目/成交价 */
  mode?: 'review' | 'agent'
  /** 当前成交价（分），代理模式可改 */
  terminalPrice?: number
  onClose: () => void
  onDone: () => void
}

const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === ''

export default function ReviewModal({
  open,
  orderId,
  customerData,
  productionData,
  customerItems,
  mode = 'review',
  terminalPrice,
  onClose,
  onDone,
}: Props) {
  const { message } = App.useApp()
  const isAgent = mode === 'agent'
  const [fields, setFields] = useState<MeasureField[]>([])
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [allItems, setAllItems] = useState<any[]>([])
  const [data, setData] = useState<Record<string, any>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({})
  // 订单里的项目快照（类型/单位），历史订单不跟随后台配置变化
  const [snapMeta, setSnapMeta] = useState<Record<string, { qty_mode: string; unit: string }>>({})
  const [remark, setRemark] = useState('')
  const [priceText, setPriceText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    // 默认沿用客户填写值；已审核过的订单用上次保存的生产尺寸覆盖
    const init: Record<string, any> = { ...customerData }
    Object.keys(productionData || {}).forEach((k) => {
      if (!isEmpty((productionData as Record<string, any>)[k])) init[k] = (productionData as Record<string, any>)[k]
    })
    setData(init)
    setRemark('')
    setPriceText(terminalPrice ? (terminalPrice / 100).toFixed(2) : '')
    const initQty: Record<string, number> = {}
    const initSel: string[] = []
    const initMeta: Record<string, { qty_mode: string; unit: string }> = {}
    customerItems.forEach((it) => {
      initSel.push(it.item)
      initQty[it.item] = it.qty || 1
      initMeta[it.item] = {
        qty_mode: it.qty_mode === 'qty' ? 'qty' : 'check',
        unit: it.unit || '',
      }
    })
    setSelected(initSel)
    setQtyMap(initQty)
    setSnapMeta(initMeta)
    loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, customerData, productionData])

  const loadBase = async () => {
    try {
      const [fs, gs, its] = await Promise.all([
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
        pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' }),
        pb.collection('items').getFullList<any>({ filter: 'is_active = true', sort: 'sort' }),
      ])
      setFields(fs.filter((f) => f.is_active !== false))
      setGroups(gs)
      setAllItems(its)
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    }
  }

  const grouped = useMemo(() => {
    const map: Record<string, MeasureField[]> = {}
    fields.forEach((f) => {
      const gid = f.group || 'other'
      ;(map[gid] ||= []).push(f)
    })
    return groups
      .filter((g) => map[g.id]?.length)
      .map((g) => ({ ...g, items: map[g.id] }))
      .concat(map['other'] ? [{ id: 'other', name: '其他', sort: 999, items: map['other'] } as any] : [])
  }, [fields, groups])

  // 代理核对：只提交尺寸/项目/成交价，底价由后端按项目重算，代理改不了
  const doAgentSubmit = async () => {
    if (!selected.length) {
      message.warning('请至少保留一个项目')
      return
    }
    setSaving(true)
    try {
      const items = allItems
        .filter((it) => selected.indexOf(it.id) >= 0)
        .map((it) => ({
          item_id: it.id,
          name: it.name,
          category: it.category,
          qty: qtyMap[it.id] || 1,
        }))

      await pb.send('/api/gg/orders-agent-confirm', {
        method: 'POST',
        body: {
          order_id: orderId,
          data,
          items,
          terminal_price_cents: priceText ? Math.round(Number(priceText) * 100) : 0,
        },
      })
      message.success('已提交，等待审核')
      onDone()
      onClose()
    } catch (e: any) {
      message.error(e?.message || '提交失败')
    } finally {
      setSaving(false)
    }
  }

  const submit = async (action: 'approved' | 'rejected') => {
    if (action === 'rejected') {
      Modal.confirm({
        title: '确认驳回该订单？',
        content: '驳回原因会记录到订单日志。',
        onOk: () => doSubmit('rejected'),
      })
      return
    }
    doSubmit('approved')
  }

  const doSubmit = async (action: 'approved' | 'rejected') => {
    setSaving(true)
    try {
      const items = allItems
        .filter((it) => selected.indexOf(it.id) >= 0)
        .map((it) => ({
          item_id: it.id,
          name: it.name,
          category: it.category,
          qty: qtyMap[it.id] || 1,
        }))

      await pb.send('/api/gg/orders-review', {
        method: 'POST',
        body: {
          order_id: orderId,
          action,
          data: action === 'approved' ? data : undefined,
          items: action === 'approved' ? items : undefined,
          production_remark: remark,
          reject_reason: remark,
        },
      })
      message.success(action === 'approved' ? '已审核通过，价格已重算' : '已驳回')
      onDone()
      onClose()
    } catch (e: any) {
      message.error(e?.message || '操作失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isAgent ? '核对订单' : '审核订单'}
      open={open}
      onCancel={onClose}
      width={900}
      footer={
        isAgent ? (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={doAgentSubmit}>
              确认提交
            </Button>
          </Space>
        ) : (
          <Space>
            <Button danger loading={saving} onClick={() => submit('rejected')}>
              驳回
            </Button>
            <Button type="primary" loading={saving} onClick={() => submit('approved')}>
              审核通过
            </Button>
          </Space>
        )
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          isAgent
            ? '左侧沿用客户填写值，可按客户实际要求修改；改动后右侧变红显示客户原值。底价由系统按项目重算，不能手动修改。确认后进入待审核。'
            : '生产尺寸默认沿用客户填写值，可直接修改；输入框右侧灰字为客户原值，改动后变红提示。项目默认沿用客户选择，可增删。审核通过后系统重算各版本价格。'
        }
      />

      {isAgent && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#666' }}>终端售价</span>
          <InputNumber
            size="small"
            style={{ width: 160 }}
            prefix="¥"
            value={priceText ? Number(priceText) : undefined}
            placeholder="成交价"
            onChange={(v) => setPriceText(v === null || v === undefined ? '' : String(v))}
          />
          <span style={{ fontSize: 12, color: '#999' }}>客户下单时的意向价，可调整；不影响历史订单</span>
        </div>
      )}

      <Tabs
        items={[
          {
            key: 'spec',
            label: isAgent ? '核对尺寸' : '生产尺寸',
            children: (
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {grouped.map((g: any) => (
                  <div key={g.id} style={{ marginBottom: 12 }}>
                    <Divider orientation="left" plain style={{ margin: '8px 0' }}>
                      {g.name}
                    </Divider>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {g.items.map((f: MeasureField) => {
                        const origin = customerData[f.key]
                        const current = data[f.key]
                        const diff = !isEmpty(origin) && String(current ?? '') !== String(origin)
                        return (
                          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 90, textAlign: 'right', fontSize: 13, color: '#666' }}>
                              {f.label}
                            </span>
                            {f.type === 'number' ? (
                              <InputNumber
                                size="small"
                                style={{ flex: 1, minWidth: 0 }}
                                value={current}
                                placeholder={f.unit || ''}
                                onChange={(v) => setData({ ...data, [f.key]: v })}
                              />
                            ) : f.type === 'select' && (f.options || []).length ? (
                              <Select
                                size="small"
                                allowClear
                                style={{ flex: 1, minWidth: 0 }}
                                value={isEmpty(current) ? undefined : current}
                                placeholder={f.unit || ''}
                                options={(f.options || []).map((o) => ({ label: o, value: o }))}
                                onChange={(v) => setData({ ...data, [f.key]: v })}
                              />
                            ) : (
                              <Input
                                size="small"
                                style={{ flex: 1, minWidth: 0 }}
                                value={current ?? ''}
                                placeholder={f.unit || ''}
                                onChange={(e) => setData({ ...data, [f.key]: e.target.value })}
                              />
                            )}
                            <span
                              style={{
                                width: 46,
                                flexShrink: 0,
                                fontSize: 12,
                                color: diff ? '#ff4d4f' : '#bfbfbf',
                                whiteSpace: 'nowrap',
                              }}
                              title={isEmpty(origin) ? '' : `客户原值：${origin}`}
                            >
                              {isEmpty(origin) ? '' : diff ? `原 ${origin}` : `${origin}`}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
          {
            key: 'items',
            label: isAgent ? '核对项目' : '生产项目',
            children: (
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {allItems.map((it) => {
                  // 订单里的项目用下单时的快照，新加的项目用当前配置
                  const meta = snapMeta[it.id]
                  const mode = meta ? meta.qty_mode : it.qty_mode === 'qty' ? 'qty' : 'check'
                  const unit = meta ? meta.unit : it.unit || ''
                  return (
                    <div
                      key={it.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}
                    >
                      <Checkbox
                        checked={selected.indexOf(it.id) >= 0}
                        onChange={(e) => {
                          if (e.target.checked) setSelected([...selected, it.id])
                          else setSelected(selected.filter((x) => x !== it.id))
                        }}
                      >
                        {it.name}
                        {it.spec ? `（${it.spec}）` : ''}
                      </Checkbox>
                      {it.category === 'base' && <Tag color="red">基础</Tag>}
                      {it.category !== 'base' && mode === 'qty' && (
                        <InputNumber
                          size="small"
                          min={1}
                          style={{ width: 100 }}
                          addonAfter={unit || undefined}
                          value={qtyMap[it.id] || 1}
                          onChange={(v) =>
                            setQtyMap({ ...qtyMap, [it.id]: Math.max(1, Number(v) || 1) })
                          }
                        />
                      )}
                      {it.category !== 'base' && mode !== 'qty' && (
                        <Tag>勾选型 · 1 份</Tag>
                      )}
                    </div>
                  )
                })}
              </div>
            ),
          },
        ]}
      />

      <Form layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="生产备注 / 驳回原因">
          <Input.TextArea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
