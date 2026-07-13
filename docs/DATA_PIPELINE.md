# Data Pipeline (Phase B)

공개 통계 API → 정규화 → 계약 데이터셋(`public/data/`) 생성. 서버 없음 — 오프라인
스크립트가 정적 JSON을 굽는다.

## 실행

```bash
pnpm data:fetch   # 수집(24h 캐시) + 조립 → public/data/
pnpm data:check   # 계약 스키마(zod) + 상식 범위 게이트 (CI-able)
```

원시 응답은 `data-raw/`(gitignore)에 보존된다. 재실행은 24h 내 캐시를 재사용한다.

## 소스별 상태 (2026-07-12 실측)

| source_id | 데이터 | 상태 | 등급 |
|---|---|---|---|
| `imf_iip` | 대외 자산·부채 잔액, 국가×분기 (2010~) | ✅ 127개국, 75,927 obs | A |
| `imf_bop` | 금융계정 실거래 흐름, 국가×분기 | ✅ 150개국, 83,381 obs | A |
| `imf_pip` | 양자 포트폴리오 포지션 (CPIS), 연간 2013~ | ✅ 81개 보고국, 273,743 obs | A |
| `wb_wdi` | 상장주식 시총(발행국 총액)·GDP, 연간 | ✅ 1,150 / 3,071 obs | B |
| `coingecko_global` | 암호자산 글로벌 통제값 | ✅ (국가배분은 v2) | B |
| `bis_lbs` | 국경 간 은행 loans&deposits 양자 회랑, 분기 (Phase M) | ✅ 39개 보고국, 150,815 회랑 | B |
| BIS DSS | 채무증권 발행잔액 | ❌ 미착수 (후속) | — |

**IMF API 주의**: 구 `dataservices.imf.org`는 DNS까지 폐기됨. 신 API는
`api.imf.org/external/sdmx/2.1` — **데이터는 SDMX StructureSpecificData XML만**
반환한다(JSON Accept 무시/500). 키 차원과 코드값은 문서보다 실호출 프로브가 정확했다:

- IIP/BOP 키: `COUNTRY.BOP_ACCOUNTING_ENTRY.INDICATOR.UNIT.FREQUENCY` (ISO3, USD, Q)
- 잔액 엔트리: `A_P`/`L_P`. **흐름 엔트리는 `A_NFA_T`(자산 순취득)/`L_NIL_T`(부채 순발생)** — `A_T`/`L_T` 아님(1차 실행 0건의 원인).
- PIP 키: `COUNTRY.ACCOUNTING_ENTRY.INDICATOR.SECTOR.COUNTERPART_SECTOR.COUNTERPART_COUNTRY.FREQUENCY` — `{iso3}.A.P_F51_P_USD+P_F3_P_USD.S1.S1..A`
- OBS_VALUE는 절대 USD (KOR D A_P 2024-Q4 ≈ $769.5B로 검증).

**BIS API (Phase M, 2026-07-13 실호출 프로브)**: `stats.bis.org/api/v2/data/dataflow/`
SDMX 2.1 REST, `format=csv`(SDMX-CSV) 지원 — IMF와 달리 CSV가 나와 파싱이 쉽다.

- LBS dataflow: `BIS/WS_LBS_D_PUB/1.0`, key **12차원**
  `Q.S.{C|L}.G.TO1.A.5J.A.{REP}.A.{CP}.N` (S=잔액, C/L=claims/liabilities,
  G=loans and deposits, TO1=전통화, 5J=전체 모행 소재국, N=cross-border).
- 값은 `OBS_VALUE × 10^UNIT_MULT`(=6, 백만 USD). 검증: KR→US claims 2024-Q4
  = $47.670B, KR liabilities to US = $14.191B (샤드 병합값과 정확 일치).
- 보고국은 런타임 발견(1분기 전체 와일드카드) — 39개국 채택, **BM/GG/IM/JE/KY
  5곳은 국가 마스터 밖(역외센터)이라 정직 드랍** + `pipeline_report.bis_lbs`에 기록.
- 상품 G는 loans+deposits 합산 — 포지션 방향으로 분류(claims=loans/
  liabilities=deposits), grade B + estimate_method로 공개. 수집: `pnpm data:bis`
  (멱등 병합, 전체 재수집 불요).

## 자산 매핑 (BPM6 → 계약 asset)

| BPM6 지표 | asset | 비고 |
|---|---|---|
| `D` / `D_F` | `unlisted_equity_fdi` | 직접투자 |
| `P_F5_MV` / `P_F5` | `listed_equity` | 펀드지분 포함(F51+F52) — v1 한계 |
| `P_F3_MV` / `P_F3` | `debt_securities` | |
| `O_F2_NV` / `O_F2` | `deposits` | |
| `O_F4_NV` / `O_F4` | `loans` | |
| `R` | `reserves_gold` | owner 기준만 |
| PIP `P_F51_P_USD` | `listed_equity` | 양자 |
| PIP `P_F3_P_USD` | `debt_securities` | 양자 |

## 의미 계약 (Phase C 필독)

- **stocks_owner** = 거주자의 **대외**(국경 간) 자산. 국내 보유분은 v2.
- **stocks_issuer** = 자산별 의미 고정(계약 문서 표 참조): listed_equity만 WB **총액**,
  나머지는 비거주자 보유 대외부채.
- **flows_country** 부호: `entry=assets` 양수 = 거주자의 해외자산 취득(유출측),
  `entry=liabilities` 양수 = 비거주자의 국내 투자(유입측). BPM6 부호 보존.
- **flows_bilateral**: PIP는 연간 → `YYYY-Q4`로 표기. 파생 flow는 가격효과 미조정
  (`position_change_unadjusted_for_price`, D등급) — 가격조정 C등급은 v2.
- **평가변동**(valuation) = ΔIIP 포지션 − BOP 거래 (둘 다 관측된 분기만, C등급).

## 폴백 사다리 ("빈칸 금지", 초안 §6 축소판)

1. 직접 관측 (A/B)
2. 직전 관측 롤포워드, 최대 8분기 (D, ±20%)
3. 지역(subregion) 중앙값 GDP-비율 모델, 최근 4분기만 (E, ±35%)
4. GDP 앵커도 없으면 **정직하게 빈 셀** — `meta/pipeline_report.json`에 커버리지 기록

주거부동산(location)은 지역별 주택자산/GDP 배율 휴리스틱(1.5~3.1×, 기본 1.6×) E등급.
조야한 v1 모델임을 명시한다 — 등기·센서스 기반은 v2.

## 프루닝 (침묵 금지)

양자 레코드는 |값| ≥ $100M만 유지 — 레코드 16.4%로 가치 99.82% 보존(실측).
드롭 수는 조립 로그와 `meta/pipeline_report.json`에 기록된다.

## 알려진 한계 (v1)

- `value_usd_constant_fx` 미산출(환율 시계열 미수집) — 계약상 optional.
- IIP `P_F5`에 펀드지분 포함 → `funds` asset은 미분리.
- PIP 파생 flow는 가격효과 미조정(D등급으로 정직 표기).
- 총 산출 ~183MB(Phase M 은행 회랑 합류 후; station 사전집계 85.9MiB 포함) —
  git에는 무겁지만 정적 서빙엔 문제없음. 파일당 최대 ~2.2MB(bilateral Q4)로
  5MB 조항 준수. 전부 lazy-load 전제. station 용량이 부담되면 후속에서 은행
  파트너 시계열 상한(top-N) 검토.
- BIS 양자합 ↔ IIP 국가 총계는 보고국 커버리지 차이로 불일치 — 조정하지 않고
  `pipeline_report.bis_lbs`에 기록(§12 폐합 정신, §5 중복 가드).
- 2026-Q1이 최신 분기(IIP 기준). WB 시총은 2024년까지.

## flowmatrix (Phase O — §8 재배분 행렬)

- 입력: `flows_country/{period}` BOP `entry=assets` 순흐름(A등급)만 — 거주자의
  대외자산 재배분 관점(liabilities는 행위자가 달라 혼합 금지).
- 방법: IPF, 균등 prior(= 최대엔트로피 독립해 `row·col/T`), 상한 100회·잔차
  1e-9. 미수렴이면 빌드 자체가 실패한다(부분 산출 금지).
- 셀 드랍 없음 — 초소액 마진(달러 단위 국가)에서도 폐합이 정확해야 sanity의
  전수 마진 검증이 성립한다(개발 중 $1 컷이 폐합을 깨는 것을 적발해 제거).
- 65분기 · 8,819 국가-행렬 · 총 ~7MB. 체인: `data:station` 다음
  `data:flowmatrix`(크론 포함 — 체인 누락=스테일 산출물).
