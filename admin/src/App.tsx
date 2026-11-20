import { Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from './auth'
import AppLayout from './AppLayout'
import Login from './pages/Login'
import OrderList from './pages/OrderList'
import OrderDetail from './pages/OrderDetail'
import MeasurementList from './pages/MeasurementList'
import PatternSimilarity from './pages/PatternSimilarity'
import ItemList from './pages/ItemList'
import ShopSettings from './pages/ShopSettings'
import MeasureFieldList from './pages/MeasureFieldList'
import RoleList from './pages/RoleList'
import UserList from './pages/UserList'

export default function App() {
  const { user, ready, hasMenu } = useAuth()
  // 角色权限、后台账号只给超级管理员（role_code = admin）
  const roleCode = (user as any)?.role_code
  const isAdmin = roleCode === 'admin'

  if (!ready) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/orders" replace /> : <Login />} />
      <Route
        element={
          user ? (
            <AppLayout />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrderList />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/measurements" element={<MeasurementList />} />
        {/* 版型相似度含满意度，工厂/客户不可见 */}
        <Route
          path="/pattern-similarity"
          element={
            isAdmin || roleCode === 'reviewer' || hasMenu('pattern_similarity') ? (
              <PatternSimilarity />
            ) : (
              <Navigate to="/orders" replace />
            )
          }
        />
        {/* 字典只给内部；代理的项目配置在「我的店铺」 */}
        <Route
          path="/items"
          element={
            isAdmin || (user as any)?.role_code === 'reviewer' ? <ItemList /> : <Navigate to="/shop" replace />
          }
        />
        <Route path="/shop" element={<ShopSettings />} />
        <Route path="/measure-fields" element={<MeasureFieldList />} />
        <Route path="/roles" element={isAdmin ? <RoleList /> : <Navigate to="/orders" replace />} />
        <Route path="/users" element={isAdmin ? <UserList /> : <Navigate to="/orders" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/orders" replace />} />
    </Routes>
  )
}
