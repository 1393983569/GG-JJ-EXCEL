import { useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { pb, yuan, type Item, type Measurement } from '../../api/pb'
import { rememberAgent, clearAgentCode } from '../../api/agent'
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
      const [ms, its, priceRes, token] = await Promise.all([
        pb.collection('measurements').getFullList<Measurement>({
          filter: `customer = "${uid}"`,
          sort: '-updated',
        }),
        pb.collection('items').getFullList<Item>({ filter: 'is_active = true', sort: 'sort' }),
        // 价格由服务端定：客户所属代理的自定价 > 全局客户价，前端不再自己拼
        pb.send(`/api/gg/items/prices?agent=${encodeURIComponent(rememberAgent())}`, {}),
        pb.files.getToken().catch(() => ''),
      ])
      setMeasurements(ms)
      setFileToken(token)
      const p = router.params.measurement
      if (p) setMid(p)
      else if (ms.length) setMid(ms[0].id)

      const res: any = priceRes || {}
      setPriceMap(res.prices || {})

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
        .filter((it) => it.h5_visible !== false)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      setItems(merged)

      // 默认勾选按项目配置走；基础价始终算 1 份，否则基础价就没了
      const init: Record<string, number> = {}
      merged.forEach((it) => {
        init[it.id] = it.category === 'base' || it.h5_default ? 1 : 0
      })
      setQty(init)
      setReady(true)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载失败', icon: 'none' })
      setReady(true)
    }
  }

  const total = useMemo(() => {
    // 不计入合计的项目照样下单，只是不参与这里的累加（服务端客户版价格同样按 0 算）
    const free: Record<string, boolean> = {}
    items.forEach((it) => {
      if (it.in_price === false) free[it.id] = true
    })
    return Object.keys(qty).reduce(
      (sum, id) => (free[id] ? sum : sum + (priceMap[id] || 0) * (qty[id] || 0)),
      0
    )
  }, [qty, priceMap, items])

  const grouped = useMemo(() => {
    const map: Record<string, Item[]> = {}
    items.forEach((it) => {
      ;(map[it.category] ||= []).push(it)
    })
    return Object.keys(map)
      .sort((a, b) => (CATEGORY_ORDER[a] ?? 9) - (CATEGORY_ORDER[b] ?? 9))
      .map((k) => ({ key: k, name: CATEGORY_NAME[k] || k, list: map[k] }))
  }, [items])

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
    const picked = items.filter((it) => (qty[it.id] || 0) > 0)
    if (!picked.length) return Taro.showToast({ title: '请至少选择一个项目', icon: 'none' })
    // 后台配了规格的项目必须先选一个（服务端也会校验）
    const missing = picked.find((it) => it.options?.length && !specs[it.id])
    if (missing) return Taro.showToast({ title: `请选择「${missing.name}」的规格`, icon: 'none' })

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
      // 走服务端路由：由后端拆分成「客户原始尺寸 / 项目」，并计算价格
      await pb.send('/api/gg/orders', {
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
      Taro.showToast({ title: '下单成功', icon: 'success' })
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

      <View className="card">
        <View className="card-title">选择尺码</View>
        {measurements.length === 0 && (
          <View>
            <Text className="muted">还没有量体数据</Text>
            <View
              className="btn-ghost"
              style={{ marginTop: 16 }}
              onClick={() => Taro.navigateTo({ url: '/pages/measure/index' })}
            >
              去填写量体
            </View>
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
            onClick={() => setMid(m.id)}
          >
            <View className="row">
              <Text style={{ fontWeight: 600 }}>{m.code}</Text>
              <Text className="muted">{m.name}</Text>
            </View>
            <View className="muted" style={{ marginTop: 6 }}>
              身高 {m.data?.height || '-'} / 胸围 {m.data?.chest || '-'} / 腰围 {m.data?.waist || '-'}
            </View>
          </View>
        ))}
      </View>

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
