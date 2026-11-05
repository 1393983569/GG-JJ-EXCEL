import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  type TableProps,
} from 'antd'
import { PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { pb, type MeasureField, type MeasureGroup } from '../pb'

const WRAP_TIP = (
  <div style={{ maxWidth: 280 }}>
    开启后，<b>同一分组内相邻</b>的几个字段会在导出文本里合并成一个括号，减少重复前缀。
    <div style={{ marginTop: 6 }}>
      例：中指 / 大拇指 / 小拇指 同属「手指长」组，都开启后输出为
      <div style={{ marginTop: 4, color: '#d9f7be' }}>
        手指长（中指: 9cm, 大拇指: 6cm, 小拇指: 5cm）
      </div>
      不开则输出为
      <div style={{ marginTop: 4, color: '#ffd8bf' }}>中指: 9cm，大拇指: 6cm，小拇指: 5cm</div>
    </div>
    <div style={{ marginTop: 6 }}>只影响导出/复制的尺寸文本，不影响数据本身和价格计算。</div>
  </div>
)

export default function MeasureFieldList() {
  const { message } = App.useApp()
  const [fields, setFields] = useState<MeasureField[]>([])
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MeasureField | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [fs, gs] = await Promise.all([
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
        pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' }),
      ])
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

  const openEdit = (f: MeasureField | null) => {
    setEditing(f)
    form.resetFields()
    if (f) form.setFieldsValue(f)
    else
      form.setFieldsValue({
        type: 'number',
        unit: 'cm',
        decimals: 0,
        sort: (fields.length + 1) * 10,
        required: false,
        in_export: true,
        wrap_parens: false,
        is_active: true,
      })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    if (v.optionsRaw) {
      v.options = String(v.optionsRaw)
        .split(/[,，\n]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
      delete v.optionsRaw
    }
    try {
      if (editing) {
        // key 不允许修改
        delete v.key
        await pb.collection('measure_fields').update(editing.id, v)
      } else {
        await pb.collection('measure_fields').create(v)
      }
      message.success('已保存')
      setOpen(false)
      load()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  const toggleActive = async (f: MeasureField, active: boolean) => {
    try {
      await pb.collection('measure_fields').update(f.id, { is_active: active })
      load()
    } catch (e: any) {
      message.error(e?.message || '更新失败')
    }
  }

  const columns: TableProps<MeasureField>['columns'] = [
    { title: '顺序', dataIndex: 'sort', width: 70, align: 'center' },
    {
      title: '标识 (key)',
      dataIndex: 'key',
      width: 160,
      render: (v) => <span className="mono">{v}</span>,
    },
    { title: '名称', dataIndex: 'label', width: 120 },
    {
      title: '分组',
      dataIndex: 'group',
      width: 100,
      render: (v) => groups.find((g) => g.id === v)?.name || '-',
    },
    { title: '单位', dataIndex: 'unit', width: 70 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (v) =>
        ({ number: '数字', text: '文本', select: '选项' } as Record<string, string>)[v] || v,
    },
    {
      title: '导出',
      dataIndex: 'in_export',
      width: 70,
      align: 'center',
      render: (v) => (v ? <Tag color="blue">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: (
        <Tooltip title={WRAP_TIP} placement="bottom">
          <span style={{ cursor: 'help' }}>
            括号合并 <QuestionCircleOutlined style={{ color: '#999' }} />
          </span>
        </Tooltip>
      ),
      dataIndex: 'wrap_parens',
      width: 110,
      align: 'center',
      render: (v) => (v ? <Tag color="purple">是</Tag> : '-'),
    },
    {
      title: '启用',
      dataIndex: 'is_active',
      width: 80,
      align: 'center',
      render: (v: boolean, r) => (
        <Switch size="small" checked={v} onChange={(checked) => toggleActive(r, checked)} />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_v, r) => <a onClick={() => openEdit(r)}>编辑</a>,
    },
  ]

  return (
    <Card
      className="page-card"
      title="量体字段配置"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit(null)}>
          新增字段
        </Button>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="字段标识（key）创建后不可修改"
        description="历史量体数据靠 key 定位。改名请只改「名称」，删除请用「启用」开关停用，不要删除记录。"
      />
      <Table<MeasureField>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={fields}
        pagination={false}
        scroll={{ x: 1000 }}
      />

      <Modal
        title={editing ? '编辑字段' : '新增字段'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="字段标识 (key)"
            name="key"
            rules={[
              { required: true, message: '请输入 key' },
              { pattern: /^[a-z][a-z0-9_]*$/, message: '只能小写字母开头，含小写字母、数字、下划线' },
            ]}
            extra={editing ? '已有字段的 key 不可修改' : '创建后不可修改，例如 chest、arm_length'}
          >
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item label="显示名称" name="label" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：胸围" />
          </Form.Item>
          <Form.Item label="分组" name="group">
            <Select
              allowClear
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="选择分组"
            />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item label="类型" name="type" style={{ width: 140 }}>
              <Select
                options={[
                  { value: 'number', label: '数字' },
                  { value: 'text', label: '文本' },
                  { value: 'select', label: '选项' },
                ]}
              />
            </Form.Item>
            <Form.Item label="单位" name="unit" style={{ width: 120 }}>
              <Input placeholder="cm / kg" />
            </Form.Item>
            <Form.Item label="小数位" name="decimals" style={{ width: 100 }}>
              <InputNumber min={0} max={3} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item
            noStyle
            shouldUpdate={(p, c) => p.type !== c.type}
          >
            {({ getFieldValue }) =>
              getFieldValue('type') === 'select' ? (
                <Form.Item label="可选项（逗号分隔）" name="optionsRaw">
                  <Input placeholder="男,女" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item label="排序" name="sort">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Space size="large">
            <Form.Item label="进导出" name="in_export" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              label={
                <Tooltip title={WRAP_TIP} placement="top">
                  <span style={{ cursor: 'help' }}>
                    括号合并 <QuestionCircleOutlined style={{ color: '#999' }} />
                  </span>
                </Tooltip>
              }
              name="wrap_parens"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item label="必填" name="required" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  )
}
