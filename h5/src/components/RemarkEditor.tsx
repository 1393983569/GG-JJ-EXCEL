import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { pb, errorText } from '../api/pb'

/**
 * 备注富文本：多行文字 + 加粗 + 字号 + 颜色 + 图片，就这五件事。
 *
 * 用 contenteditable + document.execCommand 实现，不引任何编辑器依赖。
 * execCommand 虽然被标记为废弃，但移动端浏览器全支持，且是这里最省事的做法。
 * 产出的是很短的 HTML（<b>/<font>/<img>），入库前由服务端按白名单过滤。
 */
const COLORS = ['#222222', '#cf1322', '#1677ff', '#52c41a']
// <font size> 是相对浏览器默认字号（16px）的档位：2≈13px、4≈18px、5≈24px
// 编辑器基准字号必须是 16px，否则 queryCommandValue('fontSize') 会按比例算出别的档位
const SIZES = [
  { label: '小', value: '2' },
  { label: '中', value: '4' },
  { label: '大', value: '5' },
]

type Props = { value: string; onChange: (html: string) => void }

// queryCommandValue('foreColor') 返回的是 rgb(...)，跟色块比较要先换算
const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'
}

let uid = 0

export default function RemarkEditor({ value, onChange }: Props) {
  // Taro 的 View 拿不到 DOM ref，用唯一 className 定位宿主节点
  const hostClass = useMemo(() => 'rt-host-' + ++uid, [])
  const box = useRef<HTMLDivElement | null>(null)
  const range = useRef<Range | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  // 光标所在位置的格式，用来给工具栏做选中标识
  const [fmt, setFmt] = useState({ bold: false, size: '', color: '' })

  // 空内容回传空串，别让 <br> 之类的空标签把「备注」误判成已填写
  const sync = () => {
    const el = box.current
    if (!el) return
    const filled = !!(el.textContent || '').trim() || !!el.querySelector('img')
    change.current(filled ? el.innerHTML : '')
  }

  // 光标在哪，工具栏就显示哪的格式，不然看不出当前状态
  const readFmt = () => {
    const el = box.current
    const sel = window.getSelection()
    if (!el || !sel || !sel.rangeCount) return
    if (!el.contains(sel.getRangeAt(0).commonAncestorContainer)) return
    let next = { bold: false, size: '', color: '' }
    try {
      next = {
        bold: document.queryCommandState('bold'),
        size: String(document.queryCommandValue('fontSize') || ''),
        color: String(document.queryCommandValue('foreColor') || ''),
      }
    } catch (e) {
      return
    }
    setFmt((prev) =>
      prev.bold === next.bold && prev.size === next.size && prev.color === next.color ? prev : next
    )
  }

  const remember = () => {
    const el = box.current
    const sel = window.getSelection()
    if (!el || !sel || !sel.rangeCount) return
    const r = sel.getRangeAt(0)
    if (el.contains(r.commonAncestorContainer)) range.current = r.cloneRange()
  }

  const onSelectionChange = () => {
    remember()
    readFmt()
  }

  // 点工具栏会抢焦点，执行命令前把选区恢复回去。
  // 选区还在编辑器里时千万不要恢复旧 range：格式命令会拆分文本节点，
  // 旧的 range 会失效并塌缩到段落开头，用户选中的字就丢了。
  const focusEditor = () => {
    const el = box.current
    if (!el) return
    const sel = window.getSelection()
    const live = !!sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)
    el.focus()
    if (live || !sel || !range.current) return
    sel.removeAllRanges()
    sel.addRange(range.current)
  }

  const exec = (cmd: string, val?: string) => {
    if (!box.current) return
    focusEditor()
    document.execCommand('styleWithCSS', false, 'false')
    // 同一个按钮再点一次就是取消：字号/颜色回到默认值（加粗 execCommand 自己会切换）
    if (cmd === 'fontSize' && fmt.size === val) val = '3'
    if (cmd === 'foreColor' && val && fmt.color === toRgb(val)) val = COLORS[0]
    document.execCommand(cmd, false, val)
    remember()
    sync()
    readFmt()
  }

  // 粘贴一律按纯文本处理，外部网页的样式/标签不进来
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : ''
    if (!text) return
    if (!document.execCommand('insertText', false, text)) {
      document.execCommand(
        'insertHTML',
        false,
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
      )
    }
    sync()
  }

  useEffect(() => {
    let el: HTMLDivElement | null = null
    let frame = 0
    let tries = 0

    const mount = () => {
      const host = document.querySelector('.' + hostClass) as HTMLElement | null
      if (!host) {
        // 自定义元素偶尔比 effect 慢一拍，等几帧再挂
        if (tries++ < 20) frame = requestAnimationFrame(mount)
        return
      }
      el = document.createElement('div')
      el.className = 'rt-input'
      el.contentEditable = 'true'
      el.innerHTML = value || ''
      el.addEventListener('input', sync)
      el.addEventListener('paste', onPaste)
      el.addEventListener('keyup', remember)
      el.addEventListener('mouseup', remember)
      el.addEventListener('touchend', remember)
      host.appendChild(el)
      box.current = el
      document.addEventListener('selectionchange', onSelectionChange)
    }
    mount()

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', onSelectionChange)
      if (!el) return
      el.removeEventListener('input', sync)
      el.removeEventListener('paste', onPaste)
      el.removeEventListener('keyup', remember)
      el.removeEventListener('mouseup', remember)
      el.removeEventListener('touchend', remember)
      if (el.parentNode) el.parentNode.removeChild(el)
      box.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickImage = () => {
    remember()
    Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
      .then(async (res: any) => {
        const file = res?.tempFiles?.[0]?.originalFileObj
        if (!file) return Taro.showToast({ title: '读取图片失败', icon: 'none' })
        Taro.showLoading({ title: '上传中…' })
        try {
          const fd = new FormData()
          fd.append('file', file)
          const rec = await pb.collection('remark_images').create<any>(fd)
          const url = pb.files.getURL(rec, rec.file)
          focusEditor()
          document.execCommand('insertHTML', false, '<img src="' + url + '" />')
          sync()
          Taro.hideLoading()
        } catch (e: any) {
          Taro.hideLoading()
          Taro.showToast({ title: errorText(e, '图片上传失败'), icon: 'none' })
        }
      })
      .catch(() => {})
  }

  return (
    <View className="rt">
      <View className="rt-bar">
        <View
          className={'rt-btn rt-btn-bold' + (fmt.bold ? ' rt-on' : '')}
          onClick={() => exec('bold')}
        >
          B
        </View>
        {SIZES.map((s) => (
          <View
            className={'rt-btn' + (fmt.size === s.value ? ' rt-on' : '')}
            key={s.value}
            onClick={() => exec('fontSize', s.value)}
          >
            {s.label}
          </View>
        ))}
        {COLORS.map((c) => (
          <View
            className={'rt-swatch' + (fmt.color === toRgb(c) ? ' rt-on' : '')}
            key={c}
            style={{ background: c }}
            onClick={() => exec('foreColor', c)}
          />
        ))}
        <View className="rt-btn" onClick={pickImage}>
          ＋图
        </View>
      </View>
      <View className="rt-box">
        <View className={hostClass} />
        {value ? null : <Text className="rt-ph">特殊要求可写在这里，可加图片</Text>}
      </View>
    </View>
  )
}
