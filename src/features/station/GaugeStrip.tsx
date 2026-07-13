/**
 * 계기 행 — 한 줄 리드아웃 스트립(카드 아님): 흐름 강도·YoY·시정·범위.
 * 각 계기는 버튼 — 산식까지 계보 도시에로 연다(§1.5).
 */
import type { DossierPayload } from '../../types/dossier'
import { useViewStore } from '../../store/viewStore'

export interface Gauge {
  label: string
  value: string
  tone?: 'in' | 'out' | 'paper' | 'dim'
  dossier: DossierPayload
}

const TONE = {
  in: 'text-flow-in',
  out: 'text-flow-out',
  paper: 'text-paper',
  dim: 'text-paper-dim',
} as const

export function GaugeStrip({ gauges }: { gauges: Gauge[] }) {
  const openDossier = useViewStore((s) => s.openDossier)
  return (
    // flex-wrap: 좁은 폭에서 스트립이 우측 계기 클러스터 레일을 침범하지 않고
    // 둘째 줄로 접힌다 (감사 1200px 겹침)
    <div className="flex shrink-0 flex-wrap items-baseline gap-0 border-y border-paper/10">
      {gauges.map((g, i) => (
        <button
          key={g.label}
          type="button"
          onClick={() => openDossier(g.dossier)}
          className={
            'group flex items-baseline gap-2 py-1.5 pr-5 ' +
            (i > 0 ? 'border-l border-paper/10 pl-5' : '')
          }
        >
          <span className="dial-label text-[9px] text-paper-dim/60">
            {g.label}
          </span>
          <span
            className={`readout text-[11px] ${TONE[g.tone ?? 'paper']} group-hover:underline group-hover:decoration-dotted group-hover:underline-offset-2`}
          >
            {g.value}
          </span>
        </button>
      ))}
    </div>
  )
}
