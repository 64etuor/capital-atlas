/**
 * 풀스크린 Esc(I-3) — 오버레이 계층(팔레트 > 튜토리얼 > 도시에 > 풀스크린)을
 * 존중한다: 상위 오버레이가 열려 있으면 그쪽 핸들러가 소비하고 여기선 무시.
 * (react-refresh 제약으로 컴포넌트 파일과 분리)
 */
import { useEffect } from 'react'
import { useViewStore } from '../store/viewStore'

export function useFullscreenEsc(active: boolean, exit: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useViewStore.getState()
      if (s.paletteOpen || s.dossierOpen || s.tutorialOpen) return
      exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, exit])
}
