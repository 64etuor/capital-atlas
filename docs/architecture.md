# Capital Atlas — 아키텍처 (v3 기준)

서버·DB·런타임 백엔드가 **없는** 정적 관측 플랫폼이다. "회계 엔진"은 빌드 타임
파이프라인으로 구현되어 있고, 산출물 전체가 정적 파일(`public/data/`)로 Vercel에
서빙된다. 이 문서는 그 전체 그림과, 설계 초안 §11(권장 아키텍처)과의 대응/차이를
기록한다.

## 레이어 — Bronze / Silver / Gold (초안 §11.1의 구현태)

```
Bronze  data-raw/                 원본 API 응답 그대로 (gitignore, 24h TTL 캐시)
        └─ imf/ wb/ bis/ …        fetchCached — bounded retry(3회)·실패 기록

Silver  scripts/fetch/*.ts        소스별 정규화 (SDMX XML/CSV 파싱, 코드 매핑,
                                  ISO 식별, 단위 정규화) — 메모리 내 통과층

Gold    public/data/              계약(DATA_CONTRACT.md)이 스키마인 정적 산출
        ├─ stocks_{basis}/        사실: 잔액 (국가×자산×분기, lineage 필수)
        ├─ flows_country/         사실: BOP 실거래 + 파생 평가변동
        ├─ flows_bilateral/       사실: PIP 증권 + DIP 직접투자 + BIS 은행 포지션
        ├─ exposure/              직접 통화·부문 + 등급화한 FXD·재구성 부채
        ├─ position_closure/      뷰: IIP 마진↔raw PIP seed RAS 폐합 (grade E)
        ├─ meta/position_closure_inputs.json.gz  RAS clean-CI 감사 입력 미러
        ├─ facts.ndjson.gz        ★ 관측·파생을 구분 보존한 정본 수치 원장
        ├─ synoptic.json station/ 뷰: 사전 집계 (사실에서 재계산 가능한 2차 산출)
        ├─ flowmatrix/            뷰: §8 모델 배분 (grade E)
        ├─ reconciliation/        품질: §12-3 미러 폐합 (조정 없이 기록)
        ├─ vintages/              시간: §10 이중 시간 — 빈티지 다이제스트
        └─ meta/                  sources 레지스트리·요약·리포트
```

핵심 구분: **관측(observation) vs 파생(derived) vs 뷰(view)**. A/B는 직접 관측,
C–E는 산식·범위·커버리지와 함께 발행하는 파생/모델 레코드다. `facts.ndjson.gz`는
둘을 지우지 않고 함께 보존하는 수치 원장이지, 모든 행이 관측이라는 뜻이 아니다.
synoptic/station/flowmatrix는 이 원장에서 재계산되는 UI 집계다. 정합은
`data:check`(zod + 상식 범위 + 사실원장·미러·RAS 마진 폐합 게이트)가 강제한다.
양자 포지션은 소스별 통계 basis를 지우지 않는다: PIP는 asset/liability, BIS LBS는
position side, DIP는 directional principle이다. 따라서 STATION의 all-scope 상대국
집계는 `BILATERAL-COVERED ASSETS`로만 부르고, exact-period `CP ALLOC`을 별도 진단으로
노출한다. 이 값은 국가 총자산 커버리지나 소스 완전성 주장이 아니다.

## 재생성 체인 (순서가 계약이다)

```
data:fetch → data:bis → data:exposure → data:closure → data:synoptic → data:station → data:flowmatrix
          → data:facts → data:reconcile → data:sources → data:check
          → data:changed → (실질 변경 시) data:vintage + commit
```

- 체인 누락은 조용한 소실/스테일을 만든다(Phase N에서 `data:bis` 누락이 은행
  회랑 15만 건을 지울 뻔한 실사고로 확인) — 일일 크론
  (`.github/workflows/data-refresh.yml`)이 이 순서를 명시적으로 실행한다.
- **결정론(Phase N)**: 샤드·파생 파일에 타임스탬프가 없다. 같은 상류 데이터면
  같은 바이트 — `data:changed`가 타임스탬프-전용 변경을 걸러 실질 변경일 때만
  커밋한다(push = Vercel 자동 배포).

## 신뢰·정직성 장치 (초안 §6·§12·§20)

| 장치 | 구현 |
|---|---|
| lineage 필수 | 모든 수치 레코드에 source_id·effective_date·grade, C–E는 계약별 산식+범위 |
| 등급 = 픽셀 | UI 안개 렌더링(§6), VIS=OBS에서 추정 소멸 |
| 수집 분류 | sources.json collection_mode — live 데이터의 통계 위장 금지(테스트) |
| 실패 원자성 | 필수 소스 terminal/성공-빈 응답은 public 쓰기 전에 중단; CoinGecko만 명시적 snapshot 폴백 |
| 폐합 | flowmatrix 마진=BOP 관측(±1e-6), RAS 잔차≤1e-9 + 발행 tail 메타, 미러 gap 기록(원 관측 조정 금지) |
| 이중 시간 | effective_date(기준일) vs retrieved_at/빈티지(인지 시점), REVISIONS 행 |
| 게이트 | vitest(계약·결정론·hex-0·i18n 패리티) + data:check + CI |

## 초안 §11과의 대응 / 차이 (의도된 결정)

| 초안 권장 | 여기서는 | 사유 |
|---|---|---|
| ClickHouse/PostgreSQL/Redis/FastAPI | 없음 — 정적 파일 + 클라이언트 lazy-load | 현행 facts gzip은 100MB 재검토 기준보다 충분히 작아 서버는 과설계. 클라이언트 LRU 샤드 캐시로 충분 |
| Dagster/Airflow | GitHub Actions 크론 + 명시적 체인 | 단일 파이프라인·일 1회 — 오케스트레이터 도입 비용이 이득을 초과 |
| dbt | tsx 스크립트 + zod 게이트 + vitest | 같은 역할(변환+테스트)을 단일 언어로 |
| Parquet/컬럼 저장 | NDJSON.gz 수치 원장 | 의존성 0·범용 소비(jq/pandas/duckdb 모두 읽음), 현재 크기는 `meta/facts_summary.json`으로 추적 |
| S3 원본 보존 | data-raw/ 로컬 캐시(24h) | 원본 재현은 소스 API가 담당, 빈티지 다이제스트가 개정 관측을 담당 |

다음 조건 중 하나가 생기면 DuckDB 아티팩트/서버 계층을 재검토한다:

- `facts.ndjson.gz`가 100 MB, 또는 브라우저가 읽는 단일 JSON 샤드가 5 MB를 넘는다.
- 국가별 월간·일간·일중 관측이나 인증/요율 제한 feed를 안전하게 중계해야 한다.
- 원시 응답 장기 보존과 과거 시점 완전 재현이 제품 요구가 된다.
- IIPCC/PIP의 직접 통화·부문·양방향 부채 커버리지가 바뀌어 현재의 별도 exposure
  계약보다 새로운 정본 축이 적합해진다.

그 전까지는 정적 파이프라인이 더 작고 감사 가능하다.

## 프런트엔드 경계

- 데이터 접근은 전부 `src/lib/dataClient.ts` — in-flight dedup + 실패 복구 +
  샤드 LRU(MAX_SHARD_CACHE, meta 핀 고정).
- 상태 = zustand(`viewStore`) + URL 딥링크(공유·복원 정본).
- 색 = `index.css @theme` 유일 원천(hex-0 게이트), 계기 코드 = 로케일 불변.
- 모든 수치 → 계보 도시에(§1.5): 출처·산식·범위·수집분류·개정이력·미러까지.
- 일중 값은 예외적으로 브라우저가 CoinGecko 공개 CORS endpoint에서 가져오되,
  5분 간격·최대 12회·30분 freshness·5분 미래시각 허용으로 제한한다. 실패하면
  `meta/global_crypto.json` 스냅샷으로 명시적 폴백하며 공식 빈티지·국가 배분·지수는
  바꾸지 않는다. 다중 feed나 credential이 필요해지면 이 경계를 폐기하고 서버를 재검토한다.
