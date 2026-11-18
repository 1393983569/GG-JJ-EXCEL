import { useEffect, useMemo, useState } from 'react'
import { View, Input, Picker, Text } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import {
  pb,
  type Catalog,
  type MeasureField,
  type MeasureGroup,
  type Measurement,
} from '../../api/pb'
import { withAgent } from '../../api/agent'
import RemarkEditor from '../../components/RemarkEditor'

export default function Measure() {
  const router = useRouter()
  // 从下单页带过来：只填这个品类要量的尺寸（不带就还是全量字典）
  const catalog = String(router.params.catalog || '')
  // 带 edit 就是查看/修改已有档案，不是新建
  const editId = String(router.params.edit || '')
  const [original, setOriginal] = useState<Measurement | null>(null)
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
    if (editId) loadEdit()
  }, [])

  const loadEdit = async () => {
    try {
      const m = await pb.collection('measurements').getOne<Measurement>(editId)
      const user: any = pb.authStore.record
      setOriginal(m)
      setName(m.name || user?.display_name || '')
      setPhone(m.phone || user?.phone || user?.username || '')
      setGender(m.gender || '')
      setFabric(m.fabric || '')
      setRemark(m.remark || '')
      const next: Record<string, string> = {}
      Object.keys(m.data || {}).forEach((k) => {
        const v = m.data[k]
        next[k] = v === null || v === undefined ? '' : String(v)
      })
      setData(next)
      Taro.setNavigationBarTitle({ title: '查看 / 修改尺寸' })
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '加载档案失败', icon: 'none' })
    }
  }

  const loadFields = async () => {
    try {
      const [fs, gs, cs] = await Promise.all([
        pb.collection('measure_fields').getFullList<MeasureField>({ sort: 'sort' }),
        pb.collection('measure_field_groups').getFullList<MeasureGroup>({ sort: 'sort' }),
        pb
          .collection('catalogs')
          .getFullList<Catalog>({ sort: 'sort' })
          .catch(() => [] as Catalog[]),
      ])
      let list = fs.filter((f) => f.is_active !== false)
      if (catalog) {
        // 品类就是这单的打版方案：要量什么、先量什么、哪些必填，都听品类的
        const cat = cs.find((c) => c.name === catalog)
        const bind = (cat && cat.fields) || []
        const byKey: Record<string, MeasureField> = {}
        list.forEach((f) => {
          byKey[f.key] = f
        })
        list = bind
          .filter((b) => byKey[b.key])
          .map((b) => ({ ...byKey[b.key], required: !!b.required }))
      }
      setFields(list)
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
    // 品类标了必填的尺寸不能空着，否则下单时还得回来补
    const lack = fields.filter((f) => f.required && !String(data[f.key] ?? '').trim())
    if (lack.length) {
      Taro.showToast({ title: '请填写：' + lack.map((f) => f.label).join('、'), icon: 'none' })
      return
    }
    if (editId && !original) {
      Taro.showToast({ title: '档案加载中', icon: 'none' })
      return
    }
    const values: Record<string, any> = {}
    Object.keys(data).forEach((k) => {
      const v = data[k]
      const f = fields.find((x) => x.key === k)
      values[k] = v === '' || v === undefined ? '' : f && f.type === 'number' ? Number(v) : v
    })

    setSaving(true)
    try {
      if (editId) {
        // 合并而不是整体替换：留着已经停用/不在字典里的旧 key
        const merged: Record<string, any> = { ...(original?.data || {}) }
        Object.keys(values).forEach((k) => {
          if (values[k] === '') delete merged[k]
          else merged[k] = values[k]
        })
        await pb.collection('measurements').update(editId, {
          name: name.trim(),
          phone,
          gender,
          data: merged,
          fabric,
          remark,
        })
        Taro.showToast({ title: '修改成功', icon: 'success' })
      } else {
        const payload: Record<string, any> = {}
        Object.keys(values).forEach((k) => {
          if (values[k] !== '') payload[k] = values[k]
        })
        if (gender) payload.gender = gender
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
          const back = catalog
            ? `/pages/order/index?measurement=${rec.id}&catalog=${encodeURIComponent(catalog)}`
            : `/pages/order/index?measurement=${rec.id}`
          Taro.navigateTo({ url: withAgent(back) })
        }, 600)
        return
      }
      setTimeout(() => Taro.navigateBack(), 600)
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
          {!editId && (
            <View
              style={{ color: '#1677ff', fontSize: 26 }}
              onClick={() => setHistoryOpen(!historyOpen)}
            >
              {historyOpen ? '收起' : '用历史尺码'}
            </View>
          )}
        </View>

        {!editId && historyOpen && (
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

      {catalog && fields.length === 0 && (
        <View className="card">
          <View className="muted">「{catalog}」不用量尺寸，填好基本信息直接保存就行</View>
        </View>
      )}

      {grouped.map((g: any) => (
        <View className="card" key={g.id}>
          <View className="card-title">{g.name}</View>
          {g.items.map((f: MeasureField) => (
            <View className="field-row" key={f.key}>
              <Text className="field-label">
                {f.label}
                {f.unit ? `(${f.unit})` : ''}
                {f.required ? ' *' : ''}
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
                  placeholder={f.required ? '必填' : '选填'}
                  onInput={(e) => setValue(f.key, e.detail.value)}
                />
              )}
            </View>
          ))}
        </View>
      ))}

      <View className="card">
        <View className="card-title">备注</View>
        <RemarkEditor value={remark} onChange={setRemark} />
      </View>

      <View className="footer-bar">
        <View className="muted">
          {editId ? '修改后返回下单页继续选择定制项目' : '保存后可继续选择定制项目'}
        </View>
        <View
          className={saving ? 'btn-primary btn-disabled' : 'btn-primary'}
          style={{ width: 240 }}
          onClick={saving ? undefined : save}
        >
          {saving ? '保存中…' : editId ? '保存修改' : '保存并下单'}
        </View>
      </View>
    </View>
  )
}
