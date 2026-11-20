import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import { pb, STATUS_MAP, type MeasureField, type Order } from '../pb'

const { Text: TText, Paragraph } = Typography

// 「已经生产」= 生产中 / 已发货 / 已完成；待确认、已取消、被驳回的都不参与对比
const PRODUCED_FILTER =
  'is_deleted != true && review_status = "approved" && (status = "producing" || status = "shipped" || status = "done")'

type ScoreInfo = { avg: number; count: number; remark: string }

type Pattern = {
  id: string
  order: Order
  orderNo: string
  code: string
  data: Record<string, any>
  fabric: string
  remark: string
  score?: ScoreInfo
  created: string
}

type Diff = {
  key: string
  label: string
  unit: string
  target: string
  candidate: string
  delta?: number
  state: 'same' | 'near' | 'diff'
}

type Compared = Pattern & {
  similarity: number
  same: number
  near: number
  diffCount: number
  total: number
  diffs: Diff[]
}

const round = (n: number, p = 2) => {
  const f = Math.pow(10, p)
  return Math.round(n * f) / f
}

const isEmptyValue = (v: any) => v === undefined || v === null || v === ''

/** 版型编号：启用字段按 key 排序、数值统一精度后做双 FNV 哈希。同一组尺寸恒等。 */
function patternCode(data: Record<string, any>, fields: MeasureField[]): string {
  const parts: string[] = []
  fields
    .filter((f) => f.is_active !== false)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .forEach((f) => {
      const raw = data?.[f.key]
      if (isEmptyValue(raw)) return
      if (f.type === 'number') {
        const n = Number(raw)
        if (!isFinite(n)) return
        parts.push(`${f.key}=${round(n, typeof f.decimals === 'number' ? f.decimals : 1)}`)
      } else {
        parts.push(`${f.key}=${String(raw)}`)
      }
    })

  const canonical = parts.join('|')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return `P-${(h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase()}`
}

/** 逐字段对比。数值在容差内算「差很少」，超出按 4 倍容差线性衰减。 */
function compare(target: Record<string, any>, p: Pattern, fields: MeasureField[], tolerance: number) {
  let sum = 0
  let count = 0
  let same = 0
  let near = 0
  let diffCount = 0
  const diffs: Diff[] = []

  fields
    .filter((f) => f.is_active !== false)
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .forEach((f) => {
      const a = target?.[f.key]
      const b = p.data?.[f.key]
      if (isEmptyValue(a) && isEmptyValue(b)) return
      count++

      let s = 0
      let state: Diff['state'] = 'diff'
      let delta: number | undefined
      if (isEmptyValue(a) || isEmptyValue(b)) {
        state = 'diff'
      } else if (f.type === 'number') {
        const na = Number(a)
        const nb = Number(b)
        if (!isFinite(na) || !isFinite(nb)) {
          state = String(a) === String(b) ? 'same' : 'diff'
          s = state === 'same' ? 1 : 0
        } else {
          delta = round(na - nb)
          const d = Math.abs(na - nb)
          if (d <= 1e-9) {
            state = 'same'
            s = 1
          } else if (d <= tolerance) {
            state = 'near'
            s = 1
          } else {
            state = 'diff'
            s = Math.max(0, 1 - (d - tolerance) / (tolerance * 4 || 1))
          }
        }
      } else {
        state = String(a) === String(b) ? 'same' : 'diff'
        s = state === 'same' ? 1 : 0
      }

      sum += s
      if (state === 'same') same++
      else if (state === 'near') near++
      else diffCount++
      diffs.push({
        key: f.key,
        label: f.label || f.key,
        unit: f.unit || '',
        target: isEmptyValue(a) ? '-' : String(a),
        candidate: isEmptyValue(b) ? '-' : String(b),
        delta,
        state,
      })
    })

  diffs.sort((x, y) => Math.abs(y.delta || 0) - Math.abs(x.delta || 0))
  return {
    ...p,
    similarity: count ? round((sum / count) * 100, 1) : 0,
    same,
    near,
    diffCount,
    total: count,
    diffs,
  } as Compared
}

function verdict(r: Compared) {
  if (r.same === r.total && r.total > 0) return { text: '完全一致 · 直接复用', color: 'green' }
  if (r.similarity >= 95) return { text: '高度相似 · 微调可用', color: 'cyan' }
  if (r.similarity >= 80) return { text: '相似 · 可参考', color: 'blue' }
  return { text: '差异较大', color: 'default' }
}

export default function PatternSimilarity() {
  const { message } = App.useApp()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [fields, setFields] = useState<MeasureField[]>([])

  const [refOrder, setRefOrder] = useState<string | undefined>()
  const [targetText, setTargetText] = useState('')
  const [tolerance, setTolerance] = useState(0.5)
  const [minSimilarity, setMinSimilarity] = useState(80)
  const [limit, setLimit] = useState(20)
  const [target, setTarget] = useState<Record<string, any> | null>(null)
  const [tab, setTab] = useState('library')
  const [viewing, setViewing] = useState<Pattern | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [orders, specs, reviews, fs] = await Promise.all([
        pb.collection('orders').getFullList<Order>({ filter: PRODUCED_FILTER, sort: '-created' }),
        pb.collection('order_specs_production').getFullList<any>(),
        pb.collection('order_reviews').getFullList<any>(),
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
      ])

      const specMap = new Map<string, any>()
      specs.forEach((s) => specMap.set(s.order, s))

      const scoreMap = new Map<string, ScoreInfo>()
      reviews.forEach((r) => {
        const prev = scoreMap.get(r.order)
        const score = Number(r.score)
        if (!prev) {
          scoreMap.set(r.order, { avg: score, count: 1, remark: r.remark || '' })
        } else {
          const count = prev.count + 1
          scoreMap.set(r.order, {
            avg: round((prev.avg * prev.count + score) / count, 1),
            count,
            remark: r.remark || prev.remark,
          })
        }
      })

      const usableFields = fs.filter((f) => f.is_active !== false)
      const list: Pattern[] = orders
        .map((o) => {
          const spec = specMap.get(o.id)
          const data = (spec?.data && typeof spec.data === 'object' ? spec.data : {}) as Record<string, any>
          if (!Object.keys(data).length) return null
          return {
            id: o.id,
            order: o,
            orderNo: o.order_no,
            code: patternCode(data, usableFields),
            data,
            fabric: spec?.fabric || '',
            remark: spec?.production_remark || '',
            score: scoreMap.get(o.id),
            created: o.created,
          } as Pattern
        })
        .filter(Boolean) as Pattern[]

      setPatterns(list)
      setFields(usableFields)
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickRef = (id: string | undefined) => {
    setRefOrder(id)
    if (!id) return
    const p = patterns.find((x) => x.id === id)
    if (p) setTargetText(JSON.stringify(p.data, null, 2))
  }

  const runQuery = () => {
    let parsed: any
    try {
      parsed = JSON.parse(targetText)
    } catch {
      message.error('参考尺寸不是合法 JSON')
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      message.error('参考尺寸需要是 { 字段key: 数值 } 形式的 JSON 对象')
      return
    }
    const filled = Object.values(parsed).some((v) => !isEmptyValue(v))
    if (!filled) {
      message.error('参考尺寸至少填一个字段')
      return
    }
    setTarget(parsed)
    setTab('result')
  }

  const results = useMemo(() => {
    if (!target) return []
    return patterns
      .map((p) => compare(target, p, fields, tolerance))
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity || (b.score?.avg || 0) - (a.score?.avg || 0))
      .slice(0, limit)
  }, [target, patterns, fields, tolerance, minSimilarity, limit])

  const scoreTag = (s?: ScoreInfo) =>
    s ? (
      <Tooltip title={`${s.count} 次打分${s.remark ? `：${s.remark}` : ''}`}>
        <Tag color={s.avg >= 8 ? 'green' : s.avg >= 6 ? 'orange' : 'red'}>{s.avg.toFixed(1)} / 10</Tag>
      </Tooltip>
    ) : (
      <TText type="secondary">未评分</TText>
    )

  const libraryColumns = [
    {
      title: '版型编号',
      dataIndex: 'code',
      width: 200,
      render: (code: string, r: Pattern) => (
        <TText code copyable={{ text: code }} style={{ cursor: 'pointer' }} onClick={() => setViewing(r)}>
          {code}
        </TText>
      ),
    },
    {
      title: '订单号',
      dataIndex: 'orderNo',
      width: 150,
      render: (no: string, r: Pattern) => <Link to={`/orders/${r.id}`}>{no}</Link>,
    },
    {
      title: '状态',
      dataIndex: ['order', 'status'],
      width: 100,
      render: (s: string) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.text || s}</Tag>,
    },
    { title: '满意度', dataIndex: 'score', width: 120, render: (s?: ScoreInfo) => scoreTag(s) },
    {
      title: '尺寸字段',
      key: 'fieldCount',
      width: 90,
      render: (_: any, r: Pattern) => Object.keys(r.data).length,
    },
    { title: '面料', dataIndex: 'fabric', ellipsis: true },
    { title: '生产备注', dataIndex: 'remark', ellipsis: true },
    {
      title: '生产日期',
      dataIndex: 'created',
      width: 160,
      render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
    },
  ]

  const resultColumns = [
    {
      title: '版型编号',
      dataIndex: 'code',
      width: 200,
      render: (code: string, r: Compared) => (
        <TText code copyable={{ text: code }} style={{ cursor: 'pointer' }} onClick={() => setViewing(r)}>
          {code}
        </TText>
      ),
    },
    {
      title: '相似度',
      dataIndex: 'similarity',
      width: 160,
      sorter: (a: Compared, b: Compared) => a.similarity - b.similarity,
      render: (v: number, r: Compared) => (
        <Tooltip title={`一致 ${r.same} 项 / 微差 ${r.near} 项 / 不同 ${r.diffCount} 项（共 ${r.total} 项）`}>
          <Tag color={v >= 95 ? 'green' : v >= 80 ? 'blue' : 'default'}>{v}%</Tag>
        </Tooltip>
      ),
    },
    {
      title: '复用建议',
      key: 'verdict',
      width: 180,
      render: (_: any, r: Compared) => {
        const v = verdict(r)
        return <Tag color={v.color}>{v.text}</Tag>
      },
    },
    {
      title: '订单号',
      dataIndex: 'orderNo',
      width: 150,
      render: (no: string, r: Compared) => <Link to={`/orders/${r.id}`}>{no}</Link>,
    },
    { title: '满意度', dataIndex: 'score', width: 120, render: (s?: ScoreInfo) => scoreTag(s) },
    {
      title: '差异字段',
      key: 'diff',
      width: 110,
      render: (_: any, r: Compared) => (
        <Tooltip
          title={r.diffs
            .filter((d) => d.state !== 'same')
            .slice(0, 8)
            .map((d) => `${d.label}: ${d.target} → ${d.candidate}`)
            .join('\n')}
        >
          <span>{r.diffCount + r.near} 项</span>
        </Tooltip>
      ),
    },
    { title: '面料', dataIndex: 'fabric', ellipsis: true },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1500, margin: '0 auto' }}>
      <Card
        title="版型相似度查询"
        extra={
          <Space>
            <Tag color="blue">已审核 · 已生产</Tag>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          只对比审核通过且已进入生产（生产中 / 已发货 / 已完成）的订单，带出满意度。编号由启用尺寸字段生成：编号相同即尺寸完全一致；相似度高的版型可直接复用或只做微调。
        </Paragraph>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <div style={{ marginBottom: 6 }}>从已生产版型带入参考尺寸</div>
              <Select
                allowClear
                showSearch
                placeholder="选择订单 / 版型编号"
                value={refOrder}
                onChange={pickRef}
                style={{ width: '100%' }}
                optionFilterProp="label"
                options={patterns.map((p) => ({
                  value: p.id,
                  label: `${p.code.slice(0, 12)} · ${p.orderNo} · ${p.score ? p.score.avg : '-'}分`,
                }))}
              />
            </div>
            <div>
              <div style={{ marginBottom: 6 }}>或粘贴新尺寸 JSON（字段 key 见「量体字段」）</div>
              <Input.TextArea
                rows={10}
                value={targetText}
                onChange={(e) => {
                  setTargetText(e.target.value)
                  setRefOrder(undefined)
                }}
                placeholder={'{\n  "height": 164,\n  "chest": 88,\n  "waist": 70\n}'}
              />
            </div>
          </Space>

          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Space wrap size={24}>
              <div>
                <div style={{ marginBottom: 6 }}>数值容差（cm/kg，差值在此内视为一致）</div>
                <InputNumber min={0} max={20} step={0.1} value={tolerance} onChange={(v) => setTolerance(v ?? 0)} />
              </div>
              <div>
                <div style={{ marginBottom: 6 }}>最低相似度 %</div>
                <InputNumber min={0} max={100} step={5} value={minSimilarity} onChange={(v) => setMinSimilarity(v ?? 0)} />
              </div>
              <div>
                <div style={{ marginBottom: 6 }}>最多返回</div>
                <InputNumber min={1} max={200} value={limit} onChange={(v) => setLimit(v ?? 20)} />
              </div>
            </Space>
            <div style={{ background: '#fafafa', padding: 12, borderRadius: 6 }}>
              <TText type="secondary">
                已收录 <TText strong>{patterns.length}</TText> 个已生产版型 · 启用尺寸字段 <TText strong>{fields.length}</TText> 项 · 有满意度记录的{' '}
                <TText strong>{patterns.filter((p) => p.score).length}</TText> 个
              </TText>
            </div>
            <Button type="primary" icon={<SearchOutlined />} onClick={runQuery} block loading={loading}>
              查询相似版型
            </Button>
          </Space>
        </div>
      </Card>

      <Card style={{ marginTop: 16 }} loading={loading}>
        <Tabs activeKey={tab} onChange={setTab}>
          <Tabs.TabPane tab="已生产版型库" key="library">
            <Table
              rowKey="id"
              columns={libraryColumns as any}
              dataSource={patterns}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true }}
              locale={{ emptyText: <Empty description="暂无已审核且已生产的版型" /> }}
            />
          </Tabs.TabPane>
          <Tabs.TabPane tab={`相似查询结果${target ? `（${results.length}）` : ''}`} key="result">
            {!target ? (
              <Empty description="请先在上方选择或输入参考尺寸，再点「查询相似版型」" />
            ) : (
              <>
                <Space style={{ marginBottom: 12 }}>
                  <Tag>参考编号：{patternCode(target, fields)}</Tag>
                  <Button size="small" onClick={() => { setTarget(null); setTab('library') }}>
                    返回版型库
                  </Button>
                </Space>
                <Table
                  rowKey="id"
                  columns={resultColumns as any}
                  dataSource={results}
                  size="small"
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  expandable={{
                    expandedRowRender: (r: Compared) => (
                      <Table
                        rowKey="key"
                        size="small"
                        pagination={false}
                        dataSource={r.diffs}
                        columns={[
                          { title: '字段', dataIndex: 'label', width: 160 },
                          { title: '参考值', dataIndex: 'target', width: 120 },
                          { title: '版型值', dataIndex: 'candidate', width: 120 },
                          {
                            title: '差值',
                            dataIndex: 'delta',
                            width: 100,
                            render: (d: number | undefined, x: Diff) =>
                              d === undefined ? '-' : `${d > 0 ? '+' : ''}${d}${x.unit}`,
                          },
                          {
                            title: '判定',
                            dataIndex: 'state',
                            render: (s: Diff['state']) => (
                              <Tag color={s === 'same' ? 'green' : s === 'near' ? 'cyan' : 'red'}>
                                {s === 'same' ? '一致' : s === 'near' ? '微差' : '不同'}
                              </Tag>
                            ),
                          },
                        ]}
                      />
                    ),
                  }}
                  locale={{ emptyText: <Empty description="没有达到最低相似度的版型，可下调阈值再查" /> }}
                />
              </>
            )}
          </Tabs.TabPane>
        </Tabs>
      </Card>

      <Drawer
        title={`版型详情 ${viewing?.code || ''}`}
        width={560}
        open={!!viewing}
        onClose={() => setViewing(null)}
        extra={viewing && <Button type="link" onClick={() => navigate(`/orders/${viewing.id}`)}>查看订单</Button>}
      >
        {viewing && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="订单号">{viewing.orderNo}</Descriptions.Item>
              <Descriptions.Item label="满意度">{scoreTag(viewing.score)}</Descriptions.Item>
              <Descriptions.Item label="状态">{STATUS_MAP[viewing.order.status]?.text}</Descriptions.Item>
              <Descriptions.Item label="生产日期">{new Date(viewing.created).toLocaleDateString('zh-CN')}</Descriptions.Item>
              <Descriptions.Item label="面料" span={2}>{viewing.fabric || '-'}</Descriptions.Item>
              <Descriptions.Item label="生产备注" span={2}>{viewing.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <Descriptions size="small" column={2} bordered title="生产尺寸">
              {fields
                .filter((f) => !isEmptyValue(viewing.data[f.key]))
                .map((f) => (
                  <Descriptions.Item key={f.id} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`}>
                    {String(viewing.data[f.key])}
                  </Descriptions.Item>
                ))}
            </Descriptions>
          </>
        )}
      </Drawer>
    </div>
  )
}
