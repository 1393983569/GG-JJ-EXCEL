import { Card } from 'antd'
import { useAuth } from '../auth'
import ShopConfigTable from '../components/ShopConfigTable'

/**
 * 店铺配置：总部（虚拟代理）和代理共用一套表。
 * 总部不占账号：配置写 items 上的默认值；代理写自己账号的 staff_item_settings。
 */
export default function ShopSettings() {
  const { user } = useAuth()
  const role = (user as any)?.role_code || ''
  const isAgent = role === 'agent'
  const canConfig = role === 'admin' || role === 'reviewer'

  if (!isAgent && !canConfig) {
    return <Card className="page-card">当前账号没有店铺配置权限</Card>
  }

  return (
    <ShopConfigTable
      staffId={isAgent ? user?.id : undefined}
      roleCode={role}
      showCost={isAgent}
      costEditable={false}
      title={isAgent ? '我的店铺' : '总部店铺'}
    />
  )
}
