import { Button, InputNumber, Segmented, theme, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { CSSProperties, ReactNode } from 'react'
import {
  PALETTES,
  PALETTE_ORDER,
  type EffectSettings,
  type FilterKind,
  type InkTone,
  type PaletteName,
} from './effectSettings'

interface EffectPanelProps {
  settings: EffectSettings
  onChange: (patch: Partial<EffectSettings>) => void
  onReset: () => void
  mediaSrc?: string
}

export default function EffectPanel({ settings, onChange, onReset, mediaSrc }: EffectPanelProps) {
  const { token } = theme.useToken()

  const Row = ({ label, children, visible = true }: { label: string; children: ReactNode; visible?: boolean }) => {
    if (!visible) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: 46, gap: 8 }}>
        <div style={{ width: 136, flex: '0 0 136px', fontSize: 12, color: token.colorTextSecondary }}>{label}</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>{children}</div>
      </div>
    )
  }

  const Range = ({
    value,
    onChange: onValue,
    suffix,
  }: {
    value: number
    onChange: (v: number) => void
    suffix?: string
  }) => (
    <>
      <div style={{ position: 'relative', flex: 1, height: 30, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: '100%', height: 22, borderRadius: 8, background: token.colorFillTertiary }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${value}%`,
              borderRadius: 8,
              background: token.colorPrimary,
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 4,
              bottom: 4,
              width: 1,
              background: token.colorTextQuaternary,
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: `calc(${value}% - 4.5px)`,
            width: 9,
            height: 30,
            borderRadius: 3,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorPrimary}`,
            boxShadow: `0 1px 4px ${token.colorFillSecondary}`,
            pointerEvents: 'none',
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onValue(Number(e.target.value))}
          aria-label="value"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, margin: 0, cursor: 'pointer' }}
        />
      </div>
      <InputNumber
        min={0}
        max={100}
        value={value}
        controls={false}
        onChange={(v) => onValue(Number(v ?? 0))}
        formatter={(v) => (suffix ? `${v ?? 0}${suffix}` : String(v ?? 0))}
        parser={(v) => Number(String(v ?? '').replace(suffix ?? '', '')) || 0}
        style={{ width: 58, textAlign: 'center' }}
      />
    </>
  )

  const swatchStyle = (name: PaletteName): CSSProperties => {
    if (name === 'original') {
      return mediaSrc
        ? { backgroundImage: `url("${mediaSrc}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: token.colorFillTertiary }
    }
    const [, a, b] = PALETTES[name]
    return { background: `linear-gradient(135deg, ${a}, ${b})` }
  }

  return (
    <div
      style={{
        width: 'min(420px, 100%)',
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 16,
        padding: '8px 16px 12px',
        boxShadow: `0 10px 30px ${token.colorFillSecondary}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 40 }}>
        <strong style={{ fontSize: 13 }}>Effect controls</strong>
        <Tooltip title="恢复当前滤镜的推荐值">
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={onReset}>
            Reset to recommended
          </Button>
        </Tooltip>
      </div>

      <Row label="Mask effect">
        <Range value={settings.mask} onChange={(mask) => onChange({ mask })} />
      </Row>
      <Row label="Filter">
        <Segmented
          size="small"
          value={settings.filter}
          onChange={(value) => onChange({ filter: value as FilterKind })}
          options={[
            { label: 'ASCII', value: 'ascii' },
            { label: 'Dither', value: 'dither' },
          ]}
        />
      </Row>
      <Row label="Color">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {PALETTE_ORDER.map((name) => {
            const selected = settings.palette === name
            return (
              <Tooltip key={name} title={name}>
                <button
                  type="button"
                  aria-label={name}
                  aria-pressed={selected}
                  onClick={() => onChange({ palette: name })}
                  style={{
                    width: 22,
                    height: 22,
                    padding: 0,
                    border: 0,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    ...swatchStyle(name),
                    boxShadow: selected
                      ? `0 0 0 3px ${token.colorBgContainer}, 0 0 0 5px ${token.colorPrimary}`
                      : `0 0 0 1px ${token.colorBorderSecondary}`,
                  }}
                />
              </Tooltip>
            )
          })}
        </div>
      </Row>
      <Row label="Sample tones" visible={settings.filter === 'ascii'}>
        <Segmented
          size="small"
          value={settings.inkTone}
          onChange={(value) => onChange({ inkTone: value as InkTone })}
          options={[
            { label: 'Shadows', value: 'shadows' },
            { label: 'Highlights', value: 'highlights' },
          ]}
        />
      </Row>
      <Row label="Sampling strength">
        <Range value={settings.strength} onChange={(strength) => onChange({ strength })} />
      </Row>
      <Row label="Size">
        <Range value={settings.size} onChange={(size) => onChange({ size })} />
      </Row>
      <Row label="Spacing (%)">
        <Range value={settings.spacing} onChange={(spacing) => onChange({ spacing })} suffix="%" />
      </Row>
    </div>
  )
}
