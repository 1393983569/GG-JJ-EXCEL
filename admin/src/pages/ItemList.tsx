import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
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
import { pb, type Catalog, type Item, type ItemField, type MeasureField } from '../pb'
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
  // 可绑定的定制参数（量体字段字典）：项目只存 key，标签/单位在这里取
  const [mfields, setMfields] = useState<MeasureField[]>([])
  // 品类字典：项目只能挂已有的品类，避免手打出现「衣服 / 衣啊」两个品类
  const [cats, setCats] = useState<Catalog[]>([])
  const [catOpen, setCatOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  // 品类要量的尺寸：品类就是一套打版方案，尺寸归它定
  const [fieldCat, setFieldCat] = useState<Catalog | null>(null)
  const [fieldDraft, setFieldDraft] = useState<ItemField[]>([])
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
      const fs = await pb
        .collection('measure_fields')
        .getFullList<MeasureField>({ filter: 'is_active = true', sort: 'sort' })
        .catch(() => [] as MeasureField[])
      setMfields(fs)
      await loadCatalogs()
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

  const fieldOptions = mfields.map((f) => ({
    value: f.key,
    label: f.label + (f.unit ? `(${f.unit})` : ''),
  }))

  // ---------------------------------------------- 品类字典

  const loadCatalogs = async (silent?: boolean) => {
    try {
      const list = await pb.collection('catalogs').getFullList<Catalog>({ sort: 'sort' })
      setCats(list)
      return list
    } catch (e: any) {
      // 这里不能静默：列表拉不到时如果还让人手动新增，就会拿服务端已有的名字去 create
      setCats([])
      if (!silent) message.error('读取品类失败：' + (e?.message || '未知错误'))
      return [] as Catalog[]
    }
  }

  const catSafe = (name: string) => String(name || '').replace(/"/g, '')

  const addCatalog = async () => {
    const name = newCat.trim()
    if (!name) return
    if (cats.some((c) => c.name === name)) {
      setNewCat('')
      return message.warning(`「${name}」已经在列表里了`)
    }
    try {
      const sort = cats.reduce((max, c) => Math.max(max, Number(c.sort) || 0), 0) + 10
      await pb.collection('catalogs').create({ name, sort, is_active: true })
      setNewCat('')
      message.success('已新增品类')
      loadCatalogs()
    } catch (e: any) {
      // 服务端说重名基本就是本地列表过期了：刷新一次，别让人对着空列表反复点
      await loadCatalogs()
      message.error(e?.message || '新增失败')
    }
  }

  // 改名要连带刷项目，否则项目会挂在一个字典里不存在的品类上
  const renameCatalog = async (rec: Catalog, value: string) => {
    const next = value.trim()
    if (!next || next === rec.name) return
    if (cats.some((c) => c.id !== rec.id && c.name === next)) return message.warning('品类已存在')
    try {
      const used = await pb
        .collection('items')
        .getFullList<Item>({ filter: `catalog = "${catSafe(rec.name)}"` })
      await pb.collection('catalogs').update(rec.id, { name: next })
      for (const it of used) {
        await pb.collection('items').update(it.id, { catalog: next })
      }
      message.success(used.length ? `已改名，同步更新 ${used.length} 个项目` : '已改名')
      load()
    } catch (e: any) {
      message.error(e?.message || '改名失败')
    }
  }

  const updateCatalog = async (rec: Catalog, patch: Partial<Catalog>) => {
    try {
      await pb.collection('catalogs').update(rec.id, patch as any)
      loadCatalogs()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
      loadCatalogs()
    }
  }

  const openCatalogFields = (c: Catalog) => {
    setFieldCat(c)
    setFieldDraft((c.fields || []).map((f) => ({ ...f, in_export: f.in_export !== false })))
  }

  const patchDraft = (index: number, patch: Partial<ItemField>) => {
    setFieldDraft((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  const saveCatalogFields = async () => {
    if (!fieldCat) return
    try {
      const fields = fieldDraft
        .filter((f) => f.key)
        .map((f) => ({
          key: f.key,
          required: !!f.required,
          sort: Number(f.sort) || 0,
          in_export: f.in_export !== false,
        }))
      const res = await pb.collection('catalogs').update(fieldCat.id, { fields } as any)
      // 服务端 catalogs 还没跑 0032 迁移时没有 fields 列，PocketBase 会静默丢掉这个键，
      // 接口照样返回 200：必须回头看有没有存进去，不然就是「保存成功但一直是未配置」。
      const got = (res as any)?.fields
      if (!Array.isArray(got) || got.length !== fields.length) {
        message.error('没存上：服务端 catalogs 缺少 fields 字段，重启 PocketBase 让迁移跑完再保存')
        loadCatalogs()
        return
      }
      message.success(`「${fieldCat.name}」的尺寸已保存`)
      setFieldCat(null)
      loadCatalogs()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  const removeCatalog = async (rec: Catalog) => {
    try {
      const used = await pb
        .collection('items')
        .getFullList<Item>({ filter: `catalog = "${catSafe(rec.name)}"` })
      if (used.length) {
        return message.warning(`还有 ${used.length} 个项目在用，请先改品类，或直接停用`)
      }
      await pb.collection('catalogs').delete(rec.id)
      message.success('已删除')
      loadCatalogs()
    } catch (e: any) {
      message.error(e?.message || '删除失败')
    }
  }

  const fileUrl = (it: Item, thumb?: string) => {
    if (!it.image) return ''
    return pb.files.getURL(it, it.image, {
      ...(thumb ? { thumb } : {}),
      ...(fileToken ? { token: fileToken } : {}),
    })
  }

  const openEdit = (it: Item | null, catalog?: string) => {
    setEditing(it)
    setImgFile(null)
    setImgPreview('')
    setImgRemoved(false)
    form.resetFields()
    if (it) {
      form.setFieldsValue({
        ...it,
        qty_mode: it.qty_mode || 'check',
        unit: it.unit || '',
        in_export: it.in_export !== false,
        catalog: it.catalog || '衣服',
      })
    } else {
      form.setFieldsValue({
        category: 'main',
        sort: (items.length + 1) * 10,
        is_active: true,
        qty_mode: 'check',
        unit: '',
        in_export: true,
        catalog:
          catalog ||
          (cats.find((c) => c.is_active !== false) || cats[0] || { name: '衣服' }).name,
      })
    }
    setModalOpen(true)
  }

  // 按品类分组：一个品类一个框，顺序跟着品类字典
  const grouped = useMemo(() => {
    const map: Record<string, Item[]> = {}
    items.forEach((it) => {
      const c = it.catalog || '衣服'
      if (!map[c]) map[c] = []
      map[c].push(it)
    })
    const order = cats.map((c) => c.name)
    const rank = (name: string) => {
      const i = order.indexOf(name)
      return i >= 0 ? i : 999
    }
    return Object.keys(map)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((c) => ({ catalog: c, list: map[c] }))
  }, [items, cats])

  const submitItem = async () => {
    const v = await form.validateFields()
    // 同名不同品类没问题（价格/代理/订单都按 id 关联），但同一个品类下重名会让
    // 客户和工厂分不清，而且两个基础价会各算一份，所以新建时挡一下
    if (!editing) {
      const cat = String(v.catalog || '').trim() || '衣服'
      const dup = items.find(
        (it) => (it.catalog || '衣服') === cat && it.name === String(v.name || '').trim()
      )
      if (dup) {
        message.warning(`「${cat}」下已经有同名项目「${dup.name}」，换个名字再存`)
        return
      }
    }
    // 基础价固定 1 份；勾选型不保留单位，避免切换类型后残留脏数据
    const payload = {
      ...v,
      catalog: String(v.catalog || '').trim() || '衣服',
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
      title: '导出',
      dataIndex: 'in_export',
      width: 80,
      align: 'center',
      render: (v: boolean | undefined) =>
        v === false ? <Tag>否</Tag> : <Tag color="success">是</Tag>,
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
          <Space>
            <Button onClick={() => setCatOpen(true)}>品类管理</Button>
            <Button icon={<PlusOutlined />} onClick={() => openEdit(null)}>
              新增项目
            </Button>
          </Space>
        ) : null
      }
    >
      {grouped.length === 0 && !loading && (
        <div style={{ padding: 32, textAlign: 'center', color: '#999' }}>还没有项目</div>
      )}

      {grouped.map((g) => (
        <div key={g.catalog} style={{ marginBottom: 24 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              margin: '4px 0 10px',
              padding: '8px 14px',
              background: '#f5f8ff',
              border: '1px solid #e3ecff',
              borderRadius: 8,
            }}
          >
            <Space size={12}>
              <Tag color="geekblue" style={{ margin: 0 }}>
                {g.catalog}
              </Tag>
              <span style={{ fontSize: 12, color: '#999' }}>{g.list.length} 个项目</span>
            </Space>
            {canConfig && <a onClick={() => openEdit(null, g.catalog)}>+ 新增到本品类</a>}
          </div>
          <Table<Item>
            rowKey="id"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={g.list}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </div>
      ))}

      <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
        这里只是项目字典：名称、品类、分类、类型、单位、规格、效果图、排序、启用、是否导出。
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
            label="品类"
            name="catalog"
            extra="一单一品类：客户勾了多个品类的项目会拆成多张订单。要新增品类去右上角「品类管理」。"
          >
            <Select
              placeholder="衣服"
              options={(() => {
                const list = cats
                  .filter((c) => c.is_active !== false)
                  .map((c) => ({ value: c.name, label: c.name }))
                const cur = editing?.catalog
                // 项目挂着一个已停用的品类时也要能选中它，不然一保存就悄悄改了品类
                if (cur && !list.some((o) => o.value === cur)) list.push({ value: cur, label: cur + '（已停用）' })
                return list
              })()}
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
          <Form.Item
            label="导出到 Word"
            name="in_export"
            valuePropName="checked"
            extra="关闭后这个项目不进 Word 的项目行；项目按品类区分，别的品类不受影响。"
          >
            <Switch />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="品类管理"
        open={catOpen}
        onCancel={() => setCatOpen(false)}
        footer={null}
        width={680}
      >
        {cats.length === 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="没有读到任何品类"
            description="如果是刚重启过后端，先点「重新加载」；一直为空说明 catalogs 集合没建好，去看后端日志。"
            action={
              <Button size="small" onClick={() => loadCatalogs()}>
                重新加载
              </Button>
            }
          />
        )}
        <Table<Catalog>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={cats}
          columns={[
            {
              title: '品类名称',
              render: (_v, r) => (
                <Input
                  defaultValue={r.name}
                  onBlur={(e) => renameCatalog(r, e.target.value)}
                  onPressEnter={(e: any) => e.currentTarget.blur()}
                />
              ),
            },
            {
              title: '排序',
              width: 100,
              render: (_v, r) => (
                <InputNumber
                  size="small"
                  min={0}
                  defaultValue={r.sort}
                  style={{ width: 80 }}
                  onBlur={(e: any) => updateCatalog(r, { sort: Number(e.target.value) || 0 })}
                />
              ),
            },
            {
              title: '启用',
              width: 80,
              render: (_v, r) => (
                <Switch
                  checked={r.is_active !== false}
                  onChange={(v) => updateCatalog(r, { is_active: v })}
                />
              ),
            },
            {
              title: '要量的尺寸',
              width: 200,
              render: (_v, r) => {
                const list = r.fields || []
                return (
                  <Space size={8}>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      {list.length ? `${list.length} 项` : '未配置'}
                    </span>
                    <a onClick={() => openCatalogFields(r)}>{list.length ? '编辑' : '去配置'}</a>
                  </Space>
                )
              },
            },
            {
              title: '操作',
              width: 70,
              render: (_v, r) => (
                <Popconfirm
                  title="删除品类？"
                  description="还有项目在用时删不掉，可以改成停用。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => removeCatalog(r)}
                >
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              ),
            },
          ]}
        />
        <Space style={{ marginTop: 16 }}>
          <Input
            placeholder="新品类名，如 床垫"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onPressEnter={addCatalog}
            style={{ width: 240 }}
          />
          <Button type="primary" onClick={addCatalog}>
            新增品类
          </Button>
        </Space>
        <div style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
          排序决定 H5 首页和下单页的品类顺序；停用后这个品类连同它的项目一起从 H5
          隐藏，历史订单和统计不受影响。改名会自动同步到项目上。
        </div>

        <Modal
          title={`要量的尺寸 · ${fieldCat?.name || ''}`}
          open={!!fieldCat}
          onCancel={() => setFieldCat(null)}
          onOk={saveCatalogFields}
          okText="保存"
          width={640}
        >
          <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
            这个品类（一套打版方案）固定要量的尺寸，品类下所有项目共用。
            必填＝客户不填不能下单；排序＝尺寸文本里的先后；导出＝这个尺寸是否进 Word。
            不同品类可以各自决定导出哪些尺寸，留空表示这个品类不用量尺寸。
          </div>
          {fieldDraft.map((f, i) => (
            <Space key={i} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
              <Select
                style={{ width: 200 }}
                showSearch
                optionFilterProp="label"
                placeholder="选择参数"
                value={f.key || undefined}
                options={fieldOptions}
                onChange={(v) => patchDraft(i, { key: v })}
              />
              <Switch
                checkedChildren="必填"
                unCheckedChildren="选填"
                checked={!!f.required}
                onChange={(v) => patchDraft(i, { required: v })}
              />
              <Switch
                checkedChildren="导出"
                unCheckedChildren="不导出"
                checked={f.in_export !== false}
                onChange={(v) => patchDraft(i, { in_export: v })}
              />
              <InputNumber
                min={0}
                style={{ width: 90 }}
                value={f.sort}
                onChange={(v) => patchDraft(i, { sort: Number(v) || 0 })}
              />
              <a
                style={{ color: '#ff4d4f' }}
                onClick={() => setFieldDraft((prev) => prev.filter((_x, idx) => idx !== i))}
              >
                删除
              </a>
            </Space>
          ))}
          <Space>
            <Button
              size="small"
              onClick={() =>
                setFieldDraft((prev) => [
                  ...prev,
                  { key: '', required: false, in_export: true, sort: (prev.length + 1) * 10 },
                ])
              }
            >
              添加参数
            </Button>
            <Button
              size="small"
              onClick={() =>
                setFieldDraft(
                  mfields.map((m, i) => ({ key: m.key, required: false, in_export: true, sort: i * 10 }))
                )
              }
            >
              套用全部参数
            </Button>
          </Space>
        </Modal>
      </Modal>
    </Card>
  )
}
