/**
 * I-5 small multiples — ALL 탭의 자산별 미니 흐름 차트 격자. 계기 뱅크 어법
 * (공유 베이스라인·괘선, 카드 프레임/그림자 금지 §1.4·§7). 동일 y-스케일이
 * 기본(비교 가능성 — small multiples의 존재 이유), 셀 클릭 = 자산 탭 진입.
 * 표시되는 흐름은 BOP 관측(A)만이므로(모델 레코드는 flow_grade 부재로 제외)
 * 별도 안개 처리가 필요 없다.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetClass, StationFile } from '../../types/data'
import { formatUsdNet } from '../../lib/format'
import { rgbVar, rgbaCss } from '../../lib/tokens'
import { ASSET_ABBR } from '../synoptic/shared'
import { assetsPresent, flowArrays } from './derive'
import type { CompositionMode } from './CompositionStream'
import { fullPeriods } from './shared'

interface Props {
  file: StationFile
  observedOnly: boolean
  periodIndex: number
  onTab: (asset: AssetClass) => void
  mode: CompositionMode
  onMode: (m: CompositionMode) => void
}

const H = 30 // viewBox height
const MID = H / 2

export function SmallMultiples({
  file,
  observedOnly,
  periodIndex,
  onTab,
  mode,
  onMode,
}: Props) {
  const { t } = useTranslation()
  const [sharedY, setSharedY] = useState(true)
  const n = fullPeriods().length
  const assets = assetsPresent(file)
  const per = assets.map((asset) => {
    const { flowIn, flowOut } = flowArrays(file, asset, observedOnly)
    let max = 1
    let latestNet: number | null = null
    for (let i = 0; i < n; i++) {
      max = Math.max(max, Math.abs(flowIn[i] ?? 0), Math.abs(flowOut[i] ?? 0))
      if (i <= periodIndex && (flowIn[i] !== null || flowOut[i] !== null))
        latestNet = (flowIn[i] ?? 0) - (flowOut[i] ?? 0)
    }
    const empty = !flowIn.some((v) => v !== null) && !flowOut.some((v) => v !== null)
    return { asset, flowIn, flowOut, max, latestNet, empty }
  })
  const globalMax = Math.max(...per.map((p) => p.max), 1)

  const amber = rgbaCss(rgbVar('--color-flow-in'), 0.8)
  const cyan = rgbaCss(rgbVar('--color-flow-out'), 0.75)
  const baseline = rgbaCss(rgbVar('--color-paper'), 0.1)
  const needle = rgbaCss(rgbVar('--color-flow-in'), 0.45)
  const barW = (100 / n) * 0.72

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline justify-between gap-4">
        <p className="dial-label text-paper-dim/70">
          FLOW MULTIPLES · BY ASSET · 2010→
        </p>
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            aria-pressed={sharedY}
            aria-label={t('station.sharedYAria')}
            onClick={() => setSharedY((v) => !v)}
            className={
              'dial-label transition-colors duration-140 ' +
              (sharedY ? 'text-flow-in' : 'text-paper-dim/50 hover:text-paper')
            }
          >
            SHARED Y
          </button>
          <span
            role="group"
            aria-label={t('station.viewModeAria')}
            className="flex items-baseline gap-2 border-l border-paper/10 pl-3"
          >
            {(['stream', 'multiples'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => onMode(m)}
                className={
                  'dial-label transition-colors duration-140 ' +
                  (mode === m
                    ? 'text-flow-in'
                    : 'text-paper-dim/50 hover:text-paper')
                }
              >
                {m === 'stream' ? 'STREAM' : 'MULTIPLES'}
              </button>
            ))}
          </span>
        </div>
      </div>
      <div className="mt-1 grid min-h-0 flex-1 grid-cols-3 gap-x-6 gap-y-1.5">
        {per.map(({ asset, flowIn, flowOut, max, latestNet, empty }) => (
          <button
            key={asset}
            type="button"
            onClick={() => onTab(asset)}
            aria-label={t('station.multipleAria', { asset: ASSET_ABBR[asset] })}
            className="group flex min-h-0 flex-col text-left"
          >
            <span className="flex items-baseline justify-between">
              <span className="dial-label text-[9px] text-paper-dim/70 transition-colors duration-140 group-hover:text-paper">
                {ASSET_ABBR[asset]}
              </span>
              <span className="readout text-[9px] text-paper-dim/60">
                {latestNet === null ? '—' : formatUsdNet(latestNet)}
              </span>
            </span>
            {empty ? (
              <span className="readout flex min-h-0 flex-1 items-center text-[9px] tracking-[0.14em] text-paper-dim/40">
                {t('station.multiplesNoFlow')}
              </span>
            ) : (
              <svg
                viewBox={`0 0 100 ${H}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                className="min-h-0 w-full flex-1 border-b border-paper/8"
              >
                <line x1="0" y1={MID} x2="100" y2={MID} stroke={baseline} strokeWidth="0.4" />
                {Array.from({ length: n }, (_, i) => {
                  const scale = sharedY ? globalMax : max
                  const x = (i / n) * 100 + (100 / n - barW) / 2
                  const hIn = ((flowIn[i] ?? 0) / scale) * (MID - 1)
                  const hOut = ((flowOut[i] ?? 0) / scale) * (MID - 1)
                  return (
                    <g key={i}>
                      {hIn > 0 && (
                        <rect x={x} y={MID - hIn} width={barW} height={hIn} fill={amber} />
                      )}
                      {hOut > 0 && (
                        <rect x={x} y={MID} width={barW} height={hOut} fill={cyan} />
                      )}
                    </g>
                  )
                })}
                <line
                  x1={((periodIndex + 0.5) / n) * 100}
                  y1="0"
                  x2={((periodIndex + 0.5) / n) * 100}
                  y2={H}
                  stroke={needle}
                  strokeWidth="0.5"
                />
              </svg>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
