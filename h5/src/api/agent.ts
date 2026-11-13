import Taro from '@tarojs/taro'

// 代理专属链接形如 /#/pages/index/index?agent=xxx。
// 只在首屏 useLaunch 里抓一次不够稳：Taro 的 hash 路由初始化时会改写地址栏，
// 用户直接落在登录页、刷新、从历史记录回来都可能错过那一次。
// 所以这里做成「随时可抓 + 只增不减」，并支持把标识继续带在跳转链接上。
const KEY = 'agent_code'
// src/index.html 里的内联脚本会在框架启动前写这个原始 key，
// 因为 Taro 的 hash 路由会把地址栏改写掉，晚一步就抓不到了
const RAW_KEY = 'agent_code_raw'

function fromRaw(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return String(localStorage.getItem(RAW_KEY) || '').trim()
  } catch (e) {
    return ''
  }
}

function fromLocation(): string {
  try {
    if (typeof window === 'undefined') return ''
    const m = /[?&]agent=([^&#]*)/.exec(window.location.search + window.location.hash)
    return m ? decodeURIComponent(m[1]).trim() : ''
  } catch (e) {
    return ''
  }
}

function fromRouter(): string {
  try {
    const params: any = Taro.getCurrentInstance()?.router?.params || {}
    return String(params.agent || '').trim()
  } catch (e) {
    return ''
  }
}

function fromLaunch(): string {
  try {
    const query: any = Taro.getLaunchOptionsSync().query || {}
    return String(query.agent || '').trim()
  } catch (e) {
    return ''
  }
}

/**
 * 记下代理标识，返回当前生效的值。
 * 优先级：显式传入 > 当前路由参数 > 地址栏 > 首屏落盘的值 > 启动参数 > 上次存下的。
 * 拿不到新值时保留旧值，避免跳一次页面就把订单归属丢掉。
 */
export function rememberAgent(explicit?: string): string {
  // 地址栏优先于缓存：客户换了代理的链接进单，要以新链接为准
  const code =
    String(explicit || '').trim() || fromRouter() || fromLocation() || fromRaw() || fromLaunch()
  if (code) {
    try {
      Taro.setStorageSync(KEY, code)
    } catch (e) {}
  }
  return code || getAgentCode()
}

export function getAgentCode(): string {
  try {
    const v = String(Taro.getStorageSync(KEY) || '').trim()
    if (v) return v
  } catch (e) {}
  return fromRaw()
}

/** 只在服务端明确判定链接失效时清除，别在跳页时顺手清 */
export function clearAgentCode() {
  try {
    Taro.removeStorageSync(KEY)
  } catch (e) {}
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(RAW_KEY)
  } catch (e) {}
}

/** 给站内跳转补上 agent，刷新、后退、转发链接都不会丢归属 */
export function withAgent(url: string): string {
  const code = getAgentCode()
  if (!code) return url
  const sep = url.indexOf('?') >= 0 ? '&' : '?'
  return url + sep + 'agent=' + encodeURIComponent(code)
}
