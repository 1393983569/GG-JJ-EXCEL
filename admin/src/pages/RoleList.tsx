import { useEffect, useState } from 'react'
import { App, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tag, type TableProps } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { pb, type PriceVersion, type Role } from '../pb'
import { MENU_OPTIONS } from '../menus'

export default function RoleList() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Role[]>([])
  const [versions, setVersions] = useState<PriceVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [rs, vs] = await Promise.all([
        pb.collection('roles').getFullList<Role>({ sort: 'created' }),
        pb.collection('price_versions').getFullList<PriceVersion>({ sort: 'sort' }),
      ])
      setRows(rs)
      setVersions(vs)
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

  const openEdit = (r: Role | null) => {
    setEditing(r)
    form.resetFields()
    if (r) form.setFieldsValue(r)
    else form.setFieldsValue({ menus: [], can_view_all_prices: false, is_active: true })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    try {
      if (editing) await pb.collection('roles').update(editing.id, v)
      else await pb.collection('roles').create(v)
      message.success('已保存')
      setOpen(false)
      load()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  const columns: TableProps<Role>['columns'] = [
    { title: '角色名称', dataIndex: 'name', width: 140 },
    { title: '标识', dataIndex: 'code', width: 120, render: (v) => <span className="mono">{v}</span> },
    {
      title: '价格版本',
      dataIndex: 'price_version',
      width: 120,
      render: (v) => {
        const ver = versions.find((x) => x.id === v)
        return ver ? <Tag color="blue">{ver.name}</Tag> : '-'
      },
    },
    {
      title: '全部价格',
      dataIndex: 'can_view_all_prices',
      width: 100,
      align: 'center',
      render: (v) => (v ? <Tag color="gold">是</Tag> : '否'),
    },
    {
      title: '可见菜单',
      dataIndex: 'menus',
      render: (v: string[]) => (
        <Space size={[4, 4]} wrap>
          {(v || []).map((m) => (
            <Tag key={m}>{MENU_OPTIONS.find((x) => x.value === m)?.label || m}</Tag>
          ))}
        </Space>
      ),
    },
    { title: '操作', width: 80, render: (_v, r) => <a onClick={() => openEdit(r)}>编辑</a> },
  ]

  return (
    <Card
      className="page-card"
      title="角色权限"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit(null)}>
          新增角色
        </Button>
      }
    >
      <Table<Role>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
        角色只作为模板：后台账号创建时会把价格版本与菜单复制到账号上，修改角色不会自动同步到已有账号。
      </div>

      <Modal
        title={editing ? '编辑角色' : '新增角色'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="角色名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="角色标识" name="code" rules={[{ required: true, message: '请输入标识' }]}>
            <Input disabled={!!editing} placeholder="如 agent" />
          </Form.Item>
          <Form.Item label="绑定价格版本" name="price_version" rules={[{ required: true, message: '请选择' }]}>
            <Select options={versions.map((v) => ({ value: v.id, label: v.name }))} />
          </Form.Item>
          <Form.Item label="可查看全部价格版本" name="can_view_all_prices" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="可见菜单" name="menus">
            <Checkbox.Group options={MENU_OPTIONS} />
          </Form.Item>
          <Form.Item label="启用" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
