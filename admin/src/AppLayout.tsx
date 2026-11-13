import { Layout, Menu, Dropdown, Avatar, Space, Tag, Typography } from 'antd'
import {
  ShoppingCartOutlined,
  ProfileOutlined,
  TagsOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  AppstoreOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth'

const { Sider, Header, Content } = Layout

// H5 的访问地址，部署时用 VITE_H5_URL 覆盖
const H5_URL = ((import.meta.env.VITE_H5_URL as string) || 'http://localhost:10087').replace(/\/+$/, '')

const MENUS = [
  { key: '/orders', code: 'orders', label: '订单管理', icon: <ShoppingCartOutlined /> },
  { key: '/measurements', code: 'measurements', label: '量体档案', icon: <ProfileOutlined /> },
  { key: '/items', code: 'items', label: '定制项目', icon: <TagsOutlined /> },
  // 代理看到的是「我的店铺」，内部看到的是「总部店铺」，同一个页面
  { key: '/shop', code: 'shop', label: '我的店铺', icon: <ShopOutlined /> },
  { key: '/measure-fields', code: 'measure_fields', label: '量体字段', icon: <SettingOutlined /> },
  // 下面两个只给超级管理员，不受 menus 配置影响
  { key: '/roles', code: 'roles', label: '角色权限', icon: <TeamOutlined />, adminOnly: true },
  { key: '/users', code: 'users', label: '后台账号', icon: <UserOutlined />, adminOnly: true },
]

export default function AppLayout() {
  const { user, hasMenu, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const isAdmin = (user as any)?.role_code === 'admin'
  // 代理专属链接：用记录 id，不放账号/手机号（服务端只认 id）
  const isAgent = (user as any)?.role_code === 'agent'
  const agentLink = `${H5_URL}/#/pages/index/index?agent=${encodeURIComponent(user?.id || '')}`
  const items = MENUS.filter((m) => (m.adminOnly ? isAdmin : hasMenu(m.code))).map((m) => ({
    key: m.key,
    icon: m.icon,
    // 同一个页面：代理是「我的店铺」，内部是「总部店铺」
    label: m.code === 'shop' && !isAgent ? '总部店铺' : m.label,
  }))

  const selected = MENUS.find((m) => location.pathname.startsWith(m.key))?.key || '/orders'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={200} breakpoint="lg" collapsedWidth={64}>
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 16,
            color: '#1677ff',
            gap: 8,
          }}
        >
          <AppstoreOutlined /> 定制管理
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={items}
          onClick={(e) => navigate(e.key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            height: 56,
            lineHeight: '56px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          <Space size="middle">
            {isAgent && (
              <Space size={4}>
                <Tag color="blue">专属链接</Tag>
                <Typography.Text copyable={{ text: agentLink }} style={{ fontSize: 12, maxWidth: 260 }} ellipsis>
                  {agentLink}
                </Typography.Text>
              </Space>
            )}
            {user?.can_view_all_prices && <Tag color="gold">全部价格可见</Tag>}
            <Dropdown
              menu={{
                items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录' }],
                onClick: ({ key }) => {
                  if (key === 'logout') {
                    logout()
                    navigate('/login')
                  }
                },
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} />
                {user?.display_name || user?.username}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
