# Capital Atlas — Brief

**전 세계 자본을 날씨처럼 관측하는 사이트.** 자산 잔액은 기압, 거래 흐름은 바람,
평가변동은 온도, 불확실성은 안개로 렌더링한다. Windy가 바람에 한 일을 돈에 한다.

- **시각 디자인 정본: [`DESIGN.md`](./DESIGN.md)** (BAROMETER — 돈의 기상학). 위반 = 리뷰 차단.
- **데이터 계약 정본: [`docs/DATA_CONTRACT.md`](./docs/DATA_CONTRACT.md)** (TS 미러 `src/types/data.ts`).

## v1 스코프 (사용자 결정: 비주얼 우선 + 실데이터)

공개 통계(IMF IIP/CPIS, BIS, World Bank …)를 **오프라인 스크립트로 정적
데이터셋화**(`public/data/`) → 그 위에 지구본·입자류 대시보드. 회계 스키마
(잔액/흐름 분리, 3장부 basis, 신뢰등급 A–E)는 데이터 계약에 설계로 반영하되,
서버·DB·크롤러·추정 엔진은 v2 이후.

## 스택

Vite 8 · React 19 · **React Compiler(필수)** · TypeScript strict · Tailwind v4
(`@theme` 토큰) · zustand · deck.gl 9 + MapLibre(지도) · ECharts(트리맵/Sankey) ·
pnpm. 폰트: Instrument Serif / Archivo / Spline Sans Mono (@fontsource 셀프호스트).

## 페이즈 로드맵

- **A — 스캐폴드** (this): 셸 + 계기 4구역 + 토큰 + 데이터 계약. ✓
- **B — 데이터**: IMF/BIS/WB 수집 스크립트 → `public/data/` 실데이터.
- **C — 시각화**: 지구본 choropleth(기압) + 입자류(바람) + 안개(등급) +
  바로그래프 실데이터 + 관측 리포트/계보 도시에.
- **D — 통합 검증**: 디자인 감사, 성능 예산(60fps), README.

## 제품 원칙 (초안 §20 요약 — 전문은 커밋된 초안 참조)

1. 시총 상승 ≠ 자금유입. 2. 거래량 ≠ 순유입. 3. 소유자/발행자/소재지 분리.
4. 모든 비중에 분모 명시. 5. 펀드·ETF·SPV·토큰은 룩스루. 6. 관측 vs 추정을
픽셀로 구분. 7. 빈 셀 금지 + 허위 정밀도 금지. 8. 모든 숫자에 계보·기준일.
9. 개정 이력 보존. 10. 세계 총계·국가 합계 폐합.
