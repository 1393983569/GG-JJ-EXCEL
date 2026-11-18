import { useEffect, useState } from 'react'
import { App, Input, Modal } from 'antd'

/** 默认固定文字，不需要存后端 */
const DEFAULT_FIXED_TEXT = '盒子包装 薄款圆形加固片加固 裆部额外圆片加固打油发货'

type Props = {
  open: boolean
  orderIds: string[]
  onClose: () => void
}

export default function ExportWordModal({ open, orderIds, onClose }: Props) {
  const { message } = App.useApp()
  const [fixedText, setFixedText] = useState(DEFAULT_FIXED_TEXT)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setFixedText(DEFAULT_FIXED_TEXT)
  }, [open])

  const handleOk = async () => {
    if (!orderIds.length) return
    setLoading(true)
    try {
      const { exportOrdersToWord } = await import('../exportWord')
      await exportOrdersToWord(orderIds, fixedText)
      message.success(`已导出 ${orderIds.length} 张订单`)
      onClose()
    } catch (e: any) {
      message.error(e?.message || '导出失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="导出 Word"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="导出"
      cancelText="取消"
      confirmLoading={loading}
      width={560}
    >
      <div style={{ marginBottom: 8 }}>固定文字（可配置）：</div>
      <Input.TextArea
        rows={4}
        value={fixedText}
        onChange={(e) => setFixedText(e.target.value)}
        placeholder="输入固定文字"
      />
      <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
        每张订单生成一个 Word，文件名为“客户名称+电话”；批量导出会打包成 zip。
      </div>
    </Modal>
  )
}
