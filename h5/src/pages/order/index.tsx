import { useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Image } from '@tarojs/components'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import { pb, yuan, type Catalog, type Item, type MeasureField, type Measurement } from '../../api/pb'
import { rememberAgent, clearAgentCode, withAgent } from '../../api/agent'
import RemarkEditor from '../../components/RemarkEditor'

const CATEGORY_ORDER: Record<string, number> = { base: 0, main: 1, extra: 2 }
const CATEGORY_NAME: Record<string, string> = { base: '基础', main: '主要定制项', extra: '补充项' }
const MAX_QTY = 99

export default function Order() {
  const router = useRouter()
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [mid, setMid] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [qty, setQty] = useState<Record<string, number>>({})
  // 项目规格：手套 → 分体/连体，后台配什么这里显示什么
  const [specs, setSpecs] = useState<Record<string, string>>({})
  // items 不是公开集合，效果图要带 file token 才能访问
  const [fileToken, setFileToken] = useState('')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')
  // 代理专属链接带来的归属
  const [agentCode, setAgentCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ready, setReady] = useState(false)

  // 当前品类：一单一品类，勾了多个品类时提交会拆成多张单
  const [tab, setTab] = useState('')
  // 参数字典：项目只存字段 key，标签/单位/选项都从这里取
  const [fieldDefs, setFieldDefs] = useState<MeasureField[]>([])
  // 品类字典：顺序、停用，以及每个品类固定要量的尺寸
  const [catalogDefs, setCatalogDefs] = useState<Catalog[]>([])
  // 本单必填、档案里却没值的参数，就地补填写回档案
  const [fill, setFill] = useState<Record<string, string>>({})

  // 从「查看/修改尺寸」返回时只刷新档案，别把已勾的项目和收货信息清掉
  const refreshMeasurements = async () => {
    const user: any = pb.authStore.record
    if (!user) return
    try {
      const ms = await pb.collection('measurements').getFullList<Measurement>({
        filter: `customer = "${user.id}"`,
        sort: '-updated',
      })
      setMeasurements(ms)
    } catch (e) {}
  }
  useDidShow(() => {
    refreshMeasurements()
  })

  useEffect(() => {
    const user: any = pb.authStore.record
    if (!user) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => Taro.redirectTo({ url: '/pages/login/index' }), 600)
      return
    }
    setPhone(user.phone || user.username || '')
    setContact(user.display_name || '')
    // 地址栏、路由参数、本地缓存里任意一个还在，就不会把单子变成无代理
    const code = rememberAgent()
    setAgentCode(code)
    // 链接被改过就当场提示，别等填完一整张单再报错
    if (code) {
      pb.send(`/api/gg/agent/check?code=${encodeURIComponent(code)}`, {})
        .then((r: any) => {
          if (r?.ok) return
          clearAgentCode()
          setAgentCode('')
          Taro.showModal({
            title: '专属链接无效',
            content: '该链接已失效或被修改，请通过代理重新发送的链接进入',
            showCancel: false,
          })
        })
        .catch(() => {})
    }
    load(user.id)
  }, [])

  const load = async (uid: string) => {
    try {
      const [ms, its, priceRes, token, fs] = await Promise.all([
        pb.collection('measurements').getFullList<Measurement>({
          filter: `customer = "${uid}"`,
          sort: '-updated',
        }),
        pb.collection('items').getFullList<Item>({ filter: 'is_active = true', sort: 'sort' }),
        // 价格由服务端定：客户所属代理的自定价 > 全局客户价，前端不再自己拼
        pb.send(`/api/gg/items/prices?agent=${encodeURIComponent(rememberAgent())}`, {}),
        pb.files.getToken().catch(() => ''),
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
      ])
      setMeasurements(ms)
      setFileToken(token)
      setFieldDefs(fs.filter((f) => f.is_active !== false))
      const p = router.params.measurement
      if (p) setMid(p)
      else if (ms.length) setMid(ms[0].id)

      const res: any = priceRes || {}
      setPriceMap(res.prices || {})

      // 品类字典：顺序与「还在卖」以服务端为准，停用的品类连同其项目一起不显示
      const dict: Catalog[] = Array.isArray(res.catalogs) ? res.catalogs : []
      const catNames: string[] = []
      dict.forEach((c) => {
        if (c && c.name && catNames.indexOf(c.name) < 0) catNames.push(c.name)
      })
      setCatalogDefs(dict)

      // 服务端已经算好这个客户该看到的值：代理设置 > 总部设置 > 项目原名
      const conf: Record<string, any> = res.items || {}
      const merged = its
        .map((it) => {
          const c = conf[it.id] || {}
          return {
            ...it,
            name: c.name || it.name,
            sort: c.sort !== undefined ? c.sort : it.sort,
            h5_visible: c.h5_visible !== undefined ? c.h5_visible : it.h5_visible !== false,
            h5_default: c.h5_default !== undefined ? c.h5_default : !!it.h5_default,
            in_price: c.in_price !== undefined ? c.in_price : it.in_price !== false,
            // 代理换过效果图时，服务端直接给带 token 的地址
            icon: c.icon || '',
          }
        })
        .filter(
          (it) =>
            it.h5_visible !== false &&
            (catNames.length === 0 || catNames.indexOf(it.catalog || '衣服') >= 0)
        )
        .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      setItems(merged)

      // 品类 tab：链接里指定了就用它，否则落在第一个品类上
      const cats = catNames.length ? catNames.slice() : []
      if (!cats.length) {
        merged.forEach((it) => {
          const c = it.catalog || '衣服'
          if (cats.indexOf(c) < 0) cats.push(c)
        })
      }
      const want = String(router.params.catalog || '')
      const landing = cats.indexOf(want) >= 0 ? want : cats[0] || ''
      setTab(landing)

      // 默认勾选只作用于进来的那个品类：否则进衣服页会顺带把床垫的默认项也带上，
      // 提交时凭空多出一张床垫单。基础价由 pickedList 按品类自动跟随。
      const init: Record<string, number> = {}
      merged.forEach((it) => {
        const c = it.catalog || '衣服'
        init[it.id] = c === landing && (it.category === 'base' || it.h5_default) ? 1 : 0
      })
      setQty(init)
      setReady(true)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载失败', icon: 'none' })
      setReady(true)
    }
  }

  // 结算清单：勾了哪个品类的项目，就自动带上那个品类的基础价。
  // 基础价是「打版费」性质，按品类各算一份，客户不用手动勾。
  const pickedList = useMemo(() => {
    const nonBase = items.filter((it) => it.category !== 'base' && (qty[it.id] || 0) > 0)
    const cats: string[] = []
    nonBase.forEach((it) => {
      const c = it.catalog || '衣服'
      if (cats.indexOf(c) < 0) cats.push(c)
    })
    const base = items.filter((it) => {
      if (it.category !== 'base') return false
      const c = it.catalog || '衣服'
      return cats.length ? cats.indexOf(c) >= 0 : c === tab
    })
    return nonBase.concat(base)
  }, [items, qty, tab])

  const total = useMemo(() => {
    // 不计入合计的项目照样下单，只是不参与这里的累加（服务端客户版价格同样按 0 算）
    return pickedList.reduce(
      (sum, it) =>
        it.in_price === false ? sum : sum + (priceMap[it.id] || 0) * Math.max(1, qty[it.id] || 1),
      0
    )
  }, [pickedList, qty, priceMap])

  // 品类 tab：顺序听品类字典的；勾选状态跨品类共用，切 tab 不会丢已选的项目
  const catalogs = useMemo(() => {
    if (catalogDefs.length) return catalogDefs.map((c) => c.name)
    const list: string[] = []
    items.forEach((it) => {
      const c = it.catalog || '衣服'
      if (list.indexOf(c) < 0) list.push(c)
    })
    return list
  }, [catalogDefs, items])

  // 品类 → 固定尺寸集：品类下所有项目共用这一套
  const catFieldMap = useMemo(() => {
    const m: Record<string, Catalog['fields']> = {}
    catalogDefs.forEach((c) => {
      m[c.name] = c.fields || []
    })
    return m
  }, [catalogDefs])

  const visible = useMemo(
    () => items.filter((it) => (it.catalog || '衣服') === tab),
    [items, tab]
  )

  const fieldMap = useMemo(() => {
    const m: Record<string, MeasureField> = {}
    fieldDefs.forEach((f) => {
      m[f.key] = f
    })
    return m
  }, [fieldDefs])

  // 档案卡片上只看本品类要量的尺寸，别让买袜子的客户盯着胸围
  const previewKeys = useMemo(() => {
    const keys: string[] = []
    ;(catFieldMap[tab] || []).forEach((b) => {
      if (keys.length >= 3) return
      if (fieldMap[b.key] && keys.indexOf(b.key) < 0) keys.push(b.key)
    })
    return keys
  }, [catFieldMap, tab, fieldMap])

  const grouped = useMemo(() => {
    const map: Record<string, Item[]> = {}
    visible.forEach((it) => {
      ;(map[it.category] ||= []).push(it)
    })
    return Object.keys(map)
      .sort((a, b) => (CATEGORY_ORDER[a] ?? 9) - (CATEGORY_ORDER[b] ?? 9))
      .map((k) => ({ key: k, name: CATEGORY_NAME[k] || k, list: map[k] }))
  }, [visible])

  const current = measurements.find((m) => m.id === mid) || null

  // 本单必填：按结算清单里涉及的品类取各自的必填尺寸（拆单后每单校验自己那套）
  const missingKeys = useMemo(() => {
    const keys: string[] = []
    pickedList.forEach((it) => {
      ;(catFieldMap[it.catalog || '衣服'] || []).forEach((b) => {
        if (!b.required || !fieldMap[b.key]) return
        if (keys.indexOf(b.key) >= 0) return
        const own = fill[b.key] !== undefined ? fill[b.key] : current?.data?.[b.key]
        if (own === null || own === undefined || String(own).trim() === '') keys.push(b.key)
      })
    })
    return keys
  }, [pickedList, catFieldMap, fill, current, fieldMap])

  // 显示用：缺失的 + 已经动手填过的。只按「缺失」渲染会让输入框在敲下第一个
  // 字符后当场消失，客户没法把数字打完。
  const fillKeys = useMemo(() => {
    const keys = missingKeys.slice()
    Object.keys(fill).forEach((k) => {
      if (fieldMap[k] && keys.indexOf(k) < 0) keys.push(k)
    })
    return keys
  }, [missingKeys, fill, fieldMap])

  // 勾选 / 取消：勾选型直接 1 份；数量型选中后默认 1，可再调整
  const toggleItem = (it: Item) => {
    if (it.category === 'base') return
    setQty((prev) => {
      const cur = prev[it.id] || 0
      return { ...prev, [it.id]: cur > 0 ? 0 : 1 }
    })
  }

  // 数量型加减：最小 1，取消选中才是 0
  const changeQty = (id: string, delta: number) => {
    setQty((prev) => {
      const cur = prev[id] || 0
      const next = Math.min(MAX_QTY, Math.max(1, cur + delta))
      return { ...prev, [id]: next }
    })
  }

  const imgUrl = (it: Item, thumb?: string) => {
    // 代理自定义图：服务端已经拼好带文件 token 的地址
    if (it.icon) return it.icon
    if (!it.image) return ''
    return pb.files.getURL(it, it.image, {
      ...(thumb ? { thumb } : {}),
      ...(fileToken ? { token: fileToken } : {}),
    })
  }

  // 查看效果图：点击缩略图打开大图，不影响选中状态
  const previewItem = (it: Item) => {
    const url = imgUrl(it, '600x0')
    if (!url) return
    Taro.previewImage({ current: url, urls: [url] })
  }

  const submit = async () => {
    const user: any = pb.authStore.record
    if (!user) return Taro.showToast({ title: '请先登录', icon: 'none' })
    if (!mid) return Taro.showToast({ title: '请先选择量体档案', icon: 'none' })
    if (!address.trim()) return Taro.showToast({ title: '请填写收货地址', icon: 'none' })

    // 按项目顺序提交：类型与单位由服务端按下单时的配置固化
    const picked = pickedList
    if (!picked.length) return Taro.showToast({ title: '请至少选择一个项目', icon: 'none' })
    // 后台配了规格的项目必须先选一个（服务端也会校验）
    const missing = picked.find((it) => it.options?.length && !specs[it.id])
    if (missing) return Taro.showToast({ title: `请选择「${missing.name}」的规格`, icon: 'none' })
    // 本单必填的定制参数缺了就补齐，别等后端退回来
    if (missingKeys.length) {
      const names = missingKeys.map((k) => fieldMap[k]?.label || k).join('、')
      return Taro.showToast({ title: `请先补填：${names}`, icon: 'none' })
    }

    const snapshot = picked.map((it) => {
      const isQty = it.qty_mode === 'qty'
      return {
        item_id: it.id,
        name: it.name,
        category: it.category,
        qty: Math.max(1, qty[it.id] || 1),
        unit: isQty ? it.unit || '' : '',
        qty_mode: isQty ? 'qty' : 'check',
        spec: specs[it.id] || '',
      }
    })

    setSubmitting(true)
    try {
      // 补填的值写回档案：尺码库全品类共用一份，下次下单直接复用
      const fillKeys = Object.keys(fill)
      if (fillKeys.length) {
        const merged: Record<string, any> = { ...(current?.data || {}) }
        fillKeys.forEach((k) => {
          const f = fieldMap[k]
          merged[k] = f && f.type === 'number' ? Number(fill[k]) : fill[k]
        })
        await pb.collection('measurements').update(mid, { data: merged })
      }

      // 走服务端路由：由后端按品类拆单、拆「客户原始尺寸 / 项目」，并计算价格
      const res: any = await pb.send('/api/gg/orders', {
        method: 'POST',
        body: {
          measurement: mid,
          items: snapshot,
          contact_name: contact,
          phone,
          address: address.trim(),
          remark,
          agent: agentCode,
        },
      })
      const count = (res?.orders || []).length
      Taro.showToast({
        title: count > 1 ? `已拆成 ${count} 张订单` : '下单成功',
        icon: 'success',
      })
      setTimeout(() => Taro.redirectTo({ url: '/pages/orders/index' }), 800)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '下单失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) {
    return (
      <View className="container">
        <View className="card">
          <Text className="muted">加载中…</Text>
        </View>
      </View>
    )
  }

  return (
    <View className="container">
      <View className="card">
        <View className="card-title">收货信息</View>
        <Text className="label">联系人</Text>
        <Input
          className="input"
          value={contact}
          onInput={(e) => setContact(e.detail.value)}
          placeholder="收件人"
        />
        <Text className="label">电话</Text>
        <Input
          className="input"
          type="number"
          value={phone}
          onInput={(e) => setPhone(e.detail.value)}
          placeholder="联系电话"
        />
        <Text className="label">收货地址</Text>
        <Input
          className="input"
          value={address}
          onInput={(e) => setAddress(e.detail.value)}
          placeholder="省市区 + 详细地址"
        />
        {agentCode ? <Text className="muted">本单由专属代理服务</Text> : null}
      </View>

      {catalogs.length > 1 && (
        <View className="card">
          <View className="card-title">定制品类</View>
          <View className="spec-row">
            {catalogs.map((c) => (
              <View
                key={c}
                className={'spec-chip' + (tab === c ? ' spec-chip-on' : '')}
                onClick={() => setTab(c)}
              >
                {c}
              </View>
            ))}
          </View>
          <Text className="muted">
            不同品类分开成单，切过去勾选的项目会一起提交并自动拆单
          </Text>
        </View>
      )}

      {grouped.map((g) => (
        <View className="card" key={g.key}>
          <View className="card-title">{g.name}</View>

          {g.key === 'base' ? (
            g.list.map((it) => {
              const price = priceMap[it.id]
              return (
                <View className="base-line" key={it.id}>
                  <View>
                    <Text style={{ fontSize: 32, fontWeight: 600 }}>{it.name}</Text>
                    <View className="muted" style={{ marginTop: 6 }}>
                      {price === undefined ? '价格待定' : '¥' + yuan(price)}
                      {it.in_price === false ? '（不计入合计）' : ''}
                    </View>
                  </View>
                  <Text className="tag">基础项</Text>
                </View>
              )
            })
          ) : (
            <View className="item-grid">
              {g.list.map((it) => {
                const isQty = it.qty_mode === 'qty'
                const unit = it.unit || ''
                const price = priceMap[it.id]
                const q = qty[it.id] || 0
                const active = q > 0
                return (
                  <View
                    key={it.id}
                    className={
                      'item-card' +
                      (active ? ' item-card-active' : '') +
                      (it.image ? ' item-card-has-img' : '')
                    }
                  >
                    <View className="item-head" onClick={() => toggleItem(it)}>
                      <View className={active ? 'item-check item-check-on' : 'item-check'}>
                        {active ? '✓' : ''}
                      </View>
                      <View style={{ flex: 1 }} className="item-head-text">
                        <View className="item-name">{it.name}</View>
                        <View className="item-price">
                          {price === undefined ? '价格待定' : '¥' + yuan(price)}
                          {isQty && unit ? ' / ' + unit : ''}
                          {it.in_price === false ? '（不计入合计）' : ''}
                        </View>
                      </View>
                    </View>

                    {it.image ? (
                      <View className="item-thumb" onClick={() => previewItem(it)}>
                        <Image
                          className="item-thumb-img"
                          src={imgUrl(it, '200x200')}
                          mode="aspectFill"
                        />
                        <Text className="item-thumb-tip">查看</Text>
                      </View>
                    ) : null}

                    {it.options?.length ? (
                      <View className="spec-row">
                        {it.options.map((o) => (
                          <View
                            key={o}
                            className={
                              'spec-chip' + (specs[it.id] === o ? ' spec-chip-on' : '')
                            }
                            onClick={(e: any) => {
                              e.stopPropagation()
                              setSpecs((prev) => ({ ...prev, [it.id]: o }))
                              // 选规格就等于选中这个项目，省一次点击
                              setQty((prev) => (prev[it.id] > 0 ? prev : { ...prev, [it.id]: 1 }))
                            }}
                          >
                            {o}
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {isQty && active ? (
                      <View className="item-stepper">
                        <View className="stepper-btn" onClick={() => changeQty(it.id, -1)}>
                          −
                        </View>
                        <Text className="stepper-num">{q}</Text>
                        <View
                          className="stepper-btn stepper-btn-primary"
                          onClick={() => changeQty(it.id, 1)}
                        >
                          +
                        </View>
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </View>
          )}
        </View>
      ))}

      <View className="card">
        <View className="card-title">填写尺寸</View>
        {measurements.length === 0 && (
          <View>
            <Text className="muted">还没有尺寸档案，先填一份</Text>
          </View>
        )}
        {measurements.map((m) => (
          <View
            key={m.id}
            style={{
              padding: 20,
              borderRadius: 12,
              border: mid === m.id ? '2px solid #1677ff' : '1px solid #eee',
              marginBottom: 14,
              background: mid === m.id ? '#f0f7ff' : '#fff',
            }}
            onClick={() => {
              setMid(m.id)
              // 换档案就把没保存的补填清掉，别串到别人/别的档案上
              setFill({})
            }}
          >
            <View className="row">
              <Text style={{ fontWeight: 600 }}>{m.code}</Text>
              <View style={{ display: 'flex', alignItems: 'center' }}>
                <Text className="muted" style={{ marginRight: 10 }}>
                  {m.name}
                </Text>
                <View
                  style={{
                    color: '#1677ff',
                    fontSize: 22,
                    border: '1px solid #1677ff',
                    borderRadius: 6,
                    padding: '4px 12px',
                  }}
                  onClick={(e: any) => {
                    e.stopPropagation()
                    setMid(m.id)
                    setFill({})
                    Taro.navigateTo({ url: withAgent(`/pages/measure/index?edit=${m.id}`) })
                  }}
                >
                  查看
                </View>
              </View>
            </View>
            <View className="muted" style={{ marginTop: 6 }}>
              {previewKeys.length
                ? previewKeys.map((k) => `${fieldMap[k].label} ${m.data?.[k] || '-'}`).join(' / ')
                : '这个品类不用量尺寸'}
            </View>
          </View>
        ))}
        <View
          className="btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() =>
            Taro.navigateTo({ url: `/pages/measure/index?catalog=${encodeURIComponent(tab)}` })
          }
        >
          填写新尺寸
        </View>
      </View>

      {fillKeys.length > 0 && (
        <View className="card">
          <View className="card-title">补填缺失尺寸</View>
          {fillKeys.map((k) => {
            const f = fieldMap[k]
            return (
              <View className="field-row" key={k}>
                <Text className="field-label">
                  {f.label}
                  {f.unit ? `(${f.unit})` : ''}
                </Text>
                <Input
                  className="input"
                  type={f.type === 'number' ? 'digit' : 'text'}
                  value={fill[k] || ''}
                  placeholder="必填"
                  onInput={(e) => setFill((prev) => ({ ...prev, [k]: e.detail.value }))}
                />
              </View>
            )
          })}
          <Text className="muted">填一次就存进你的尺寸档案，下次不用再填</Text>
        </View>
      )}

      <View className="card">
        <View className="card-title">备注</View>
        <RemarkEditor value={remark} onChange={setRemark} />
      </View>

      <View className="footer-bar">
        <View>
          <Text className="muted">合计</Text>
          <Text className="price-total" style={{ marginLeft: 12 }}>
            ¥{yuan(total)}
          </Text>
        </View>
        <View
          className={submitting ? 'btn-primary btn-disabled' : 'btn-primary'}
          style={{ width: 240 }}
          onClick={submitting ? undefined : submit}
        >
          {submitting ? '提交中…' : '提交订单'}
        </View>
      </View>
    </View>
  )
}
