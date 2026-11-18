import { useMemo, useRef, useState } from 'react'
import { View, Text, Editor } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { PB_URL, pb, errorText } from '../../api/pb'
import { isEmptyHtml, plainRemarkHtml, plainText, type RemarkEditorProps } from './types'

/**
 * 小程序端：微信原生 editor 组件（Taro 的 Editor 只在 weapp/jd/ascf 有实现）。
 *
 * 页面上先放一个「假输入框」，点开在弹层里挂载 editor —— 原生组件在小区域里
 * 又小又难用，弹层里才有足够的编辑空间。回传的 html 同样压平成文字 + 图片。
 */
const PLACEHOLDER = '特殊要求可写在这里，可加图片'

let uid = 0

export default function RemarkEditor({ value, onChange }: RemarkEditorProps) {
  const [open, setOpen] = useState(false)
  const id = useMemo(() => 'rt-editor-' + ++uid, [])
  const ctx = useRef<any>(null)
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

  const onReady = () => {
    Taro.createSelectorQuery()
      .select('#' + id)
      .context((res: any) => {
        ctx.current = res?.context || null
        // setContents 只能在 ready 之后调，否则原生侧还没建好
        if (ctx.current && value) ctx.current.setContents({ html: value })
      })
      .exec()
  }

  const onInput = (e: any) => {
    const html = plainRemarkHtml(String(e?.detail?.html || ''))
    change.current(isEmptyHtml(html) ? '' : html)
  }

  const pickImage = () => {
    Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
      .then(async (res: any) => {
        const path = res?.tempFilePaths?.[0]
        if (!path) return
        Taro.showLoading({ title: '上传中…' })
        try {
          // 小程序没有 FormData，走 Taro.uploadFile 直传 PocketBase 的 multipart 接口
          const up: any = await Taro.uploadFile({
            url: PB_URL + '/api/collections/remark_images/records',
            filePath: path,
            name: 'file',
            header: pb.authStore.token ? { Authorization: pb.authStore.token } : {},
          })
          const rec = JSON.parse(up?.data || '{}')
          if (up?.statusCode !== 200 || !rec.id) throw new Error(rec?.message || '上传失败')
          Taro.hideLoading()
          ctx.current?.insertImage({
            src: PB_URL + '/api/files/remark_images/' + rec.id + '/' + rec.file,
          })
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
            <Editor
              id={id}
              className="rt-editor rt-editor-mp"
              placeholder={PLACEHOLDER}
              onReady={onReady}
              onInput={onInput}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}
