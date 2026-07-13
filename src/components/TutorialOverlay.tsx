/**
 * I-4 첫 방문 튜토리얼 — 4단계 계기 안내. localStorage 1회, 팔레트 명령
 * TUTORIAL로 재호출. 스크림은 대상 주변 4분할 잉크(글래스/블러 금지 §7),
 * reduced-motion 존중(transition 제거). 단계 상태는 시트를 open 시에만
 * 마운트해 자연 리셋.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../store/viewStore'

const SEEN_KEY = 'atlas.tutorial.v1'

interface Step {
  key: 's1' | 's2' | 's3' | 's4'
  target: string | null // data-tour selector
}

const STEPS: readonly Step[] = [
  { key: 's1', target: '[data-tour="cluster"]' },
  { key: 's2', target: '[data-tour="barograph"]' },
  { key: 's3', target: '[data-tour="surfaces"]' },
  { key: 's4', target: null },
]

export function TutorialOverlay() {
  const open = useViewStore((s) => s.tutorialOpen)

  // 첫 방문 1회 자동 노출 — 로드 시퀀스(§4 ~1.6s) 뒤에
  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) return
    const timer = setTimeout(() => {
      useViewStore.getState().setTutorialOpen(true)
    }, 1_800)
    return () => clearTimeout(timer)
  }, [])

  if (!open) return null
  return <TutorialSheet />
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const measureTarget = (selector: string | null): Rect | null => {
  const el = selector ? document.querySelector(selector) : null
  if (!el) return null
  const r = el.getBoundingClientRect()
  const pad = 8
  return {
    top: r.top - pad,
    left: r.left - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  }
}

function TutorialSheet() {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  // 초기 rect는 렌더 전에 동기 측정 — effect-내 동기 setState 회피
  const [rect, setRect] = useState<Rect | null>(() =>
    measureTarget(STEPS[0].target),
  )

  // 리사이즈 추적 (비동기 이벤트 콜백의 setState는 규칙 위반 아님)
  useEffect(() => {
    const onResize = () => setRect(measureTarget(STEPS[step]?.target ?? null))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [step])

  const close = () => {
    localStorage.setItem(SEEN_KEY, '1')
    useViewStore.getState().setTutorialOpen(false)
  }
  const goto = (n: number) => {
    setStep(n)
    setRect(measureTarget(STEPS[n]?.target ?? null))
  }
  const next = () => {
    if (step >= STEPS.length - 1) close()
    else goto(step + 1)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useViewStore.getState().paletteOpen) return
      localStorage.setItem(SEEN_KEY, '1')
      useViewStore.getState().setTutorialOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const scrim = 'absolute bg-ink-0/80'
  const current = STEPS[step]

  // 캡션 위치: 대상 아래 우선, 하단 공백 부족 시 위
  const captionStyle: React.CSSProperties = rect
    ? rect.top + rect.height + 190 < window.innerHeight
      ? {
          top: rect.top + rect.height + 14,
          left: Math.min(Math.max(rect.left, 16), window.innerWidth - 376),
        }
      : {
          top: rect.top - 190,
          left: Math.min(Math.max(rect.left, 16), window.innerWidth - 376),
        }
    : { top: '38%', left: '50%', transform: 'translateX(-50%)' }

  return (
    <div
      role="dialog"
      aria-label={t('tutorial.aria')}
      className="absolute inset-0 z-40"
    >
      {rect ? (
        <>
          {/* 4분할 스크림 — 대상만 밝게 남긴다 */}
          <div
            className={scrim}
            style={{ top: 0, left: 0, right: 0, height: Math.max(rect.top, 0) }}
          />
          <div
            className={scrim}
            style={{
              top: rect.top,
              left: 0,
              width: Math.max(rect.left, 0),
              height: rect.height,
            }}
          />
          <div
            className={scrim}
            style={{
              top: rect.top,
              left: rect.left + rect.width,
              right: 0,
              height: rect.height,
            }}
          />
          <div
            className={scrim}
            style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            aria-hidden="true"
            className="absolute border border-flow-in/70"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
          />
        </>
      ) : (
        <div className={scrim + ' inset-0'} />
      )}

      <div
        className="absolute w-[360px] border border-paper/15 bg-ink-1 p-4 transition-[top,left] duration-280 ease-(--ease-baro) motion-reduce:transition-none"
        style={captionStyle}
      >
        <p className="dial-label text-flow-in">
          {t(`tutorial.${current.key}.title`)}
        </p>
        <p className="mt-2 font-sans text-[12px] leading-relaxed text-paper-dim">
          {t(`tutorial.${current.key}.body`)}
        </p>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="readout text-[10px] text-paper-dim/60">
            {t('tutorial.stepOf', { n: step + 1, total: STEPS.length })}
          </span>
          <span className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={close}
              className="dial-label text-paper-dim/60 transition-colors duration-140 hover:text-paper"
            >
              {t('tutorial.skip')}
            </button>
            <button
              type="button"
              onClick={next}
              className="dial-label text-flow-in transition-colors duration-140 hover:text-paper"
            >
              {step >= STEPS.length - 1 ? t('tutorial.done') : t('tutorial.next')}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
