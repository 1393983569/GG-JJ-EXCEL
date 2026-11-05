import { useEffect, useMemo, useState } from 'react'
import { View, Input, Picker, Text } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { pb, type MeasureField, type MeasureGroup, type Measurement } from '../../api/pb'

export default function Measure() {
  const router = useRouter()
  const [fields, setFields] = useState<MeasureField[]>([])
  const [groups, setGroups] = useState<MeasureGroup[]>([])
  const [data, setData] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState('')
  const [fabric, setFabric] = useState('')
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)

  const [historyOpen, setHistoryOpen] = useState(router.params.history === '1')
  const [suffix, setSuffix] = useState('')
  const [history, setHistory] = useState<Measurement[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  useEffect(() => {
    const user: any = pb.authStore.record
    if (user) {
      setPhone(user.phone || user.username || '')
      setName(user.display_name || '')
    }
    loadFields()
  }, [])

  const loadFields = async () => {
    try {
      const [fs, gs] = await Promise.all([
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
        pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' }),
      ])
      setFields(fs.filter((f) => f.is_active !== false))
      setGroups(gs)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载字段失败', icon: 'none' })
    }
  }

  const grouped = useMemo(() => {
    const map: Record<string, MeasureField[]> = {}
    fields.forEach((f) => {
      const gid = f.group || 'other'
      ;(map[gid] ||= []).push(f)
    })
    return groups
      .filter((g) => map[g.id] && map[g.id].length)
      .map((g) => ({ ...g, items: map[g.id] }))
      .concat(map['other'] ? [{ id: 'other', name: '其他', sort: 999, items: map['other'] } as any] : [])
  }, [fields, groups])

  const setValue = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  const queryHistory = async () => {
    if (!/^\d{4}$/.test(suffix)) {
      Taro.showToast({ title: '请输入订单号后四位', icon: 'none' })
      return
    }
    setLoadingHistory(true)
    try {
      const res = await pb.send('/api/gg/measure/lookup', {
        method: 'GET',
        query: { phone, suffix },
      })
      const items = (res && res.items) || []
      setHistory(items)
      if (!items.length) Taro.showToast({ title: '没有找到历史尺码', icon: 'none' })
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '查询失败', icon: 'none' })
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }

  const applyHistory = (m: Measurement) => {
    const next: Record<string, string> = {}
    Object.keys(m.data || {}).forEach((k) => {
      const v = m.data[k]
      next[k] = v === null || v === undefined ? '' : String(v)
    })
    setData(next)
    if (m.name) setName(m.name)
    if (m.gender) setGender(m.gender)
    if (m.fabric) setFabric(m.fabric)
    setHistoryOpen(false)
    Taro.showToast({ title: '已填入，可继续修改', icon: 'none' })
  }

  const save = async () => {
    const user: any = pb.authStore.record
    if (!user) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (!name.trim()) {
      Taro.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    const payload: Record<string, any> = {}
    Object.keys(data).forEach((k) => {
      const v = data[k]
      if (v === '' || v === undefined) return
      const f = fields.find((x) => x.key === k)
      payload[k] = f && f.type === 'number' ? Number(v) : v
    })
    if (gender) payload.gender = gender

    setSaving(true)
    try {
      const code = 'SZ' + String(Date.now()).slice(-8)
      const rec = await pb.collection('measurements').create({
        code,
        customer: user.id,
        name: name.trim(),
        phone,
        gender,
        data: payload,
        fabric,
        remark,
      })
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateTo({ url: `/pages/order/index?measurement=${rec.id}` })
      }, 600)
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const genderIndex = gender === '男' ? 0 : gender === '女' ? 1 : -1

  return (
    <View className="container">
      <View className="card">
        <View className="row" style={{ marginBottom: 20 }}>
          <View className="card-title" style={{ marginBottom: 0 }}>
            基本信息
          </View>
          <View
            style={{ color: '#1677ff', fontSize: 26 }}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            {historyOpen ? '收起' : '用历史尺码'}
          </View>
        </View>

        {historyOpen && (
          <View style={{ background: '#f7f8fa', borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <Text className="label">手机号 + 订单号后四位</Text>
            <View className="field-row">
              <Input
                className="input"
                type="number"
                maxlength={11}
                value={phone}
                placeholder="手机号"
                onInput={(e) => setPhone(e.detail.value)}
              />
            </View>
            <View className="field-row">
              <Input
                className="input"
                type="number"
                maxlength={4}
                value={suffix}
                placeholder="订单号后四位"
                onInput={(e) => setSuffix(e.detail.value)}
              />
            </View>
            <View className="btn-ghost" onClick={loadingHistory ? undefined : queryHistory}>
              {loadingHistory ? '查询中…' : '查询历史尺码'}
            </View>
            {history.map((m) => (
              <View
                key={m.id}
                style={{
                  marginTop: 16,
                  padding: 20,
                  background: '#fff',
                  borderRadius: 12,
                  border: '1px solid #eee',
                }}
                onClick={() => applyHistory(m)}
              >
                <View className="row">
                  <Text style={{ fontWeight: 600 }}>{m.code}</Text>
                  <Text className="muted">{m.name}</Text>
                </View>
                <View className="muted" style={{ marginTop: 8 }}>
                  身高 {m.data?.height || '-'} / 胸围 {m.data?.chest || '-'} / 腰围{' '}
                  {m.data?.waist || '-'}
                </View>
              </View>
            ))}
          </View>
        )}

        <Text className="label">姓名</Text>
        <Input
          className="input"
          value={name}
          placeholder="请输入姓名"
          onInput={(e) => setName(e.detail.value)}
        />

        <Text className="label">电话</Text>
        <Input
          className="input"
          type="number"
          maxlength={11}
          value={phone}
          placeholder="请输入手机号"
          onInput={(e) => setPhone(e.detail.value)}
        />

        <Text className="label">性别</Text>
        <Picker
          className="picker-block"
          style={{ display: 'block', width: '100%' }}
          mode="selector"
          range={['男', '女']}
          value={genderIndex < 0 ? 0 : genderIndex}
          onChange={(e) => setGender(['男', '女'][Number(e.detail.value)])}
        >
          <View className={gender ? 'picker-value' : 'picker-value placeholder'}>
            {gender || '请选择'}
          </View>
        </Picker>

        <Text className="label">面料 / 颜色 / 厚度</Text>
        <Input
          className="input"
          value={fabric}
          placeholder="如：黑色紧身衣 0.4"
          onInput={(e) => setFabric(e.detail.value)}
        />
      </View>

      {grouped.map((g: any) => (
        <View className="card" key={g.id}>
          <View className="card-title">{g.name}</View>
          {g.items.map((f: MeasureField) => (
            <View className="field-row" key={f.key}>
              <Text className="field-label">
                {f.label}
                {f.unit ? `(${f.unit})` : ''}
              </Text>
              {f.type === 'select' ? (
                <Picker
                  className="picker-block"
                  style={{ display: 'block', width: '100%' }}
                  mode="selector"
                  range={f.options || []}
                  onChange={(e) => setValue(f.key, (f.options || [])[Number(e.detail.value)])}
                >
                  <View className={data[f.key] ? 'picker-value' : 'picker-value placeholder'}>
                    {data[f.key] || '请选择'}
                  </View>
                </Picker>
              ) : (
                <Input
                  className="input"
                  type={f.type === 'number' ? 'digit' : 'text'}
                  value={data[f.key] || ''}
                  placeholder="选填"
                  onInput={(e) => setValue(f.key, e.detail.value)}
                />
              )}
            </View>
          ))}
        </View>
      ))}

      <View className="card">
        <View className="card-title">备注</View>
        <Input
          className="input"
          value={remark}
          placeholder="特殊要求可写在这里"
          onInput={(e) => setRemark(e.detail.value)}
        />
      </View>

      <View className="footer-bar">
        <View className="muted">保存后可继续选择定制项目</View>
        <View
          className={saving ? 'btn-primary btn-disabled' : 'btn-primary'}
          style={{ width: 240 }}
          onClick={saving ? undefined : save}
        >
          {saving ? '保存中…' : '保存并下单'}
        </View>
      </View>
    </View>
  )
}
