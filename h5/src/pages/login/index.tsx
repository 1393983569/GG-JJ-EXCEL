import { useState } from 'react'
import { View, Input, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { pb } from '../../api/pb'

// 服务端返回的字段级错误用字段 key 做前缀，客户看不懂，这里换成中文
const FIELD_LABELS: Record<string, string> = {
  username: '手机号',
  email: '邮箱',
  phone: '手机号',
  password: '密码',
  passwordConfirm: '确认密码',
  display_name: '称呼',
}

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!/^1\d{10}$/.test(phone)) {
      Taro.showToast({ title: '请输入 11 位手机号', icon: 'none' })
      return
    }
    if (password.length < 8) {
      Taro.showToast({ title: '密码至少 8 位', icon: 'none' })
      return
    }
    setLoading(true)
    try {
      if (mode === 'register') {
        await pb.collection('customers').create({
          username: phone,
          // email 在 PocketBase 里有唯一索引，留空会让第二个用户唯一约束冲突，
          // 这里用手机号生成一个占位邮箱（登录仍走 username）
          email: phone + '@no-email.local',
          password,
          passwordConfirm: password,
          phone,
          display_name: name || phone,
        })
      }
      await pb.collection('customers').authWithPassword(phone, password)
      Taro.showToast({ title: mode === 'register' ? '注册成功' : '登录成功', icon: 'success' })
      setTimeout(() => {
        const pages = Taro.getCurrentPages()
        if (pages.length > 1) Taro.navigateBack()
        else Taro.redirectTo({ url: '/pages/index/index' })
      }, 600)
    } catch (e: any) {
      // PocketBase 的字段级错误在 response.data 里，展开给用户看
      let msg = e?.message || '操作失败'
      const data = e?.response?.data || e?.data
      if (data && typeof data === 'object') {
        const first = Object.keys(data)[0]
        if (first && data[first] && data[first].message) {
          msg = (FIELD_LABELS[first] || first) + ': ' + data[first].message
        }
      }
      if (String(msg).indexOf('Failed to create record') >= 0) {
        msg = '注册失败：' + JSON.stringify(data || {})
      }
      Taro.showToast({ title: msg, icon: 'none', duration: 4000 })
      console.error('[register/login]', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className="container">
      <View className="card">
        <View className="card-title">{mode === 'login' ? '登录' : '注册'}</View>

        <Text className="label">手机号</Text>
        <Input
          className="input"
          type="number"
          maxlength={11}
          value={phone}
          placeholder="请输入手机号"
          onInput={(e) => setPhone(e.detail.value)}
        />

        {mode === 'register' && (
          <>
            <Text className="label">称呼（可选）</Text>
            <Input
              className="input"
              value={name}
              placeholder="如：张先生"
              onInput={(e) => setName(e.detail.value)}
            />
          </>
        )}

        <Text className="label">密码</Text>
        <Input
          className="input"
          password
          value={password}
          placeholder="至少 8 位"
          onInput={(e) => setPassword(e.detail.value)}
        />

        <View
          className={loading ? 'btn-primary btn-disabled' : 'btn-primary'}
          onClick={loading ? undefined : submit}
        >
          {loading ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
        </View>

        <View
          style={{ textAlign: 'center', marginTop: 28, color: '#1677ff', fontSize: 26 }}
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </View>
      </View>
    </View>
  )
}
