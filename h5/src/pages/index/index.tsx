import { useState } from 'react'
import { View, Text, Swiper, SwiperItem } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { pb, yuan } from '../../api/pb'
import { rememberAgent, withAgent } from '../../api/agent'
import './index.scss'

const ENTRIES = [
  { key: 'measure', label: '填写量体', icon: '量', cls: 'icon-blue', url: '/pages/measure/index' },
  { key: 'order', label: '开始下单', icon: '单', cls: 'icon-teal', url: '/pages/order/index' },
  { key: 'orders', label: '我的订单', icon: '订', cls: 'icon-orange', url: '/pages/orders/index' },
  { key: 'history', label: '历史尺码', icon: '尺', cls: 'icon-purple', url: '/pages/measure/index?history=1' },
]

const BANNERS = [
  {
    cls: 'banner-1',
    title: '一人一版 · 精准定制',
    desc: '按你的尺寸单独打版，穿着更贴合',
    tag: '填写量体 →',
    url: '/pages/measure/index',
  },
  {
    cls: 'banner-2',
    title: '历史尺码一键复用',
    desc: '量过的不再量，随时修改再下单',
    tag: '查看历史尺码 →',
    url: '/pages/measure/index?history=1',
  },
  {
    cls: 'banner-3',
    title: '订单进度随时可查',
    desc: '审核、生产、发货，每一步都看得到',
    tag: '我的订单 →',
    url: '/pages/orders/index',
  },
]

const STATUS_TEXT: Record<string, { text: string; cls: string }> = {
  pending: { text: '待审核', cls: 'warn' },
  confirmed: { text: '已确认', cls: '' },
  producing: { text: '生产中', cls: '' },
  shipped: { text: '已发货', cls: '' },
  done: { text: '已完成', cls: 'done' },
  cancelled: { text: '已取消', cls: 'warn' },
}

export default function Index() {
  const [user, setUser] = useState<any>(pb.authStore.isValid ? pb.authStore.record : null)
  const [orders, setOrders] = useState<any[]>([])
  // 品类入口：由服务端下发的可见项目去重得出，代理只卖床垫时这里就只有床垫
  const [catalogs, setCatalogs] = useState<string[]>([])

  useDidShow(() => {
    // 刷新、从登录页返回、从历史记录进来时都再抓一次代理标识
    rememberAgent()
    const u: any = pb.authStore.isValid ? pb.authStore.record : null
    setUser(u)
    if (u) {
      loadOrders(u.id)
      loadCatalogs()
    } else {
      setOrders([])
      setCatalogs([])
    }
  })

  const loadCatalogs = async () => {
    try {
      const res: any = await pb.send(
        `/api/gg/items/prices?agent=${encodeURIComponent(rememberAgent())}`,
        {}
      )
      // 品类字典：顺序和停用都由后台控制，这里不再按项目自己推
      const dict: any[] = Array.isArray(res?.catalogs) ? res.catalogs : []
      const list: string[] = []
      dict.forEach((c) => {
        const n = String((c && c.name) || '')
        if (n && list.indexOf(n) < 0) list.push(n)
      })
      if (!list.length) {
        const conf: Record<string, any> = res?.items || {}
        Object.keys(conf).forEach((id) => {
          const it = conf[id]
          if (!it || it.h5_visible === false) return
          const c = it.catalog || '衣服'
          if (list.indexOf(c) < 0) list.push(c)
        })
      }
      setCatalogs(list)
    } catch (e) {
      setCatalogs([])
    }
  }

  const loadOrders = async (uid: string) => {
    try {
      const list = await pb.collection('orders').getFullList<any>({
        filter: `customer = "${uid}" && is_deleted != true`,
        sort: '-created',
      })
      const recent = list.slice(0, 3)
      if (!recent.length) {
        setOrders([])
        return
      }
      const f = recent.map((o) => `order="${o.id}"`).join(' || ')
      const prices = await pb.collection('order_prices').getFullList<any>({ filter: f })
      const map: Record<string, number> = {}
      prices.forEach((p) => {
        if (map[p.order] === undefined) map[p.order] = p.total_cents
      })
      setOrders(
        recent.map((o) => ({
          id: o.id,
          order_no: o.order_no,
          status: o.review_status === 'rejected' ? 'cancelled' : o.status,
          created: o.created,
          total_cents: map[o.id],
        }))
      )
    } catch (e) {
      setOrders([])
    }
  }

  const go = (url: string) => {
    if (!pb.authStore.isValid) {
      Taro.navigateTo({ url: withAgent('/pages/login/index') })
      return
    }
    Taro.navigateTo({ url: withAgent(url) })
  }

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
    setOrders([])
    Taro.showToast({ title: '已退出', icon: 'none' })
  }

  return (
    <View className="home">
      <View className="hero">
        <Text className="brand">专属定制</Text>
        <Text className="brand-sub">一人一版 · 为你而做</Text>

        <View className="hero-user">
          <View>
            <Text className="hero-name">{user ? user.display_name || '你好' : '未登录'}</Text>
            <Text className="hero-phone">{user ? user.username : '登录后查看订单与进度'}</Text>
          </View>
          <View
            className="hero-action"
            onClick={() =>
              user
                ? Taro.navigateTo({ url: '/pages/orders/index' })
                : Taro.navigateTo({ url: withAgent('/pages/login/index') })
            }
          >
            {user ? '我的订单' : '去登录'}
          </View>
        </View>
      </View>

      <View className="grid-card">
        {ENTRIES.map((e) => (
          <View className="grid-item" key={e.key} onClick={() => go(e.url)}>
            <View className={'grid-icon ' + e.cls}>{e.icon}</View>
            <Text className="grid-label">{e.label}</Text>
          </View>
        ))}
      </View>

      {catalogs.length > 0 && (
        <View className="section">
          <View className="section-head">
            <Text className="section-title">选择品类</Text>
          </View>
          <View className="catalog-row">
            {catalogs.map((c) => (
              <View
                className="catalog-card"
                key={c}
                onClick={() => go(`/pages/order/index?catalog=${encodeURIComponent(c)}`)}
              >
                <Text className="catalog-name">{c}</Text>
                <Text className="catalog-tip">去选购 ›</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className="banner-wrap">
        <Swiper
          className="banner"
          indicatorDots
          autoplay
          circular
          interval={4500}
          indicatorColor="rgba(255,255,255,0.35)"
          indicatorActiveColor="#ffffff"
        >
          {BANNERS.map((b) => (
            <SwiperItem key={b.cls}>
              <View className={'banner-item ' + b.cls} onClick={() => go(b.url)}>
                <Text className="banner-title">{b.title}</Text>
                <Text className="banner-desc">{b.desc}</Text>
                <Text className="banner-tag">{b.tag}</Text>
              </View>
            </SwiperItem>
          ))}
        </Swiper>
      </View>

      <View className="section">
        <View className="section-head">
          <Text className="section-title">最近订单</Text>
          <Text
            className="section-more"
            onClick={() => go('/pages/orders/index')}
          >
            全部 ›
          </Text>
        </View>

        {orders.length === 0 && (
          <View className="empty-box">{user ? '还没有订单，去下一单吧' : '登录后可查看订单'}</View>
        )}

        {orders.map((o) => {
          const s = STATUS_TEXT[o.status] || { text: o.status, cls: '' }
          return (
            <View
              className="order-row"
              key={o.id}
              onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${o.id}` })}
            >
              <View>
                <Text className="order-no">{o.order_no}</Text>
                <Text className={'status-pill ' + s.cls}>{s.text}</Text>
                <View className="order-meta">
                  {String(o.created || '').replace('T', ' ').slice(0, 16)}
                </View>
              </View>
              <Text className="order-amount">
                {o.total_cents === undefined ? '-' : '¥' + yuan(o.total_cents)}
              </Text>
            </View>
          )
        })}
      </View>

      {user && (
        <View className="logout" onClick={logout}>
          退出登录
        </View>
      )}
    </View>
  )
}
