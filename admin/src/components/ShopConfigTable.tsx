import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Image,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  type TableProps,
  Tooltip,
  Upload,
} from 'antd'
import { QuestionCircleOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { pb, toCents, yuan, type Item, type PriceVersion } from '../pb'

type Props = {
  /** 不传 = 总部（虚拟代理，配置写 items / 全局客户价）；传 = 某个账号 */
  staffId?: string
  /** 账号角色：决定成本价用哪个价格版本 */
  roleCode?: string
  /** 显示成本价列 */
  showCost?: boolean
  /** 成本价可改（管理员给账号配价时用） */
  costEditable?: boolean
  /** 卡片标题；抽屉里用可传空 */
  title?: string
}

type Row = {
  item: Item
  /** staff_item_settings 的记录（总部为空） */
  setting: any
  itemId: string
  name: string
  alias: string
  visible: boolean
  isDefault: boolean
  inPrice: boolean
  sort: number
  /** 当前生效的图（URL） */
  imgUrl: string
  /** 自定义图文件名，空表示用总部图 */
  imgFile: string
}

const priceKey = (kind: 'sale' | 'cost', itemId: string) => kind + '|' + itemId

export default function ShopConfigTable({ staffId, roleCode, showCost, costEditable, title }: Props) {
  const { message } = App.useApp()
  const isAgentAccount = roleCode === 'agent'
  const [rows, setRows] = useState<Row[]>([])
  const [versions, setVersions] = useState<PriceVersion[]>([])
  // 价格是草稿：改完点「保存价格修改」一次性提交；开关/别名/排序/图是即时保存
  const [draft, setDraft] = useState<Record<string, number | undefined>>({})
  const [saved, setSaved] = useState<Record<string, number | undefined>>({})
  const [loading, setLoading] = useState(false)
  const [fileToken, setFileToken] = useState('')
  // 按品类批量分配：1 号代理只卖衣服、2 号只卖床垫时不用逐个点
  const [bulkCatalog, setBulkCatalog] = useState('')

  const catalogs = useMemo(() => {
    const list: string[] = []
    rows.forEach((r) => {
      const c = r.item.catalog || '衣服'
      if (list.indexOf(c) < 0) list.push(c)
    })
    return list
  }, [rows])

  const customerVer = versions.find((v) => v.code === 'customer')
  const costVer = versions.find((v) => v.code === (isAgentAccount ? 'agent' : 'factory'))
  // 工厂不服务 H5，效果图/排序/可见/别名这些列对工厂没意义
  const showH5 = roleCode !== 'factory'

  const fileUrl = (rec: any, name: string, thumb?: string) =>
    name
      ? pb.files.getURL(rec, name, {
          ...(thumb ? { thumb } : {}),
          ...(fileToken ? { token: fileToken } : {}),
        })
      : ''

  const load = async () => {
    setLoading(true)
    try {
      const [its, vs, token] = await Promise.all([
        pb
          .collection('items')
          .getFullList<Item>({ filter: 'is_deleted != true', sort: 'sort' })
          .catch(() => pb.collection('items').getFullList<Item>({ sort: 'sort' })),
        pb.collection('price_versions').getFullList<PriceVersion>({ sort: 'sort' }),
        pb.files.getToken().catch(() => ''),
      ])
      setFileToken(token)

      const settings = staffId
        ? await pb
            .collection('staff_item_settings')
            .getFullList({ filter: `staff = "${staffId}"` })
            .catch(() => [] as any[])
        : []
      const settingMap: Record<string, any> = {}
      settings.forEach((s: any) => {
        settingMap[s.item] = s
      })

      const prices = staffId
        ? await pb
            .collection('staff_item_prices')
            .getFullList({ filter: `staff = "${staffId}"` })
            .catch(() => [] as any[])
        : await pb.collection('item_prices').getFullList({}).catch(() => [] as any[])

      const map: Record<string, number | undefined> = {}
      const customerId = vs.find((v) => v.code === 'customer')?.id
      prices.forEach((p: any) => {
        const kind = p.version === customerId ? 'sale' : 'cost'
        map[priceKey(kind, p.item)] = p.price_cents ?? undefined
      })

      setVersions(vs)
      setRows(
        its.map((it) => {
          const s: any = settingMap[it.id]
          return {
            item: it,
            setting: s || null,
            itemId: it.id,
            name: (s && s.alias) || it.alias || it.name || '',
            alias: (s && s.alias) || it.alias || '',
            visible: s ? !!s.h5_visible : it.h5_visible !== false,
            isDefault: s ? !!s.h5_default : !!it.h5_default,
            inPrice: s ? !!s.in_price : it.in_price !== false,
            sort: (s && s.sort) || it.sort || 0,
            imgFile: (s && s.image) || '',
            imgUrl:
              (s && s.image && fileUrl(s, s.image, '200x200')) || fileUrl(it, it.image || '', '200x200'),
          }
        })
      )
      setDraft({ ...map })
      setSaved({ ...map })
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId])

  const dirtyKeys = useMemo(
    () => Object.keys(draft).filter((k) => draft[k] !== undefined && draft[k] !== saved[k]),
    [draft, saved]
  )

  const patchRow = (itemId: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)))

  // 代理/账号维度：没有行就先建一行（三项开关按当前显示值固化，之后不再跟随总部）
  const ensureSetting = async (row: Row) => {
    if (!staffId) return ''
    if (row.setting?.id) return row.setting.id as string
    const rec: any = await pb.collection('staff_item_settings').create({
      staff: staffId,
      item: row.itemId,
      alias: row.alias,
      h5_visible: row.visible,
      h5_default: row.isDefault,
      in_price: row.inPrice,
      sort: row.sort,
    })
    patchRow(row.itemId, { setting: rec })
    return rec.id
  }

  // 总部：直接改 items；账号：改自己的配置行
  const saveField = async (row: Row, field: string, value: any) => {
    try {
      if (!staffId) {
        await pb.collection('items').update(row.itemId, { [field]: value })
      } else {
        const id = await ensureSetting(row)
        await pb.collection('staff_item_settings').update(id, { [field]: value })
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败')
      load()
    }
  }

  const saveFlag = (row: Row, key: 'visible' | 'isDefault' | 'inPrice', value: boolean) => {
    const field = key === 'visible' ? 'h5_visible' : key === 'isDefault' ? 'h5_default' : 'in_price'
    patchRow(row.itemId, { [key]: value } as Partial<Row>)
    saveField(row, field, value)
  }

  const saveAlias = (row: Row, value: string) => {
    const alias = value.trim()
    patchRow(row.itemId, { alias, name: alias || row.item.alias || row.item.name || '' })
    saveField(row, 'alias', alias)
  }

  const saveSort = (row: Row, value: number | null) => {
    const sort = Number(value) || 0
    // 账号维度：0 表示跟随总部排序
    patchRow(row.itemId, { sort: sort || row.item.sort || 0 })
    saveField(row, 'sort', sort)
  }

  const saveImage = async (row: Row, file: File | null) => {
    try {
      if (!staffId) {
        const fd = new FormData()
        if (file) fd.append('image', file)
        else fd.append('image', '')
        await pb.collection('items').update(row.itemId, fd)
      } else {
        const id = await ensureSetting(row)
        if (file) {
          const fd = new FormData()
          fd.append('image', file)
          await pb.collection('staff_item_settings').update(id, fd)
        } else {
          await pb.collection('staff_item_settings').update(id, { image: null })
        }
      }
      message.success(file ? '已替换效果图' : '已恢复总部效果图')
      load()
    } catch (e: any) {
      message.error(e?.message || '图片保存失败')
    }
  }

  // 整个品类一次性可见 / 不可见：H5 首页的品类入口就是按这个算出来的
  const setCatalogVisible = async (catalog: string, visible: boolean) => {
    const targets = rows.filter((r) => (r.item.catalog || '衣服') === catalog)
    if (!targets.length) return
    try {
      for (const r of targets) {
        patchRow(r.itemId, { visible })
        if (!staffId) {
          await pb.collection('items').update(r.itemId, { h5_visible: visible })
        } else {
          const id = await ensureSetting({ ...r, visible })
          await pb.collection('staff_item_settings').update(id, { h5_visible: visible })
        }
      }
      message.success(`${catalog}：${targets.length} 项已设为${visible ? '可见' : '不可见'}`)
    } catch (e: any) {
      message.error(e?.message || '批量设置失败')
      load()
    }
  }

  // 价格：草稿批量保存
  const savePrices = async () => {
    if (!customerVer) return
    try {
      for (const key of dirtyKeys) {
        const [kind, item] = key.split('|')
        const version = kind === 'sale' ? customerVer.id : costVer?.id
        if (!version) continue
        const body: any = { item, version, price_cents: draft[key] ?? 0 }
        if (staffId) body.staff = staffId
        await pb.send('/api/gg/item-prices', { method: 'POST', body })
      }
      message.success(`已保存 ${dirtyKeys.length} 项价格`)
      setSaved({ ...draft })
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  const priceCell = (row: Row, kind: 'sale' | 'cost', editable: boolean) => {
    const key = priceKey(kind, row.itemId)
    const cents = draft[key]
    if (!editable) {
      return cents !== undefined ? <span>¥{yuan(cents)}</span> : <span style={{ color: '#ccc' }}>未定价</span>
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
          setDraft((prev) => ({
            ...prev,
            [key]: nv === null || nv === undefined ? undefined : toCents(nv),
          }))
        }
      />
    )
  }

  const body = (
    <Table<Row>
      rowKey="itemId"
      size="middle"
      loading={loading}
      pagination={false}
      dataSource={[...rows].sort((a, b) => (a.item.sort || 0) - (b.item.sort || 0))}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: '项目',
          dataIndex: 'name',
          width: 150,
          render: (v: string, r) => (
            <div>
              <div style={{ fontWeight: 500 }}>{v}</div>
              <div style={{ fontSize: 11, color: '#bbb' }}>{r.item.name}</div>
            </div>
          ),
        },
        {
          title: '品类',
          width: 80,
          render: (_v, r) => <Tag color="geekblue">{r.item.catalog || '衣服'}</Tag>,
        },
        ...(showH5 ? ([
        {
          title: '效果图',
          width: 90,
          align: 'center',
          render: (_v, r) => (
            <Space size={4} direction="vertical">
              {r.imgUrl ? (
                <Image
                  src={r.imgUrl}
                  width={44}
                  height={44}
                  style={{ objectFit: 'cover', borderRadius: 6 }}
                  preview={{ src: r.imgUrl }}
                />
              ) : (
                <span style={{ color: '#ccc' }}>无</span>
              )}
              <Upload
                accept="image/jpeg,image/png,image/webp"
                showUploadList={false}
                maxCount={1}
                beforeUpload={(f) => {
                  if (f.size > 5 * 1024 * 1024) {
                    message.error('图片不能超过 5MB')
                    return false
                  }
                  saveImage(r, f as File)
                  return false
                }}
              >
                <Button size="small" type="text" icon={<UploadOutlined />} />
              </Upload>
              {staffId && r.imgFile ? (
                <a style={{ fontSize: 11 }} onClick={() => saveImage(r, null)}>
                  恢复总部图
                </a>
              ) : null}
            </Space>
          ),
        },
        {
          title: (
            <Space size={4}>
              排序
              <Tooltip title="客户下单页的显示顺序；代理填 0 表示跟随总部">
                <QuestionCircleOutlined style={{ color: '#bbb' }} />
              </Tooltip>
            </Space>
          ),
          width: 90,
          align: 'center',
          render: (_v, r) => (
            <InputNumber
              size="small"
              min={0}
              style={{ width: 70 }}
              value={r.sort}
              onChange={(v) => patchRow(r.itemId, { sort: Number(v) || 0 })}
              onBlur={() => saveSort(r, r.sort)}
            />
          ),
        },
        {
          title: (
            <Space size={4}>
              H5 设置
              <Tooltip title="可见＝客户下单页是否显示；默认选中＝客户进页面就勾上（可取消）；计价＝取消后客户合计里不算这一项，成本价不受影响">
                <QuestionCircleOutlined style={{ color: '#bbb' }} />
              </Tooltip>
            </Space>
          ),
          width: 200,
          render: (_v, r) => (
            <Space direction="vertical" size={4}>
              <Tag.CheckableTag checked={r.visible} onChange={(v) => saveFlag(r, 'visible', v)}>
                是否可见：{r.visible ? '是' : '否'}
              </Tag.CheckableTag>
              {r.item.category !== 'base' && (
                <Tag.CheckableTag checked={r.isDefault} onChange={(v) => saveFlag(r, 'isDefault', v)}>
                  是否默认选中：{r.isDefault ? '是' : '否'}
                </Tag.CheckableTag>
              )}
              <Tag.CheckableTag checked={r.inPrice} onChange={(v) => saveFlag(r, 'inPrice', v)}>
                是否计价：{r.inPrice ? '是' : '否'}
              </Tag.CheckableTag>
            </Space>
          ),
        },
        {
          title: '别名（客户看到的名字）',
          width: 180,
          render: (_v, r) => (
            <Input
              size="small"
              placeholder={'原名：' + r.item.name}
              value={r.alias}
              onChange={(e) => patchRow(r.itemId, { alias: e.target.value })}
              onBlur={(e) => {
                if (e.target.value !== ((r.setting && r.setting.alias) || r.item.alias || '')) {
                  saveAlias(r, e.target.value)
                }
              }}
              onPressEnter={(e: any) => e.currentTarget.blur()}
            />
          ),
        }
        ] as NonNullable<TableProps<Row>['columns']>) : []),
        {
          title: '客户价',
          width: 130,
          align: 'right' as const,
          render: (_v, r) => (
            <div>
              {priceCell(r, 'sale', true)}
              {staffId && isAgentAccount ? (
                <CostHint
                  costCents={draft[priceKey('cost', r.itemId)]}
                  saleCents={draft[priceKey('sale', r.itemId)]}
                />
              ) : null}
            </div>
          ),
        },
        ...(showCost
          ? [
              {
                title: '成本价',
                width: 130,
                align: 'right' as const,
                render: (_v: any, r: Row) => priceCell(r, 'cost', !!costEditable),
              },
            ]
          : []),
      ]}
    />
  )

  const extra = (
    <Space wrap>
      <Select
        size="small"
        style={{ width: 130 }}
        placeholder="按品类批量"
        value={bulkCatalog || undefined}
        onChange={(v) => setBulkCatalog(v || '')}
        options={catalogs.map((c) => ({ value: c, label: c }))}
      />
      <Button size="small" disabled={!bulkCatalog} onClick={() => setCatalogVisible(bulkCatalog, true)}>
        整类可见
      </Button>
      <Button size="small" disabled={!bulkCatalog} onClick={() => setCatalogVisible(bulkCatalog, false)}>
        整类隐藏
      </Button>
      <Button
        type="primary"
        icon={<SaveOutlined />}
        disabled={dirtyKeys.length === 0}
        onClick={savePrices}
      >
        保存价格修改 ({dirtyKeys.length})
      </Button>
    </Space>
  )

  const hint = (
    <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
      开关、别名、排序、效果图点一下就保存；价格填完点右上角「保存价格修改」。
      {staffId
        ? '没改过的项目跟随总部：改任意一项后，这一行的三项开关就以当前显示为准。'
        : '这里配的是总部默认值，代理没自定义的项目都按这套走。'}
    </div>
  )

  if (!title) {
    return (
      <div>
        <div style={{ marginBottom: 12, textAlign: 'right' }}>{extra}</div>
        {body}
        {hint}
      </div>
    )
  }

  return (
    <Card className="page-card" title={title} extra={extra}>
      {body}
      {hint}
    </Card>
  )
}

/** 代理自己的客户价低于成本时提示一下，不拦 */
function CostHint({ costCents, saleCents }: { costCents?: number; saleCents?: number }) {
  if (costCents === undefined || saleCents === undefined || saleCents >= costCents) return null
  return <div style={{ fontSize: 11, color: '#faad14' }}>低于成本价</div>
}
