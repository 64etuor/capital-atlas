/**
 * 차트 우상단 미니 계기(I-1·I-3) — PNG·CSV 내보내기 + 풀스크린 토글.
 * 카드/아이콘 금지(§7): mono 텍스트 코드만. PNG/CSV는 포맷 코드라 로케일
 * 불변, aria만 번역한다.
 */
import { useTranslation } from 'react-i18next'

interface Props {
  onPng: () => void
  onCsv: () => void
  full?: { active: boolean; toggle: () => void }
}

export function ChartControls({ onPng, onCsv, full }: Props) {
  const { t } = useTranslation()
  const btn =
    'dial-label text-paper-dim/50 transition-colors duration-140 hover:text-paper'
  return (
    <span className="flex items-baseline gap-2.5 whitespace-nowrap">
      <button
        type="button"
        onClick={onPng}
        aria-label={t('export.pngAria')}
        className={btn}
      >
        PNG
      </button>
      <button
        type="button"
        onClick={onCsv}
        aria-label={t('export.csvAria')}
        className={btn}
      >
        CSV
      </button>
      {full && (
        <button
          type="button"
          onClick={full.toggle}
          aria-label={t(full.active ? 'export.exitFullAria' : 'export.fullAria')}
          aria-pressed={full.active}
          className={
            full.active ? 'dial-label text-flow-in hover:text-paper' : btn
          }
        >
          {full.active ? t('export.exitFull') : t('export.full')}
        </button>
      )}
    </span>
  )
}
