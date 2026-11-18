import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ArrowLeftOutlined, AuditOutlined, DownloadOutlined, EditOutlined, StarOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  pb,
  STATUS_MAP,
  yuan,
  toCents,
  remarkHtml,
  type MeasureField,
  type MeasureGroup,
  type OrderPrice,
  type PriceLine,
} from '../pb'
import { useAuth } from '../auth'
import { renderMeasureText } from '../measureText'
import ExportWordModal from '../components/ExportWordModal'
import ReviewModal from './ReviewModal'

/** 项目数量文本：数量型拼单位（手套 2对），勾选型不显示 */
function itemQtyText(it: any) {
  if (it.qty_mode === 'qty') return `${it.qty || 1}${it.unit || ''}`
  if ((it.qty || 1) > 1) return `×${it.qty}`
  return ''
}

export default function OrderDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { user } = useAuth()

  const [order, setOrder] = useState<any>(null)
  const [prices, setPrices] = useState<any[]>([])
  const [specCustomer, setSpecCustomer] = useState<any>(null)
  const [specProduction, setSpecProduction] = useState<any>(null)
  // 客户原始尺寸（快照缺失时回退到量体档案），用于审核弹窗回显与原值对比
  const [customerData, setCustomerData] = useState<Record<string, any>>({})
  const [productionData, setProductionData] = useState<Record<string, any>>({})
  // 快照 text 缺失时在前端按字段定义兜底渲染
  const [fields, setFields] = useState<MeasureField[]>([])
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [itemsCustomer, setItemsCustomer] = useState<any[]>([])
  const [itemsFinal, setItemsFinal] = useState<any[]>([])
  const [itemsAgent, setItemsAgent] = useState<any[]>([])
  const [terminalPrice, setTerminalPrice] = useState(0)
  const [adjustments, setAdjustments] = useState<any[]>([])
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<OrderPrice | null>(null)
  const [scoreOpen, setScoreOpen] = useState(false)
  // 审核指派工厂后才算工厂成本，工厂也才能看到这张单
  const [factories, setFactories] = useState<any[]>([])
  const [assigning, setAssigning] = useState(false)
  // 正在保存「工厂可见」的项目记录 id
  const [savingVisible, setSavingVisible] = useState('')
  const [form] = Form.useForm()
  const [scoreForm] = Form.useForm()

  const roleCode = (user as any)?.role_code || ''
  const canReview = roleCode === 'reviewer' || roleCode === 'admin'
  const isFactory = roleCode === 'factory'
  // 订单做完（done）才允许打分，待确认/待审核阶段不给入口
  const canScore = (canReview || roleCode === 'agent') && order?.status === 'done'

  const toModalItems = (list: any[]) =>
    list.map((it) => ({
      item: it.item,
      name: it.name,
      qty: it.qty,
      category: it.category,
      unit: it.unit,
      qty_mode: it.qty_mode,
      spec: it.spec,
    }))

  const load = async () => {
    setLoading(true)
    const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn()
      } catch (e) {
        return null
      }
    }
    try {
      const o = await pb.collection('orders').getOne<any>(id, { expand: 'agent,factory' })
      setOrder(o)
      if (canReview) {
        setFactories(
          (await safe(() =>
            pb.collection('staff').getFullList({ filter: 'role_code = "factory" && is_active = true' })
          )) || []
        )
      }
      setPrices((await safe(() => pb.collection('order_prices').getFullList({ filter: `order="${id}"`, expand: 'version' }))) || [])
      const tp: any = await safe(() => pb.collection('order_terminal_prices').getFirstListItem(`order="${id}"`))
      setTerminalPrice(tp?.amount_cents || 0)
      const spec = await safe(() => pb.collection('order_specs_customer').getFirstListItem(`order="${id}"`))
      const prod = await safe(() => pb.collection('order_specs_production').getFirstListItem(`order="${id}"`))
      setSpecProduction(prod)
      setProductionData(prod?.data || {})

      // 快照缺失（历史订单）时，回退读取订单关联的量体档案
      let cust: any = spec
      if (!cust?.data && o.measurement) {
        const m = await safe(() => pb.collection('measurements').getOne<any>(o.measurement))
        if (m) cust = { data: m.data || {}, text: '', fabric: m.fabric || '', remark: m.remark || '' }
      }
      setSpecCustomer(cust)
      setCustomerData(cust?.data || {})

      const [fs, gs] = await Promise.all([
        safe(() => pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' })),
        safe(() => pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' })),
      ])
      setFields(fs || [])
      setGroups(gs || [])
      setItemsCustomer((await safe(() => pb.collection('order_items').getFullList({ filter: `order="${id}" && stage="customer"`, sort: 'sort' }))) || [])
      setItemsFinal((await safe(() => pb.collection('order_items').getFullList({ filter: `order="${id}" && stage="final"`, sort: 'sort' }))) || [])
      setItemsAgent((await safe(() => pb.collection('order_items').getFullList({ filter: `order="${id}" && stage="agent"`, sort: 'sort' }))) || [])
      setReviews((await safe(() => pb.collection('order_reviews').getFullList({ filter: `order="${id}"`, sort: '-created' }))) || [])
      setAdjustments((await safe(() => pb.collection('order_adjustments').getFullList({ filter: `order="${id}"`, sort: 'created' }))) || [])
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const avgScore = useMemo(() => {
    if (!reviews.length) return null
    return (reviews.reduce((s, r) => s + (r.score || 0), 0) / reviews.length).toFixed(1)
  }, [reviews])

  // 快照 text 为空时按字段定义实时渲染，避免显示“（无）”
  const customerText = useMemo(
    () => specCustomer?.text || renderMeasureText(fields, groups, customerData),
    [specCustomer, fields, groups, customerData]
  )
  const productionText = useMemo(
    () => specProduction?.text || renderMeasureText(fields, groups, productionData),
    [specProduction, fields, groups, productionData]
  )

  const openAdjust = (p: OrderPrice) => {
    setAdjustTarget(p)
    form.setFieldsValue({ amount: 0, reason: '' })
    setAdjustOpen(true)
  }

  // 底价由管理员配的项目价算出，这里只能加价，且必须写清原因
  const submitAdjust = async () => {
    const v = await form.validateFields()
    if (!adjustTarget) return
    try {
      await pb.send('/api/gg/orders-adjust', {
        method: 'POST',
        body: {
          order_id: id,
          version: adjustTarget.version,
          amount_cents: toCents(v.amount || 0),
          reason: v.reason,
        },
      })
      message.success('已加价')
      setAdjustOpen(false)
      load()
    } catch (e: any) {
      message.error(e?.message || '加价失败')
    }
  }

  const submitScore = async () => {
    const v = await scoreForm.validateFields()
    try {
      await pb.send('/api/gg/orders-score', {
        method: 'POST',
        body: { order_id: id, score: v.score, remark: v.remark || '' },
      })
      message.success('已打分')
      setScoreOpen(false)
      load()
    } catch (e: any) {
      message.error(e?.message || '打分失败')
    }
  }

  const closeOrder = async () => {
    Modal.confirm({
      title: '关闭订单？',
      content: '关闭后工厂列表会置灰显示「订单关闭」，确定继续？',
      okText: '关闭',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await pb.collection('orders').update(id, { status: 'cancelled' })
          message.success('订单已关闭')
          load()
        } catch (e: any) {
          message.error(e?.message || '关闭失败')
        }
      },
    })
  }

  const assignFactory = async (factoryId?: string) => {
    setAssigning(true)
    try {
      await pb.send('/api/gg/orders-assign-factory', {
        method: 'POST',
        body: { order_id: id, factory: factoryId || '' },
      })
      message.success(factoryId ? '已指派工厂' : '已取消指派')
      load()
    } catch (e: any) {
      message.error(e?.message || '指派失败')
    } finally {
      setAssigning(false)
    }
  }

  // 审核后生产项目可以逐个决定工厂能不能看到（打版费这类项目工厂不用看到）
  const toggleFactoryVisible = async (item: any, visible: boolean) => {
    setSavingVisible(item.id)
    try {
      await pb.send('/api/gg/orders-item-visibility', {
        method: 'POST',
        body: { order_item_id: item.id, factory_visible: visible },
      })
      setItemsFinal(itemsFinal.map((x) => (x.id === item.id ? { ...x, factory_visible: visible } : x)))
    } catch (e: any) {
      message.error(e?.message || '设置失败')
    } finally {
      setSavingVisible('')
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin />
      </div>
    )
  }
  if (!order) return <Empty description="订单不存在" />

  const reviewTag = () => {
    if (order.review_status === 'approved') return <Tag color="success">已审核</Tag>
    if (order.review_status === 'rejected') return <Tag color="error">已驳回</Tag>
    if (order.review_status === 'agent_pending') return <Tag color="processing">待代理确认</Tag>
    return <Tag color="warning">待审核</Tag>
  }
  // 只有「待代理确认」状态、且是这张单的代理，才能核对编辑
  const canAgentConfirm = roleCode === 'agent' && order.review_status === 'agent_pending'

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>
          返回
        </Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {order.order_no}
        </Typography.Title>
        <Tag color={STATUS_MAP[order.status]?.color}>
          {isFactory && order.status === 'cancelled'
            ? '订单关闭'
            : STATUS_MAP[order.status]?.text || order.status}
        </Tag>
        {reviewTag()}
        {canReview && (
          <Button type="primary" icon={<AuditOutlined />} onClick={() => setReviewOpen(true)}>
            审核
          </Button>
        )}
        {canReview && order.status !== 'cancelled' && (
          <Button danger onClick={closeOrder}>
            关闭订单
          </Button>
        )}
        {canAgentConfirm && (
          <Button type="primary" icon={<EditOutlined />} onClick={() => setReviewOpen(true)}>
            核对并提交
          </Button>
        )}
        {canScore && (
          <Button icon={<StarOutlined />} onClick={() => setScoreOpen(true)}>
            打分
          </Button>
        )}
        <Button icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
          导出 Word
        </Button>
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card className="page-card" title="订单信息" style={{ marginBottom: 16 }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="联系人">{order.contact_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="电话">{order.phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="下单时间">
                {dayjs(order.created).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="贴合度">
                {avgScore ? `${avgScore} 分（${reviews.length} 次）` : '未打分'}
              </Descriptions.Item>
              <Descriptions.Item label="所属代理">
                {order.expand?.agent?.display_name || order.expand?.agent?.username || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="终端售价">
                {terminalPrice ? `¥${yuan(terminalPrice)}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="生产工厂" span={2}>
                {canReview ? (
                  <Select
                    size="small"
                    allowClear
                    style={{ minWidth: 160 }}
                    value={order.factory || undefined}
                    placeholder="未指派（指派后才算工厂成本）"
                    loading={assigning}
                    onChange={assignFactory}
                    options={factories.map((f) => ({
                      value: f.id,
                      label: f.display_name || f.username,
                    }))}
                  />
                ) : (
                  order.expand?.factory?.display_name || order.expand?.factory?.username || '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="地址" span={2}>
                {order.address || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {order.remark ? (
                  <div
                    className="rich-remark"
                    dangerouslySetInnerHTML={{ __html: remarkHtml(order.remark) }}
                  />
                ) : (
                  '-'
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {specCustomer && (
            <Card className="page-card" title="客户原始尺寸" style={{ marginBottom: 16 }}>
              <div className="measure-text">{customerText || '（无）'}</div>
              {specCustomer.fabric && (
                <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
                  面料：{specCustomer.fabric}
                </div>
              )}
            </Card>
          )}

          {specProduction && (
            <Card className="page-card" title="生产尺寸" style={{ marginBottom: 16 }}>
              <div className="measure-text">{productionText || '（无）'}</div>
              {specProduction.production_remark && (
                <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
                  生产备注：{specProduction.production_remark}
                </div>
              )}
            </Card>
          )}

          <Card className="page-card" title="定制项目" style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>客户选择</div>
                {itemsCustomer.length === 0 && <span style={{ color: '#999' }}>无</span>}
                {itemsCustomer.map((it) => (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      {it.name}
                      {it.spec ? `（${it.spec}）` : ''}
                    </span>
                    <span style={{ color: '#999' }}>{itemQtyText(it)}</span>
                  </div>
                ))}
              </Col>
              <Col span={12}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>
                  审核后生产
                  {canReview && itemsFinal.length > 0 && (
                    <span style={{ fontWeight: 400, fontSize: 12, color: '#999', marginLeft: 8 }}>
                      取消勾选的项目工厂看不到
                    </span>
                  )}
                </div>
                {itemsFinal.length === 0 && <span style={{ color: '#999' }}>未审核</span>}
                {itemsFinal.map((it) => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1 }}>
                      {it.name}
                      {it.spec ? `（${it.spec}）` : ''}
                    </span>
                    {canReview && (
                      <Checkbox
                        checked={it.factory_visible !== false}
                        disabled={savingVisible === it.id}
                        onChange={(e) => toggleFactoryVisible(it, e.target.checked)}
                      >
                        <span style={{ fontSize: 12, color: it.factory_visible === false ? '#bbb' : '#999' }}>
                          给工厂看
                        </span>
                      </Checkbox>
                    )}
                    <span style={{ color: '#999', width: 40, textAlign: 'right' }}>{itemQtyText(it)}</span>
                  </div>
                ))}
              </Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card className="page-card" title="价格" style={{ marginBottom: 16 }}>
            {prices.length === 0 && <Empty description="暂无可查看的价格" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            {prices.map((p: any) => {
              const lines: PriceLine[] = p.detail_json || []
              return (
                <Card
                  key={p.id}
                  size="small"
                  type="inner"
                  title={
                    <Space>
                      <Tag color="blue">{p.expand?.version?.name || '价格版本'}</Tag>
                      {/* 价格行本身就归这单的代理/工厂，看版本标识就知道是谁的价 */}
                      {p.expand?.version?.code === 'agent' && order.agent && (
                        <Tag color="geekblue">本单代理成本</Tag>
                      )}
                      {p.expand?.version?.code === 'factory' && (
                        <Tag color="purple">本单工厂成本</Tag>
                      )}
                      {p.price_mode === 'fixed' && <Tag color="orange">固定价</Tag>}
                    </Space>
                  }
                  extra={
                    canReview ? (
                      <Button size="small" icon={<EditOutlined />} onClick={() => openAdjust(p)}>
                        加价
                      </Button>
                    ) : null
                  }
                  style={{ marginBottom: 12 }}
                >
                  <Table<PriceLine>
                    size="small"
                    pagination={false}
                    rowKey={(r, i) => `${r.name}-${i}`}
                    dataSource={lines}
                    columns={[
                      { title: '项目', dataIndex: 'name' },
                      { title: '单价', dataIndex: 'unit_cents', width: 70, align: 'right', render: (v: number) => yuan(v) },
                      {
                        title: '数量',
                        dataIndex: 'qty',
                        width: 70,
                        align: 'center',
                        render: (v: number, r: PriceLine) =>
                          r.qty_mode === 'qty' ? `${v}${r.unit || ''}` : '',
                      },
                      { title: '小计', dataIndex: 'amount_cents', width: 70, align: 'right', render: (v: number) => yuan(v) },
                    ]}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: '#888' }}>
                      基础 {yuan(p.base_cents)} + 项目 {yuan(p.items_cents)}
                      {p.adjust_cents ? ` + 调整 ${yuan(p.adjust_cents)}` : ''}
                    </span>
                    <span className="price-total">¥{yuan(p.total_cents)}</span>
                  </div>
                  {/* 每一笔加价都带备注，事后能看懂价格是怎么来的 */}
                  {adjustments
                    .filter((a) => a.version === p.version)
                    .map((a) => (
                      <div key={a.id} style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                        {a.amount_cents > 0 ? '+' : ''}¥{yuan(a.amount_cents)} · {a.reason || '无备注'}
                        <span style={{ color: '#bbb', marginLeft: 6 }}>
                          {dayjs(a.created).format('MM-DD HH:mm')}
                        </span>
                      </div>
                    ))}
                </Card>
              )
            })}
          </Card>

          {reviews.length > 0 && (
            <Card className="page-card" title="贴合度记录">
              {reviews.map((r) => (
                <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <Space>
                    <Tag color="gold">{r.score} 分</Tag>
                    <span style={{ color: '#888', fontSize: 12 }}>
                      {dayjs(r.created).format('MM-DD HH:mm')}
                    </span>
                  </Space>
                  {r.remark && <div style={{ color: '#666', fontSize: 13 }}>{r.remark}</div>}
                </div>
              ))}
            </Card>
          )}
        </Col>
      </Row>

      <ReviewModal
        open={reviewOpen}
        orderId={id}
        mode={canAgentConfirm ? 'agent' : 'review'}
        terminalPrice={terminalPrice}
        // 代理核对时以「代理上次调整后的尺寸」为基准，没有就用客户原始值
        customerData={(canAgentConfirm && specCustomer?.agent_data) || customerData}
        productionData={productionData}
        customerItems={toModalItems(canAgentConfirm && itemsAgent.length ? itemsAgent : itemsCustomer)}
        customerItemsOriginal={toModalItems(itemsCustomer)}
        onClose={() => setReviewOpen(false)}
        onDone={load}
      />

      <Modal
        title={`加价 · ${adjustTarget?.expand?.version?.name || '价格版本'}`}
        open={adjustOpen}
        onCancel={() => setAdjustOpen(false)}
        onOk={submitAdjust}
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12, fontSize: 13, color: '#888' }}>
            底价由账号上配的项目价自动计算，这里只能加价（负数表示减价），
            并写清原因。当前 ¥{yuan(adjustTarget?.total_cents || 0)}
          </div>
          <Form.Item
            label="本次加价（元）"
            name="amount"
            rules={[{ required: true, message: '请填写加价金额' }]}
          >
            <InputNumber precision={2} style={{ width: '100%' }} placeholder="如 60" />
          </Form.Item>
          <Form.Item
            label="加价备注"
            name="reason"
            rules={[{ required: true, message: '请写清加价原因' }]}
          >
            <Input.TextArea rows={2} placeholder="如：这个颜色特殊" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="贴合度打分" open={scoreOpen} onCancel={() => setScoreOpen(false)} onOk={submitScore} okText="提交">
        <Form form={scoreForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="分数（1-10）" name="score" rules={[{ required: true, message: '请打分' }]}>
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <ExportWordModal
        open={exportOpen}
        orderIds={[id]}
        onClose={() => setExportOpen(false)}
      />
    </div>
  )
}
