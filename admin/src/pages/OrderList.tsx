import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  App,
  type TableProps,
} from 'antd'
import { ReloadOutlined, SearchOutlined, DownloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { pb, STATUS_MAP, yuan, type Order, type OrderPrice } from '../pb'
import { useAuth } from '../auth'
import ExportWordModal from '../components/ExportWordModal'

const { RangePicker } = DatePicker

type Row = Order & { prices: OrderPrice[]; displayPrice?: OrderPrice }

export default function OrderList() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { user } = useAuth()
  const isFactory = (user as any)?.role_code === 'factory'

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [kw, setKw] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [catalog, setCatalog] = useState<string | undefined>()
  const [catalogs, setCatalogs] = useState<string[]>([])
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [exportIds, setExportIds] = useState<string[]>([])

  // 品类筛选：从项目字典里取，空品类的历史订单按衣服算
  useEffect(() => {
    pb.collection('items')
      .getFullList<any>({ filter: 'is_deleted != true', sort: 'sort' })
      .then((list) => {
        const out: string[] = []
        list.forEach((it) => {
          const c = it.catalog || '衣服'
          if (out.indexOf(c) < 0) out.push(c)
        })
        setCatalogs(out)
      })
      .catch(() => {})
  }, [])

  const load = async (p = page, ps = pageSize) => {
    setLoading(true)
    try {
      const parts = ['is_deleted != true']
      // 工厂只看已确认及之后的单；关闭单也留着，但置灰提示，不直接消失
      if (isFactory) parts.push('status != "pending"')
      if (kw.trim()) {
        const safe = kw.trim().replace(/"/g, '')
        parts.push(`(order_no ~ "${safe}" || phone ~ "${safe}" || contact_name ~ "${safe}")`)
      }
      if (status) parts.push(`status = "${status}"`)
      if (catalog) {
        // 改造前的订单没有 catalog，都算衣服
        parts.push(
          catalog === '衣服'
            ? '(catalog = "衣服" || catalog = "")'
            : `catalog = "${catalog}"`
        )
      }
      if (range) {
        parts.push(
          `created >= "${range[0].format('YYYY-MM-DD 00:00:00')}" && created <= "${range[1].format(
            'YYYY-MM-DD 23:59:59'
          )}"`
        )
      }

      const res = await pb.collection('orders').getList<Order>(p, ps, {
        filter: parts.join(' && '),
        sort: '-created',
        // 代理名称要展开才能拿到，没归属代理的订单 expand 为空
        expand: 'agent',
      })

      // 只取我自己有权看到的版本价格（规则在服务端已过滤）
      const byOrder: Record<string, OrderPrice[]> = {}
      if (res.items.length) {
        const f = res.items.map((o) => `order="${o.id}"`).join(' || ')
        const prices = await pb.collection('order_prices').getFullList<OrderPrice>({
          filter: f,
          expand: 'version',
        })
        prices.forEach((pr) => {
          ;(byOrder[pr.order] ||= []).push(pr)
        })
        Object.values(byOrder).forEach((list) => {
          list.sort((a, b) => {
            const sa = Number((a as any).expand?.version?.sort ?? 0)
            const sb = Number((b as any).expand?.version?.sort ?? 0)
            return sa - sb
          })
        })
      }

      setRows(
        res.items.map((o) => ({
          ...o,
          prices: byOrder[o.id] || [],
          displayPrice: (byOrder[o.id] || [])[0],
        }))
      )
      setTotal(res.totalItems)
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(page, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize])

  // 工厂在列表直接完结，复用详情页同一个接口
  const complete = (r: Row) => {
    Modal.confirm({
      title: `完结 ${r.order_no}？`,
      content: '完结后订单标记为「已完成」，审核员和代理就可以打分了。',
      okText: '确认完结',
      onOk: async () => {
        try {
          await pb.send('/api/gg/orders-complete', { method: 'POST', body: { order_id: r.id } })
          message.success('订单已完结')
          load(page, pageSize)
        } catch (e: any) {
          message.error(e?.message || '完结失败')
        }
      },
    })
  }

  const columns: TableProps<Row>['columns'] = useMemo(
    () => [
      {
        title: '订单号',
        dataIndex: 'order_no',
        width: 150,
        render: (v, r) => <a onClick={() => navigate(`/orders/${r.id}`)}>{v}</a>,
      },
      {
        title: '品类',
        dataIndex: 'catalog',
        width: 80,
        render: (v: string) => <Tag color="geekblue">{v || '衣服'}</Tag>,
      },
      {
        title: '客户',
        dataIndex: 'contact_name',
        width: 100,
        render: (v) => v || '-',
      },
      { title: '电话', dataIndex: 'phone', width: 120, render: (v) => v || '-' },
      {
        title: '地址',
        dataIndex: 'address',
        ellipsis: true,
        render: (v) => (
          <Tooltip title={v}>
            <span>{v || '-'}</span>
          </Tooltip>
        ),
      },
      {
        title: '代理名称',
        dataIndex: 'agent',
        width: 110,
        render: (_v, r) => r.expand?.agent?.display_name || r.expand?.agent?.username || '-',
      },
      {
        title: '审核',
        dataIndex: 'review_status',
        width: 90,
        render: (v: string) => {
          if (v === 'approved') return <Tag color="success">已审核</Tag>
          if (v === 'rejected') return <Tag color="error">已驳回</Tag>
          return <Tag color="warning">待审核</Tag>
        },
      },
      {
        title: '下单时间',
        dataIndex: 'created',
        width: 160,
        render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 90,
        render: (v: string) => {
          if (isFactory && v === 'cancelled') return <Tag color="default">订单关闭</Tag>
          const s = STATUS_MAP[v] || { text: v, color: 'default' }
          return <Tag color={s.color}>{s.text}</Tag>
        },
      },
      {
        title: '金额',
        width: 110,
        align: 'right',
        render: (_v, r) => (
          <span style={{ fontWeight: 600 }}>{r.displayPrice ? '¥' + yuan(r.displayPrice.total_cents) : '-'}</span>
        ),
      },
      {
        title: '操作',
        width: 110,
        fixed: 'right',
        render: (_v, r) => (
          <Space size={8}>
            <a onClick={() => navigate(`/orders/${r.id}`)}>查看</a>
            {isFactory && ['confirmed', 'producing', 'shipped'].includes(r.status) && (
              <a onClick={() => complete(r)}>完结</a>
            )}
          </Space>
        ),
      },
    ],
    [navigate, isFactory, page, pageSize]
  )

  return (
    <Card
      className="page-card"
      title="订单管理"
      extra={
        <Space>
          <Button
            icon={<DownloadOutlined />}
            disabled={selected.length === 0}
            onClick={() => setExportIds(selected)}
          >
            导出选中 ({selected.length})
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => load(page, pageSize)} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="订单号 / 电话 / 姓名"
          allowClear
          style={{ width: 240 }}
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onPressEnter={() => {
            setPage(1)
            load(1, pageSize)
          }}
        />
        <Select
          placeholder="订单状态"
          allowClear
          style={{ width: 130 }}
          value={status}
          onChange={(v) => setStatus(v)}
          options={Object.entries(STATUS_MAP)
            .filter(([value]) => !isFactory || value !== 'pending')
            .map(([value, s]) => ({ value, label: s.text }))}
        />
        <Select
          placeholder="品类"
          allowClear
          style={{ width: 110 }}
          value={catalog}
          onChange={(v) => setCatalog(v)}
          options={catalogs.map((c) => ({ value: c, label: c }))}
        />
        <RangePicker
          value={range as any}
          onChange={(v) => setRange(v as any)}
          style={{ width: 240 }}
        />
        <Button
          type="primary"
          onClick={() => {
            setPage(1)
            load(1, pageSize)
          }}
        >
          查询
        </Button>
      </Space>

      <Table<Row>
        rowKey="id"
        rowClassName={(r) => (r.status === 'cancelled' ? 'order-closed-row' : '')}
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1210 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as string[]),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
      />
      {user && (
        <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
          当前账号可见价格版本：
          {user.can_view_all_prices ? '全部版本' : '仅所属版本'}
        </div>
      )}
      <ExportWordModal
        open={exportIds.length > 0}
        orderIds={exportIds}
        onClose={() => setExportIds([])}
      />
    </Card>
  )
}
