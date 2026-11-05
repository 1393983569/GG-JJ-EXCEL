import { useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Image } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { pb, yuan, type Item, type ItemPrice, type Measurement } from '../../api/pb'

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
  // items 不是公开集合，效果图要带 file token 才能访问
  const [fileToken, setFileToken] = useState('')
  const [address, setAddress] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [remark, setRemark] = useState('')
  // 代理专属链接带来的归属；意向售价客户可填可不填
  const [agentCode, setAgentCode] = useState('')
  const [intended, setIntended] = useState('')
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
    // 与 app.tsx 里 useLaunch 写入的 key 保持一致
    const code = String(Taro.getStorageSync('agent_code') || '')
    setAgentCode(code)
    // 链接被改过就当场提示，别等填完一整张单再报错
    if (code) {
      pb.send(`/api/gg/agent/check?code=${encodeURIComponent(code)}`)
        .then((r: any) => {
          if (r?.ok) return
          Taro.removeStorageSync('agent_code')
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
      const [ms, its, ps, token] = await Promise.all([
        pb.collection('measurements').getFullList<Measurement>({
          filter: `customer = "${uid}"`,
          sort: '-updated',
        }),
        pb.collection('items').getFullList<Item>({ filter: 'is_active = true', sort: 'sort' }),
        pb.collection('item_prices').getFullList<ItemPrice>({}),
        pb.files.getToken().catch(() => ''),
      ])
      setMeasurements(ms)
      setFileToken(token)
      const p = router.params.measurement
      if (p) setMid(p)
      else if (ms.length) setMid(ms[0].id)

      setItems(its)
      const map: Record<string, number> = {}
      ps.forEach((x) => {
        map[x.item] = x.price_cents || 0
      })
      setPriceMap(map)

      // 基础价固定累加，默认选中；其余项目默认不选
      const init: Record<string, number> = {}
      its.forEach((it) => {
        init[it.id] = it.category === 'base' ? 1 : 0
      })
      setQty(init)
      setReady(true)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载失败', icon: 'none' })
      setReady(true)
    }
  }

  const total = useMemo(() => {
    return Object.keys(qty).reduce((sum, id) => sum + (priceMap[id] || 0) * (qty[id] || 0), 0)
  }, [qty, priceMap])

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
    const snapshot = items
      .filter((it) => (qty[it.id] || 0) > 0)
      .map((it) => {
        const isQty = it.qty_mode === 'qty'
        return {
          item_id: it.id,
          name: it.name,
          category: it.category,
          qty: Math.max(1, qty[it.id] || 1),
          unit: isQty ? it.unit || '' : '',
          qty_mode: isQty ? 'qty' : 'check',
        }
      })
    if (!snapshot.length) return Taro.showToast({ title: '请至少选择一个项目', icon: 'none' })

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
          // 成交价下单时固化，之后改价目表不影响这张单
          terminal_price_cents: intended ? Math.round(Number(intended) * 100) : 0,
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
        <Text className="label">意向售价（元，可不填）</Text>
        <Input
          className="input"
          type="digit"
          value={intended}
          onInput={(e) => setIntended(e.detail.value)}
          placeholder="你希望这件衣服卖多少钱"
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
        <Input
          className="input"
          value={remark}
          onInput={(e) => setRemark(e.detail.value)}
          placeholder="可填写特殊要求"
        />
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
