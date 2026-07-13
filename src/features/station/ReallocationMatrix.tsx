/**
 * Phase O — REALLOCATION (§8 축소 구현): 자산 간 흐름 재배분의 최대엔트로피
 * 모델 배분 행렬. **전 셀 grade E** — §6 어법(짙은 안개·파선 테두리·상시
 * "MODEL ALLOCATION" 라벨)을 강제하고, VIS=OBS에선 구역이 통째로 소멸한다
 * (전부 모델이므로 — §6의 가장 순수한 적용). 셀 클릭 = 교정 시트(산식·
 * Fréchet 범위·반복·잔차·관측 마진까지 계보).
 *
 * 라벨/수치는 HTML — 스트레치 SVG 글리프 뭉개짐 교훈(순환도 fix) 준수.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFlowMatrix } from '../../lib/dataClient'
import { fogAlpha, rgbVar, rgbaCss } from '../../lib/tokens'
import { ASSET_ABBR } from '../synoptic/shared'
import type { DossierPayload } from '../../types/dossier'
import type {
  AssetClass,
  FlowMatrixCountry,
  PeriodKey,
} from '../../types/data'
import type { CompositionMode } from './CompositionStream'

const EXTERNAL = 'external'
const E_FOG = 0.45 // --fog-E — 이 구역의 기본 대기

const abbr = (a: string) =>
  a === EXTERNAL ? 'EXT' : (ASSET_ABBR[a as AssetClass] ?? a.slice(0, 4).toUpperCase())

interface Props {
  iso: string
  name: string
  period: PeriodKey
  observedOnly: boolean
  mode: CompositionMode
  onMode: (m: CompositionMode) => void
  fmt: (v: number, digits?: number) => string
  openDossier: (p: DossierPayload) => void
}

function ModeToggle({
  mode,
  onMode,
  aria,
}: {
  mode: CompositionMode
  onMode: (m: CompositionMode) => void
  aria: string
}) {
  return (
    <span
      role="group"
      aria-label={aria}
      className="flex items-baseline gap-2 border-l border-paper/10 pl-3"
    >
      {(['stream', 'multiples', 'realloc'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onMode(m)}
          className={
            'dial-label transition-colors duration-140 ' +
            (mode === m ? 'text-flow-in' : 'text-paper-dim/50 hover:text-paper')
          }
        >
          {m === 'stream' ? 'STREAM' : m === 'multiples' ? 'MULTIPLES' : 'REALLOC'}
        </button>
      ))}
    </span>
  )
}

export function ReallocationMatrix({
  iso,
  name,
  period,
  observedOnly,
  mode,
  onMode,
  fmt,
  openDossier,
}: Props) {
  const { t } = useTranslation()
  // 로딩 상태는 파생 — 결과에 요청 키를 실어 stale 응답과 로딩을 동시에 처리
  // (동기 setState-in-effect 금지: react-hooks v7 / React Compiler 규칙)
  const wantKey = `${iso}|${period}`
  const [loaded, setLoaded] = useState<{
    key: string
    m: FlowMatrixCountry | null
  } | null>(null)

  useEffect(() => {
    if (iso === 'WLD' || observedOnly) return
    let alive = true
    getFlowMatrix(period)
      .then((file) => {
        if (alive) setLoaded({ key: wantKey, m: file.countries[iso] ?? null })
      })
      .catch(() => {
        if (alive) setLoaded({ key: wantKey, m: null })
      })
    return () => {
      alive = false
    }
  }, [iso, period, observedOnly, wantKey])

  const current = loaded && loaded.key === wantKey ? loaded : null
  const matrix = current?.m ?? null
  const state: 'loading' | 'ready' | 'absent' =
    current === null ? 'loading' : matrix ? 'ready' : 'absent'

  const header = (
    <div className="flex shrink-0 items-baseline justify-between gap-4">
      <p className="dial-label text-paper-dim/70">
        REALLOCATION · SOLD → BOUGHT · {period} ·{' '}
        <span className="text-paper-dim">MODEL ALLOCATION · GRADE E</span>
      </p>
      <ModeToggle mode={mode} onMode={onMode} aria={t('station.viewModeAria')} />
    </div>
  )

  // §6 — 전부 모델이므로 OBS 모드에선 통째로 소멸
  const empty = (text: string) => (
    <section className="flex min-h-0 flex-col">
      {header}
      <div className="readout flex flex-1 items-center justify-center text-center text-[11px] tracking-[0.14em] text-paper-dim">
        {text}
      </div>
    </section>
  )
  if (observedOnly) return empty(t('station.realloc.hiddenObs'))
  if (iso === 'WLD') return empty(t('station.realloc.world'))
  if (state === 'loading') return empty(t('station.realloc.loading'))
  if (state === 'absent' || !matrix) return empty(t('station.realloc.empty', { period }))

  const rows = [...new Set(matrix.cells.map((c) => c.from))]
  const cols = [...new Set(matrix.cells.map((c) => c.to))]
  const maxV = Math.max(...matrix.cells.map((c) => c.value), 1)
  const cellAt = (f: string, to: string) =>
    matrix.cells.find((c) => c.from === f && c.to === to)

  const cellDossier = (f: string, to: string): DossierPayload | null => {
    const c = cellAt(f, to)
    if (!c) return null
    return {
      title: `${name} · ${abbr(f)} → ${abbr(to)} — ${t('station.realloc.dossierKind')}`,
      subtitle: `${t('station.realloc.dossierSub')} · ${period}`,
      value_usd: c.value,
      grade: 'E',
      method: 'max_entropy_flow_allocation_ipf',
      lower_bound: c.lower,
      upper_bound: c.upper,
      source_ids: ['model_flow_reallocation', 'imf_bop'],
      context: [
        ['Margins', t('station.realloc.marginsNote')],
        ...Object.entries(matrix.observed).map(
          ([a, v]): [string, string] => [abbr(a), `${v >= 0 ? '+' : ''}${fmt(v, 1)}`],
        ),
        ['External', matrix.external ?? '—'],
        ['Iterations', String(matrix.iterations)],
        ['Residual', matrix.residual.toExponential(1)],
      ],
    }
  }

  const fogged = 1 - E_FOG
  return (
    <section className="flex min-h-0 flex-col" aria-label={t('station.realloc.aria')}>
      {header}
      <div className="mt-1 min-h-0 flex-1 overflow-hidden">
        <div
          className="grid h-full w-full gap-px"
          style={{
            gridTemplateColumns: `minmax(44px,auto) repeat(${cols.length}, minmax(0,1fr))`,
            gridTemplateRows: `auto repeat(${rows.length}, minmax(0,1fr))`,
            opacity: fogged + 0.25, // E-대기: 구역 전체가 뿌옇다
          }}
        >
          <span className="dial-label self-end pb-0.5 text-[8px] text-paper-dim/50">
            {t('station.realloc.axis')}
          </span>
          {cols.map((c) => (
            <span
              key={`h-${c}`}
              className="dial-label self-end pb-0.5 text-center text-[9px] text-paper-dim/70"
            >
              {abbr(c)}
            </span>
          ))}
          {rows.map((f) => (
            <div key={`r-${f}`} className="contents">
              <span className="readout self-center pr-2 text-right text-[10px] text-paper-dim">
                {abbr(f)}
              </span>
              {cols.map((c) => {
                const cell = cellAt(f, c)
                if (!cell)
                  return (
                    <span
                      key={`${f}-${c}`}
                      className="border border-dashed border-paper/5"
                    />
                  )
                const intensity = cell.value / maxV
                const d = cellDossier(f, c)
                return (
                  <button
                    key={`${f}-${c}`}
                    type="button"
                    onClick={() => d && openDossier(d)}
                    className="readout min-w-0 cursor-pointer truncate border border-dashed border-paper/15 px-1 text-[10px] text-paper transition-opacity duration-140 hover:opacity-100"
                    style={{
                      background: rgbaCss(rgbVar('--color-flow-in'), 0.04 + 0.22 * intensity),
                      opacity: 0.55 + 0.45 * intensity,
                    }}
                    title={`${abbr(f)} → ${abbr(c)} · ${fmt(cell.value, 1)} · E`}
                  >
                    {fmt(cell.value, 1)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="readout shrink-0 text-[9px] tracking-[0.1em] text-paper-dim/60">
        {t('station.realloc.footnote')} · FOG {fogAlpha('E').toFixed(2)}
      </p>
    </section>
  )
}
