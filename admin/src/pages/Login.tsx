import { useState } from 'react'
import { Button, Form, Input, App } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useAuth } from '../auth'
import { useNavigate } from 'react-router-dom'
import EffectLayer from '../components/effects/EffectLayer'
import { RECOMMENDED } from '../components/effects/effectSettings'

const ART_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2B361F"/>
      <stop offset="0.45" stop-color="#677D45"/>
      <stop offset="0.78" stop-color="#AEBA78"/>
      <stop offset="1" stop-color="#E5E1BD"/>
    </linearGradient>
    <radialGradient id="g2" cx="0.4" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#E5E1BD"/>
      <stop offset="0.55" stop-color="#AEBA78"/>
      <stop offset="1" stop-color="#2B361F"/>
    </radialGradient>
  </defs>
  <rect width="720" height="720" fill="#F8FAF2"/>
  <g transform="translate(360 350)">
    <ellipse cx="0" cy="-40" rx="150" ry="280" fill="url(#g1)" transform="rotate(-20)" opacity="0.96"/>
    <ellipse cx="-82" cy="58" rx="112" ry="242" fill="url(#g2)" transform="rotate(-58)" opacity="0.82"/>
    <ellipse cx="92" cy="38" rx="122" ry="252" fill="url(#g1)" transform="rotate(32)" opacity="0.76"/>
    <ellipse cx="8" cy="140" rx="96" ry="202" fill="url(#g2)" transform="rotate(8)" opacity="0.72"/>
    <path d="M0 302 C-30 180 -20 40 0 -152" stroke="#2B361F" stroke-width="12" fill="none" opacity="0.5"/>
    <g fill="#677D45" opacity="0.5">
      <circle cx="-140" cy="-190" r="16"/><circle cx="128" cy="-150" r="12"/>
      <circle cx="-118" cy="168" r="14"/><circle cx="146" cy="196" r="18"/>
      <circle cx="20" cy="-260" r="10"/><circle cx="-40" cy="248" r="12"/>
    </g>
  </g>
</svg>`
const ART_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ART_SVG)}`
const ART_SETTINGS = RECOMMENDED.ascii

export default function Login() {
  const { login } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.username.trim(), values.password)
      navigate('/orders', { replace: true })
    } catch (e: any) {
      message.error(e?.message || '登录失败，请检查账号密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <section className="login-art-pane">
          <div className="login-art-frame">
            <EffectLayer settings={ART_SETTINGS} radius={14} animated>
              <img src={ART_SRC} alt="ASCII artwork" className="login-art-img" />
            </EffectLayer>
            <div className="login-art-caption">
              Your browser,
              <br />
              <em>at command.</em>
            </div>
          </div>
        </section>

        <section className="login-form-pane">
          <div className="login-form-inner">
            <h1 className="login-title">
              Welcome back <span className="login-badge">✦</span>
            </h1>
            <p className="login-subtitle">登录定制订单管理系统，继续处理您的订单。</p>
            <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
              <Form.Item label="账号" name="username" rules={[{ required: true, message: '请输入账号' }]}>
                <Input
                  prefix={<UserOutlined />}
                  placeholder="账号 / 手机号"
                  size="large"
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="密码"
                  size="large"
                  autoComplete="current-password"
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={loading} className="login-submit">
                Sign in
              </Button>
            </Form>
          </div>
        </section>
      </div>
    </div>
  )
}
