import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { pb, yuan } from '../../api/pb'

const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: '待确认', cls: 'status-pending' },
  confirmed: { text: '已确认', cls: 'status-processing' },
  producing: { text: '生产中', cls: 'status-processing' },
  shipped: { text: '已发货', cls: 'status-processing' },
  done: { text: '已完成', cls: 'status-done' },
  cancelled: { text: '已取消', cls: 'status-cancel' },
}

type Row = {
  id: string
  order_no: string
  status: string
  created: string
  total_cents?: number
  itemCount: number
  measurementCode: string
}

export default function MyOrders() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useDidShow(() => {
    load()
  })

  const load = async () => {
    const user: any = pb.authStore.record
    if (!user) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }
    setLoading(true)
    try {
      const orders = await pb.collection('orders').getFullList<any>({
        filter: `customer = "${user.id}" && is_deleted != true`,
        sort: '-created',
      })

      const ids = orders.map((o: any) => o.id)
      const priceMap: Record<string, number> = {}
      if (ids.length) {
        const f = ids.map((id: string) => `order="${id}"`).join(' || ')
        const prices = await pb.collection('order_prices').getFullList<any>({ filter: f })
        prices.forEach((p: any) => {
          // 客户只会拿到自己版本的 1 条
          if (priceMap[p.order] === undefined) priceMap[p.order] = p.total_cents
        })
      }

      setRows(
        orders.map((o: any) => ({
          id: o.id,
          order_no: o.order_no,
          status: o.review_status === 'rejected' ? 'cancelled' : o.status,
          created: o.created,
          total_cents: priceMap[o.id],
          itemCount: 0,
          measurementCode: o.measurement || '',
        }))
      )
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  return (
    <View className="container">
      {loaded && rows.length === 0 && (
        <View className="card">
          <View className="empty">还没有订单</View>
          <View
            className="btn-primary"
            style={{ marginTop: 24 }}
            onClick={() => Taro.navigateTo({ url: '/pages/order/index' })}
          >
            去下单
          </View>
        </View>
      )}

      {rows.map((r) => {
        const s = STATUS[r.status] || { text: r.status, cls: '' }
        return (
          <View
            className="card"
            key={r.id}
            onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${r.id}` })}
          >
            <View className="row">
              <Text style={{ fontSize: 32, fontWeight: 600 }}>{r.order_no}</Text>
              <Text className={'tag ' + s.cls}>{s.text}</Text>
            </View>
            <View className="row" style={{ marginTop: 20 }}>
              <Text className="muted">
                {r.itemCount} 个项目
                {r.measurementCode ? ' · ' + r.measurementCode : ''}
              </Text>
              <Text style={{ fontSize: 32, color: '#cf1322', fontWeight: 600 }}>
                {r.total_cents === undefined ? '-' : '¥' + yuan(r.total_cents)}
              </Text>
            </View>
            <View className="muted" style={{ marginTop: 10 }}>
              {String(r.created).replace('T', ' ').slice(0, 16)}
            </View>
          </View>
        )
      })}

      {loading && (
        <View className="empty">加载中…</View>
      )}

      <View className="row" style={{ marginTop: 8, gap: 16 }}>
        <View
          className="btn-ghost"
          style={{ flex: 1 }}
          onClick={() => Taro.navigateTo({ url: '/pages/order/index' })}
        >
          再下一单
        </View>
        <View
          className="btn-ghost"
          style={{ flex: 1 }}
          onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}
        >
          返回首页
        </View>
      </View>
    </View>
  )
}
