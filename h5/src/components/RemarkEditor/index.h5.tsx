import { useEffect, useRef, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import Quill from 'quill'
import { pb, errorText } from '../../api/pb'
import { isEmptyHtml, plainRemarkHtml, plainText, type RemarkEditorProps } from './types'

/**
 * H5 端：备注只有文字和图片。
 *
 * 页面上先放一个「假输入框」，点开才挂载 Quill（多行、粘贴过滤、撤销、输入法都由它兜住）。
 * formats 只放行 image：加粗/字号/颜色即使粘进来也不会解析，所见即所存。
 */
const PLACEHOLDER = '特殊要求可写在这里，可加图片'

export default function RemarkEditor({ value, onChange }: RemarkEditorProps) {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)
  const editor = useRef<Quill | null>(null)
  // 打开时的原文，取消时回滚用
  const opened = useRef(value)
  const change = useRef(onChange)
  change.current = onChange

  const openRemark = () => {
    opened.current = value
    setOpen(true)
  }

  // 打字时已经实时回传了，取消要把原文写回去
  const cancelRemark = () => {
    change.current(opened.current)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const el = host.current
    if (!el) return
    const q = new Quill(el, { placeholder: PLACEHOLDER, formats: ['image'] })
    editor.current = q

    const onText = () => {
      const html = plainRemarkHtml(q.getSemanticHTML())
      change.current(isEmptyHtml(html) ? '' : html)
    }
    q.on('text-change', onText)
    // 回填已有内容：加粗/字号这类格式会被白名单丢掉，只留文字和图片
    if (value) q.clipboard.dangerouslyPasteHTML(value)

    return () => {
      q.off('text-change', onText)
      editor.current = null
      el.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pickImage = () => {
    Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
      .then(async (res: any) => {
        const tf: any = res?.tempFiles?.[0]
        let file: Blob | null = tf?.originalFileObj || null
        if (!file) {
          // 个别浏览器只给 blob url，不给原始 File，自己取回来
          const path = tf?.path || res?.tempFilePaths?.[0]
          if (path) {
            const blob = await (await fetch(path)).blob()
            file = new File([blob], 'remark.jpg', { type: blob.type })
          }
        }
        if (!file) return Taro.showToast({ title: '读取图片失败', icon: 'none' })
        Taro.showLoading({ title: '上传中…' })
        try {
          const fd = new FormData()
          fd.append('file', file)
          const rec = await pb.collection('remark_images').create<any>(fd)
          const url = pb.files.getURL(rec, rec.file)
          Taro.hideLoading()
          const q = editor.current
          if (!q) return
          // 焦点回到编辑器后再取选区，不然拿不到光标位置
          const range = q.getSelection(true)
          const index = range ? range.index : q.getLength()
          q.insertEmbed(index, 'image', url, 'user')
          q.setSelection(index + 1, 0, 'user')
        } catch (e: any) {
          Taro.hideLoading()
          Taro.showToast({ title: errorText(e, '图片上传失败'), icon: 'none' })
        }
      })
      .catch(() => {})
  }

  const preview = plainText(value)

  return (
    <View className="rt">
      <View className="rt-field" onClick={openRemark}>
        {preview ? preview : <Text className="rt-ph">特殊要求可写在这里，可加图片</Text>}
      </View>

      {open ? (
        <View className="rt-mask">
          <View className="rt-panel">
            <View className="rt-panel-hd">
              <Text className="rt-panel-title">备注</Text>
              <View className="rt-ops">
                <View className="rt-img" onClick={pickImage}>
                  ＋ 图片
                </View>
                <View className="rt-cancel" onClick={cancelRemark}>
                  取消
                </View>
                <View className="rt-done" onClick={() => setOpen(false)}>
                  完成
                </View>
              </View>
            </View>
            <div className="rt-editor" ref={host} />
          </View>
        </View>
      ) : null}
    </View>
  )
}
