import { useEffect, useState } from 'react'
import {
  App,
  AutoComplete,
  Button,
  Card,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
  type TableProps,
} from 'antd'
import { PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { pb, type Item } from '../pb'
import { useAuth } from '../auth'

const CATEGORY: Record<string, { text: string; color: string }> = {
  base: { text: '基础价', color: 'red' },
  main: { text: '主项', color: 'blue' },
  extra: { text: '补充项', color: 'green' },
}

const UNIT_OPTIONS = ['对', '双', '个', '套', '件'].map((v) => ({ value: v }))

/** 定制项目字典：只维护项目本身（名称/分类/类型/单位/规格/效果图/排序/启用） */
export default function ItemList() {
  const { message } = App.useApp()
  const { user } = useAuth()
  const roleCode = (user as any)?.role_code || ''
  const canConfig = ['admin', 'reviewer'].includes(roleCode)

  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  // 私有文件访问令牌：items 集合不是公开的，缩略图/大图都要带 token
  const [fileToken, setFileToken] = useState('')
  // 编辑弹窗里新选的效果图（保存时才上传）
  const [imgFile, setImgFile] = useState<File | null>(null)
  const [imgPreview, setImgPreview] = useState('')
  const [imgRemoved, setImgRemoved] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const token = await pb.files.getToken().catch(() => '')
      setFileToken(token)
      // 服务端还没跑 is_deleted 迁移时退化成全量，避免整页报错
      let its: Item[] = []
      try {
        its = await pb.collection('items').getFullList<Item>({ filter: 'is_deleted != true', sort: 'sort' })
      } catch (e) {
        its = await pb.collection('items').getFullList<Item>({ sort: 'sort' })
      }
      setItems(its)
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

  const fileUrl = (it: Item, thumb?: string) => {
    if (!it.image) return ''
    return pb.files.getURL(it, it.image, {
      ...(thumb ? { thumb } : {}),
      ...(fileToken ? { token: fileToken } : {}),
    })
  }

  const openEdit = (it: Item | null) => {
    setEditing(it)
    setImgFile(null)
    setImgPreview('')
    setImgRemoved(false)
    form.resetFields()
    if (it) {
      form.setFieldsValue({ ...it, qty_mode: it.qty_mode || 'check', unit: it.unit || '' })
    } else {
      form.setFieldsValue({
        category: 'main',
        sort: (items.length + 1) * 10,
        is_active: true,
        qty_mode: 'check',
        unit: '',
      })
    }
    setModalOpen(true)
  }

  const submitItem = async () => {
    const v = await form.validateFields()
    // 基础价固定 1 份；勾选型不保留单位，避免切换类型后残留脏数据
    const payload = {
      ...v,
      qty_mode: v.category === 'base' ? 'check' : v.qty_mode || 'check',
      unit: '',
      // 规格存成字符串数组，空数组表示这个项目没有规格
      options: Array.isArray(v.options) ? v.options : [],
    } as any
    if (payload.qty_mode === 'qty') payload.unit = v.unit || ''
    try {
      const rec: any = editing
        ? await pb.collection('items').update(editing.id, payload)
        : await pb.collection('items').create({
            ...payload,
            // bool 字段没默认值，新建项目显式给一次，否则 H5 上会直接看不到
            h5_visible: true,
            h5_default: payload.category === 'base',
            in_price: true,
          })
      // 图片单独走一次 FormData：先保存字段，再换图/删图，避免和字段校验混在一起
      if (imgFile) {
        const fd = new FormData()
        fd.append('image', imgFile)
        await pb.collection('items').update(rec.id, fd)
      } else if (imgRemoved && editing?.image) {
        await pb.collection('items').update(rec.id, { image: null })
      }
      message.success('已保存')
      setModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  // 假删除：只改标记，不动记录本身，历史订单引用不受影响
  const removeItem = async (it: Item) => {
    try {
      await pb.collection('items').update(it.id, { is_deleted: true, is_active: false })
      message.success('已删除')
      load()
    } catch (e: any) {
      message.error(e?.message || '删除失败')
    }
  }

  const columns: TableProps<Item>['columns'] = [
    {
      title: '项目名称',
      dataIndex: 'name',
      width: 170,
      render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '效果图',
      dataIndex: 'image',
      width: 90,
      align: 'center',
      render: (v: string, r: Item) =>
        v ? (
          <Image
            src={fileUrl(r, '200x200')}
            width={44}
            height={44}
            style={{ objectFit: 'cover', borderRadius: 6 }}
            preview={{ src: fileUrl(r, '600x0') }}
          />
        ) : (
          <span style={{ color: '#ccc' }}>无</span>
        ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      render: (v: string) => <Tag color={CATEGORY[v]?.color}>{CATEGORY[v]?.text || v}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'qty_mode',
      width: 100,
      render: (v: string, r: Item) => {
        if (r.category === 'base') return <Tag>固定</Tag>
        return v === 'qty' ? <Tag color="purple">数量型</Tag> : <Tag>勾选型</Tag>
      },
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 80,
      align: 'center',
      render: (v: string, r: Item) => (r.qty_mode === 'qty' ? v || '-' : '-'),
    },
    {
      title: '规格',
      dataIndex: 'options',
      width: 180,
      render: (v: string[]) =>
        v && v.length ? (
          v.map((o) => <Tag key={o}>{o}</Tag>)
        ) : (
          <span style={{ color: '#ccc' }}>-</span>
        ),
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 80,
      align: 'center',
    },
    {
      title: '启用',
      dataIndex: 'is_active',
      width: 80,
      align: 'center',
      render: (v: boolean) => (v ? <Tag color="success">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '操作',
      width: 110,
      render: (_v, r) =>
        canConfig ? (
          <Space size={12}>
            <a onClick={() => openEdit(r)}>编辑</a>
            <Popconfirm
              title="删除这个项目？"
              description="只做停用处理：历史订单里的项目会保留。"
              okText="删除"
              cancelText="取消"
              onConfirm={() => removeItem(r)}
            >
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>
          </Space>
        ) : (
          <span style={{ color: '#ccc' }}>-</span>
        ),
    },
  ]

  return (
    <Card
      className="page-card"
      title="定制项目"
      extra={
        canConfig ? (
          <Button icon={<PlusOutlined />} onClick={() => openEdit(null)}>
            新增项目
          </Button>
        ) : null
      }
    >
      <Table<Item>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
        这里只是项目字典：名称、分类、类型、单位、规格、效果图、排序、启用。
        H5 上是否显示 / 默认选中 / 是否计价、别名和价格都在「总部店铺」里配，代理在「我的店铺」里配自己那份，
        没配的项目跟随总部。
      </div>

      <Modal
        title={editing ? '编辑项目' : '新增项目'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submitItem}
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="项目名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="分类" name="category" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'base', label: '基础价' },
                { value: 'main', label: '主要定制项' },
                { value: 'extra', label: '补充项' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="效果图"
            extra="JPG / PNG / WebP，5MB 以内，建议正方形。这是默认图，代理可以在自己的店铺里换。"
          >
            <Space align="start" size={16}>
              {imgPreview || (editing?.image && !imgRemoved) ? (
                <div style={{ textAlign: 'center' }}>
                  <Image
                    src={imgPreview || fileUrl(editing!, '200x200')}
                    width={96}
                    height={96}
                    style={{ objectFit: 'cover', borderRadius: 8 }}
                  />
                  <div style={{ marginTop: 4 }}>
                    <a
                      onClick={() => {
                        setImgFile(null)
                        setImgPreview('')
                        setImgRemoved(true)
                      }}
                    >
                      移除
                    </a>
                  </div>
                </div>
              ) : null}
              <Upload
                accept="image/jpeg,image/png,image/webp"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(f) => {
                  if (f.size > 5 * 1024 * 1024) {
                    message.error('图片不能超过 5MB')
                    return false
                  }
                  setImgFile(f as File)
                  setImgPreview(URL.createObjectURL(f as File))
                  setImgRemoved(false)
                  return false
                }}
              >
                <Button icon={<UploadOutlined />}>
                  {imgPreview || (editing?.image && !imgRemoved) ? '更换图片' : '上传图片'}
                </Button>
              </Upload>
            </Space>
          </Form.Item>
          {/* 基础价固定 1 份，不需要选类型 */}
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue('category') === 'base' ? null : (
                <>
                  <Form.Item label="类型" name="qty_mode" rules={[{ required: true, message: '请选择类型' }]}>
                    <Radio.Group>
                      <Radio value="check">勾选型（选中即 1 份，无数量）</Radio>
                      <Radio value="qty">数量型（可选数量）</Radio>
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, cur) => prev.qty_mode !== cur.qty_mode}>
                    {({ getFieldValue: get }) => {
                      if (get('qty_mode') !== 'qty') return null
                      return (
                        <Form.Item
                          label="单位"
                          name="unit"
                          rules={[{ required: true, message: '请填写单位' }]}
                          extra="数量型必须配单位，导出与展示时会拼成「手套 2对」"
                        >
                          <AutoComplete options={UNIT_OPTIONS} placeholder="对 / 双 / 个" />
                        </Form.Item>
                      )
                    }}
                  </Form.Item>
                </>
              )
            }
          </Form.Item>
          <Form.Item
            label="规格选项"
            name="options"
            extra="客户下单时必须选一个，如 分体 / 连体。留空表示没有规格；价格仍按项目整体算，规格之间不单独定价。"
          >
            <Select mode="tags" tokenSeparators={[',', '，']} placeholder="输入后回车添加" options={[]} />
          </Form.Item>
          <Form.Item label="排序" name="sort">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="启用" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
