import { useEffect, useMemo, useState } from 'react'
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
import { PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { pb, yuan, toCents, type Item, type PriceVersion } from '../pb'
import { useAuth } from '../auth'

const CATEGORY: Record<string, { text: string; color: string }> = {
  base: { text: '基础价', color: 'red' },
  main: { text: '主项', color: 'blue' },
  extra: { text: '补充项', color: 'green' },
}

const UNIT_OPTIONS = ['对', '双', '个', '套', '件'].map((v) => ({ value: v }))

export default function ItemList() {
  const { message } = App.useApp()
  const { user } = useAuth()
  // 项目配置只给审核/管理员；代理只能维护自己版本的价格
  const canConfig = ['admin', 'reviewer'].includes((user as any)?.role_code || '')
  // 价格版本的可见范围：超级管理员看全部，其他人只看自己绑定的版本
  const canViewAllPrices = !!user?.can_view_all_prices
  const myPriceVersion = user?.price_version || ''
  const canEditVersion = (ver: PriceVersion) => canViewAllPrices || (!!myPriceVersion && myPriceVersion === ver.id)
  const isAdmin = (user as any)?.role_code === 'admin'
  // 代理价由内部定，代理只能看不能改
  const readonlyPrice = (user as any)?.role_code === 'agent'
  const [verOpen, setVerOpen] = useState(false)
  const [verName, setVerName] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [versions, setVersions] = useState<PriceVersion[]>([])
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  // undefined 表示该版本这条价格还没录入（区别于明确的 0 元）
  const [draft, setDraft] = useState<Record<string, number | undefined>>({})
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
      const [vs, ps, token] = await Promise.all([
        pb.collection('price_versions').getFullList<PriceVersion>({ sort: 'sort' }),
        pb.collection('item_prices').getFullList({}),
        pb.files.getToken().catch(() => ''),
      ])
      setFileToken(token)
      // 服务端还没跑 is_deleted 迁移时退化成全量，避免整页报错
      let its: Item[] = []
      try {
        its = await pb.collection('items').getFullList<Item>({ filter: 'is_deleted != true', sort: 'sort' })
      } catch (e) {
        its = await pb.collection('items').getFullList<Item>({ sort: 'sort' })
      }
      const map: Record<string, number> = {}
      ps.forEach((p: any) => {
        map[`${p.item}|${p.version}`] = p.price_cents || 0
      })
      setItems(its)
      setVersions(vs)
      setPriceMap(map)
      setDraft({ ...map })
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

  // 待保存的格子：只统计有权限的版本，空着（未定价）不提交
  const dirtyKeys = useMemo(() => {
    const keys: string[] = []
    for (const ver of versions) {
      if (!(canViewAllPrices || (myPriceVersion && myPriceVersion === ver.id))) continue
      for (const it of items) {
        const k = `${it.id}|${ver.id}`
        const cents = draft[k]
        if (cents === undefined) continue
        if (cents !== priceMap[k]) keys.push(k)
      }
    }
    return keys
  }, [draft, priceMap, versions, items, canViewAllPrices, myPriceVersion])

  const savePrices = async () => {
    try {
      for (const key of dirtyKeys) {
        const [item, version] = key.split('|')
        const cents = draft[key]
        if (cents === undefined) continue
        // 服务端是 upsert：没有记录就新建，所以代理版/工厂版第一次录入也走这里
        await pb.send('/api/gg/item-prices', {
          method: 'POST',
          body: { item, version, price_cents: cents },
        })
      }
      message.success(`已保存 ${dirtyKeys.length} 项价格`)
      load()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

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
    } as any
    if (payload.qty_mode === 'qty') payload.unit = v.unit || ''
    try {
      const rec: any = editing
        ? await pb.collection('items').update(editing.id, payload)
        : await pb.collection('items').create(payload)
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

  // 一个代理一个价格版本：新建后在表格里给这一列录价，再去「后台账号」绑给代理
  const addVersion = async () => {
    const name = verName.trim()
    if (!name) {
      message.warning('请填写名称')
      return
    }
    try {
      await pb.collection('price_versions').create({
        name,
        code: `pv_${Date.now()}`,
        sort: versions.reduce((m, v) => Math.max(m, v.sort || 0), 0) + 10,
        is_active: true,
      })
      setVerOpen(false)
      message.success('已创建')
      load()
    } catch (e: any) {
      message.error(e?.message || '创建失败')
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
      width: 80,
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
      width: 90,
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
      width: 70,
      align: 'center',
      render: (v: string, r: Item) => (r.qty_mode === 'qty' ? v || '-' : '-'),
    },
    ...versions.map((ver) => ({
      title: ver.name,
      width: 130,
      align: 'right' as const,
      render: (_v: any, r: Item) => {
        const key = `${r.id}|${ver.id}`
        // 只有「没权限」才显示不可见；有权限但没录入过，给个空格子直接填
        if (!canEditVersion(ver)) {
          return <span style={{ color: '#ccc' }}>不可见</span>
        }
        const cents = draft[key]
        if (readonlyPrice) {
          return cents !== undefined ? (
            <span>¥{yuan(cents)}</span>
          ) : (
            <span style={{ color: '#ccc' }}>未定价</span>
          )
        }
        return (
          <InputNumber
            size="small"
            min={0}
            precision={2}
            style={{ width: 110 }}
            placeholder="未定价"
            value={cents !== undefined ? cents / 100 : undefined}
            onChange={(nv) =>
              setDraft({ ...draft, [key]: nv === null || nv === undefined ? undefined : toCents(nv) })
            }
          />
        )
      },
    })),
    {
      title: '排序',
      dataIndex: 'sort',
      width: 70,
      align: 'center',
    },
    {
      title: '启用',
      dataIndex: 'is_active',
      width: 70,
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
        <Space>
          {!readonlyPrice && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={dirtyKeys.length === 0}
              onClick={savePrices}
            >
              保存价格修改 ({dirtyKeys.length})
            </Button>
          )}
          {canConfig && (
            <Button icon={<PlusOutlined />} onClick={() => openEdit(null)}>
              新增项目
            </Button>
          )}
          {isAdmin && (
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setVerName('')
                setVerOpen(true)
              }}
            >
              新增价格版本
            </Button>
          )}
        </Space>
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
        「不可见」表示你的账号没有该价格版本的权限，无法查看和修改；
        「未定价」的空格子表示该版本还没录过价，直接填写后保存即创建记录。
        勾选型客户只能选中/取消；数量型的类型与单位改动只对之后的新订单生效，历史订单按各自快照保留。
      </div>

      <Modal
        title="新增价格版本"
        open={verOpen}
        onCancel={() => setVerOpen(false)}
        onOk={addVersion}
        okText="创建"
      >
        <Input
          style={{ marginTop: 16 }}
          value={verName}
          onChange={(e) => setVerName(e.target.value)}
          onPressEnter={addVersion}
          placeholder="如：代理版-张三"
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
          创建后给这一列录价，再到「后台账号」把该代理的价格版本选成它。
        </div>
      </Modal>

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
            extra="JPG / PNG / WebP，5MB 以内，建议正方形。保存后客户在下单页点缩略图即可查看大图。"
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
