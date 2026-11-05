import { useEffect, useState } from 'react'
import { App, Button, Card, Descriptions, Drawer, Input, Space, Table, Tag, type TableProps } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { pb, type MeasureField, type MeasureGroup, type Measurement } from '../pb'

export default function MeasurementList() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Measurement[]>([])
  const [fields, setFields] = useState<MeasureField[]>([])
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [kw, setKw] = useState('')
  const [current, setCurrent] = useState<Measurement | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const filter = kw.trim()
        ? `(code ~ "${kw.trim().replace(/"/g, '')}" || name ~ "${kw.trim().replace(/"/g, '')}" || phone ~ "${kw.trim().replace(/"/g, '')}")`
        : ''
      const [ms, fs, gs] = await Promise.all([
        pb.collection('measurements').getFullList<Measurement>({ filter, sort: '-updated' }),
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
        pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' }),
      ])
      setRows(ms)
      setFields(fs)
      setGroups(gs)
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

  const columns: TableProps<Measurement>['columns'] = [
    { title: '尺码编号', dataIndex: 'code', width: 120, render: (v) => <span className="mono">{v}</span> },
    { title: '姓名', dataIndex: 'name', width: 100 },
    { title: '电话', dataIndex: 'phone', width: 130 },
    { title: '性别', dataIndex: 'gender', width: 70 },
    { title: '面料', dataIndex: 'fabric', ellipsis: true },
    {
      title: '更新时间',
      dataIndex: 'updated',
      width: 160,
      render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    { title: '操作', width: 80, render: (_v, r) => <a onClick={() => setCurrent(r)}>查看</a> },
  ]

  const renderDetail = () => {
    if (!current) return null
    const data = current.data || {}
    return (
      <Drawer
        title={`${current.code} / ${current.name || ''}`}
        open={!!current}
        onClose={() => setCurrent(null)}
        width={520}
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="电话">{current.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="性别">{current.gender || '-'}</Descriptions.Item>
          <Descriptions.Item label="面料">{current.fabric || '-'}</Descriptions.Item>
          <Descriptions.Item label="备注">{current.remark || '-'}</Descriptions.Item>
        </Descriptions>

        {groups.map((g) => {
          const items = fields.filter((f) => f.group === g.id && data[f.key] !== undefined && data[f.key] !== '')
          if (!items.length) return null
          return (
            <div key={g.id} style={{ marginTop: 16 }}>
              <Tag color="blue">{g.name}</Tag>
              <Descriptions column={2} size="small" style={{ marginTop: 8 }}>
                {items.map((f) => (
                  <Descriptions.Item key={f.key} label={f.label}>
                    {String(data[f.key])}
                    {f.unit || ''}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
          )
        })}
      </Drawer>
    )
  }

  return (
    <Card
      className="page-card"
      title="量体档案"
      extra={
        <Space>
          <Input
            prefix={<SearchOutlined />}
            placeholder="编号 / 姓名 / 电话"
            allowClear
            style={{ width: 220 }}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onPressEnter={load}
          />
          <Button onClick={load}>查询</Button>
        </Space>
      }
    >
      <Table<Measurement>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
      {renderDetail()}
    </Card>
  )
}
