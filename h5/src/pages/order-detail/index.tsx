import { useEffect, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { pb, yuan } from '../../api/pb'

const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: '待审核', cls: 'status-pending' },
  confirmed: { text: '已确认', cls: 'status-processing' },
  producing: { text: '生产中', cls: 'status-processing' },
  shipped: { text: '已发货', cls: 'status-processing' },
  done: { text: '已完成', cls: 'status-done' },
  cancelled: { text: '已取消', cls: 'status-cancel' },
}

export default function OrderDetail() {
  const router = useRouter()
  const id = router.params.id || ''
  const [order, setOrder] = useState<any>(null)
  const [spec, setSpec] = useState<any>(null)
  const [items, setItems] = useState<any[]>([])
  const [price, setPrice] = useState<any>(null)

  useEffect(() => {
    if (id) load()
  }, [id])

  const load = async () => {
    try {
      const o = await pb.collection('orders').getOne<any>(id)
      setOrder(o)

      // 客户只能看到自己的原始尺寸
      try {
        const s = await pb.collection('order_specs_customer').getFirstListItem<any>(
          `order = "${id}"`
        )
        setSpec(s)
      } catch (e) {
        setSpec(null)
      }

      // 客户只能看到自己选择的项目（stage=customer）
      try {
        const its = await pb.collection('order_items').getFullList<any>({
          filter: `order = "${id}" && stage = "customer"`,
          sort: 'sort',
        })
        setItems(its)
      } catch (e) {
        setItems([])
      }

      try {
        const ps = await pb.collection('order_prices').getFullList<any>({
          filter: `order = "${id}"`,
        })
        if (ps.length) setPrice(ps[0])
      } catch (e) {
        setPrice(null)
      }
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载失败', icon: 'none' })
    }
  }

  if (!order) {
    return (
      <View className="container">
        <View className="empty">加载中…</View>
      </View>
    )
  }

  const rejected = order.review_status === 'rejected'
  const s = rejected
    ? { text: '已驳回', cls: 'status-cancel' }
    : STATUS[order.status] || { text: order.status, cls: '' }
  const lines: any[] = (price && price.detail_json) || []

  return (
    <View className="container">
      <View className="card">
        <View className="row">
          <Text style={{ fontSize: 34, fontWeight: 700 }}>{order.order_no}</Text>
          <Text className={'tag ' + s.cls}>{s.text}</Text>
        </View>
        <View className="muted" style={{ marginTop: 16 }}>
          下单时间：{String(order.created || '').replace('T', ' ').slice(0, 16)}
        </View>
        {order.review_status === 'pending' ? (
          <View className="muted" style={{ marginTop: 8 }}>
            已提交，等待后台审核
          </View>
        ) : null}
      </View>

      <View className="card">
        <View className="card-title">收货信息</View>
        <View className="field-row">
          <Text className="field-label">联系人</Text>
          <Text>{order.contact_name || '-'}</Text>
        </View>
        <View className="field-row">
          <Text className="field-label">电话</Text>
          <Text>{order.phone || '-'}</Text>
        </View>
        <View className="field-row">
          <Text className="field-label">地址</Text>
          <Text style={{ flex: 1 }}>{order.address || '-'}</Text>
        </View>
      </View>

      <View className="card">
        <View className="card-title">定制项目</View>
        {items.map((it, i) => {
          const line = lines.find((l) => l.item_id === it.item)
          return (
            <View className="row" key={i} style={{ padding: '10px 0' }}>
              <Text style={{ fontSize: 30 }}>
                {it.name}
                {it.qty_mode === 'qty'
                  ? ' ' + (it.qty || 1) + (it.unit || '')
                  : it.qty > 1
                    ? ' ×' + it.qty
                    : ''}
              </Text>
              <Text className="muted">{line ? '¥' + yuan(line.amount_cents) : ''}</Text>
            </View>
          )
        })}
        {items.length === 0 && <View className="muted">无</View>}
      </View>

      <View className="card">
        <View className="card-title">我的量体数据</View>
        {spec && spec.text ? (
          <Text style={{ fontSize: 28, lineHeight: 1.9, color: '#444' }}>{spec.text}</Text>
        ) : (
          <View className="muted">暂无</View>
        )}
        {spec && spec.fabric ? (
          <View className="muted" style={{ marginTop: 16 }}>
            面料：{spec.fabric}
          </View>
        ) : null}
        {order.remark ? (
          <View className="muted" style={{ marginTop: 8 }}>
            备注：{order.remark}
          </View>
        ) : null}
      </View>

      <View className="card">
        <View className="row">
          <Text style={{ fontSize: 30 }}>应付金额</Text>
          <Text className="price-total">{price ? '¥' + yuan(price.total_cents) : '-'}</Text>
        </View>
        <View className="muted" style={{ marginTop: 12 }}>
          订单提交后如需修改，请联系客服
        </View>
      </View>
    </View>
  )
}
