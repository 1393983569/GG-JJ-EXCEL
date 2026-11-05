import { PropsWithChildren } from 'react'
import Taro, { useLaunch } from '@tarojs/taro'
import './app.scss'

// 代理专属链接形如 /#/pages/index/index?agent=13800000000，
// 落地时把代理标识存下来，后面注册/登录/下单都用得上
function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    try {
      const query = Taro.getLaunchOptionsSync().query || {}
      let agent = String(query.agent || '').trim()
      // H5 的 agent 参数落在 hash 路由里（/#/pages/index/index?agent=xxx），
      // launch query 不一定带出来，兜底直接读 URL
      if (!agent && typeof window !== 'undefined') {
        const m = /[?&]agent=([^&#]*)/.exec(window.location.search + window.location.hash)
        if (m) agent = decodeURIComponent(m[1]).trim()
      }
      // 与 pages/order 里读取的 key 保持一致
      if (agent) Taro.setStorageSync('agent_code', agent)
    } catch (e) {}
  })

  return children
}

export default App
