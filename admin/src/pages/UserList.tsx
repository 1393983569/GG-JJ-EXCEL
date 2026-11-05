import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  type TableProps,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { pb, type PriceVersion, type Role, type Staff } from '../pb'
import { MENU_OPTIONS } from '../menus'

export default function UserList() {
  const { message } = App.useApp()
  const [rows, setRows] = useState<Staff[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [versions, setVersions] = useState<PriceVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [us, rs, vs] = await Promise.all([
        pb.collection('staff').getFullList<Staff>({ sort: '-created' }),
        pb.collection('roles').getFullList<Role>({}),
        pb.collection('price_versions').getFullList<PriceVersion>({ sort: 'sort' }),
      ])
      setRows(us)
      setRoles(rs)
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

  const openEdit = (u: Staff | null) => {
    setEditing(u)
    form.resetFields()
    if (u) form.setFieldsValue({ ...u, password: '' })
    else form.setFieldsValue({ is_active: true, menus: [] })
    setOpen(true)
  }

  // 选角色时把模板配置复制到账号
  const applyRole = (roleId: string) => {
    const r = roles.find((x) => x.id === roleId)
    if (!r) return
    form.setFieldsValue({
      price_version: r.price_version,
      menus: r.menus || [],
      can_view_all_prices: !!r.can_view_all_prices,
    })
  }

  const submit = async () => {
    const v = await form.validateFields()
    try {
      // PB 的 auth 集合要求 passwordConfirm，表单只有一个密码框
      if (v.password) v.passwordConfirm = v.password
      if (editing) {
        if (!v.password) {
          delete v.password
          delete v.passwordConfirm
        }
        delete v.username
        await pb.collection('staff').update(editing.id, v)
      } else {
        await pb.collection('staff').create(v)
      }
      message.success('已保存')
      setOpen(false)
      load()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  const columns: TableProps<Staff>['columns'] = [
    { title: '账号', dataIndex: 'username', width: 140, render: (v) => <span className="mono">{v}</span> },
    { title: '姓名', dataIndex: 'display_name', width: 100 },
    { title: '电话', dataIndex: 'phone', width: 130 },
    {
      title: '角色',
      dataIndex: 'role',
      width: 110,
      render: (v) => roles.find((r) => r.id === v)?.name || '-',
    },
    {
      title: '价格版本',
      dataIndex: 'price_version',
      width: 110,
      render: (v, r) =>
        r.can_view_all_prices ? (
          <Tag color="gold">全部</Tag>
        ) : (
          <Tag color="blue">{versions.find((x) => x.id === v)?.name || '-'}</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v) => (v ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: '操作', width: 80, render: (_v, r) => <a onClick={() => openEdit(r)}>编辑</a> },
  ]

  return (
    <Card
      className="page-card"
      title="后台账号"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit(null)}>
          新增账号
        </Button>
      }
    >
      <Table<Staff>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />

      <Modal
        title={editing ? '编辑账号' : '新增账号'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="登录账号（手机号）"
            name="username"
            rules={[{ required: true, message: '请输入账号' }, { min: 3, max: 32 }]}
          >
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item
            label={editing ? '密码（留空则不修改）' : '密码'}
            name="password"
            rules={editing ? [] : [{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="姓名" name="display_name">
            <Input />
          </Form.Item>
          <Form.Item label="联系电话" name="phone">
            <Input />
          </Form.Item>
          <Form.Item label="角色" name="role">
            <Select
              allowClear
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
              onChange={(v) => applyRole(v)}
              placeholder="选择角色会自动带出价格版本与菜单"
            />
          </Form.Item>
          <Form.Item label="价格版本" name="price_version">
            <Select allowClear options={versions.map((v) => ({ value: v.id, label: v.name }))} />
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
