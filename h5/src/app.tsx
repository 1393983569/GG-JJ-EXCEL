import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { rememberAgent } from './api/agent'
import './app.scss'

// 代理专属链接形如 /#/pages/index/index?agent=13800000000，
// 落地时先把标识存下来，之后注册/登录/下单都用得上。
function App({ children }: PropsWithChildren) {
  useLaunch(() => {
    // 路由初始化可能会改写地址栏，所以先抓一次，下个事件循环再补一次
    rememberAgent()
    setTimeout(() => rememberAgent(), 0)
  })

  return children
}

export default App
