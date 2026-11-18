/**
 * 备注只支持「文字 + 图片」：多行纯文字，外加若干张图。
 *
 * 小程序没有 DOM，Web 编辑器跑不起来；Taro 的 Editor 组件又只有小程序端实现。
 * 所以组件按端分文件，这里只放两端共用的 props 和内容整理函数。
 */
export type RemarkEditorProps = { value: string; onChange: (html: string) => void }

/** 只有空白内容时回传空串，别让 <p><br></p> 把「备注」误判成已填写 */
export const isEmptyHtml = (html: string) => {
  const text = String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return !text && !/<img\b/i.test(html)
}

/** 收起状态下的预览文字：段落转换行，标签去掉，有图就补个标记 */
export const plainText = (html: string) => {
  const text = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return /<img\b/i.test(html) ? (text ? text + '\n[图片]' : '[图片]') : text
}

/**
 * 只保留段落、换行和图片，其它标签/属性一律去掉。
 * 编辑器和粘贴都可能带回来加粗、字号、颜色、链接，入库前统一压平，
 * 这样备注字段永远是「文字 + 图片」。
 */
export const plainRemarkHtml = (html: string) =>
  String(html || '')
    // 白名单外的标签整段去掉，里面的文字保留
    .replace(/<(?!\/?(?:p|div|br|img)\b)[^>]*>/gi, '')
    // 允许的标签也不留属性；img 只留 src
    .replace(/<(p|div|br)\b[^>]*>/gi, '<$1>')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = (tag.match(/\bsrc="([^"]+)"/i) || [])[1]
      return src ? '<img src="' + src + '">' : ''
    })
