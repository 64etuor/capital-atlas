/**
 * I-1 차트 내보내기 — PNG(출처 표기 라인 합성)·CSV(메타 주석 헤더).
 * 내보내기는 전부 로컬 Blob — 외부 요청 없음. 출처 표기 라인이 IMF
 * attribution·World Bank CC BY-4.0의 표기 의무를 이행하는 지점이다.
 */
import { rgbaCss, rgbVar } from './tokens'
import { getSources } from './dataClient'

export interface AttributionSource {
  publisher: string
  license_note: string
  retrieved_at: string
}

/** "Source: IMF (…) · World Bank (…) — capital-atlas · retrieved YYYY-MM-DD" */
export function buildAttributionLine(sources: AttributionSource[]): string {
  const byPublisher = new Map<string, AttributionSource>()
  for (const s of sources) {
    if (!byPublisher.has(s.publisher)) byPublisher.set(s.publisher, s)
  }
  if (byPublisher.size === 0) return 'capital-atlas'
  const parts = [...byPublisher.values()].map(
    (s) => `${s.publisher} (${s.license_note})`,
  )
  const retrieved = sources
    .map((s) => s.retrieved_at.slice(0, 10))
    .sort()
    .at(-1)
  return `Source: ${parts.join(' · ')} — capital-atlas · retrieved ${retrieved}`
}

/** 소스 레지스트리에서 출처 라인 해석 — 레지스트리 실패 시 폴백 라인. */
export async function attributionFor(sourceIds: string[]): Promise<string> {
  try {
    const map = await getSources()
    return buildAttributionLine(
      sourceIds.flatMap((id) => {
        const s = map.get(id)
        return s ? [s] : []
      }),
    )
  } catch {
    return 'capital-atlas'
  }
}

// ------------------------------------------------------------------ CSV ----

export interface CsvColumn {
  key: string
  label: string
}

const escapeCell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** `# Key: value` 메타 주석 → 헤더 → 행. RFC4180 이스케이프. */
export function serializeCsv(opts: {
  meta: Record<string, string>
  columns: CsvColumn[]
  rows: Array<Record<string, string | number | null | undefined>>
}): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(opts.meta)) lines.push(`# ${k}: ${v}`)
  lines.push(opts.columns.map((c) => escapeCell(c.label)).join(','))
  for (const row of opts.rows) {
    lines.push(opts.columns.map((c) => escapeCell(row[c.key])).join(','))
  }
  return lines.join('\n')
}

const sanitize = (s: string): string => s.replaceAll(/[^A-Za-z0-9_.-]+/g, '-')

export function csvFilename(
  country: string,
  asset: string,
  period: string,
): string {
  return `capital-atlas_${sanitize(country)}_${sanitize(asset)}_${sanitize(period)}.csv`
}

// ------------------------------------------------------------- DOM glue ----

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // 다음 틱에 해제 — 일부 브라우저에서 즉시 revoke 시 다운로드 취소됨
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function downloadCsv(filename: string, csv: string): void {
  downloadBlob(
    filename,
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  )
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('chart image decode failed'))
    img.src = src
  })

/** 이미지 아래에 타이틀+출처 표기 스트립을 합성해 PNG 다운로드. */
async function composeWithAttribution(
  img: HTMLImageElement,
  drawW: number,
  drawH: number,
  opts: { filename: string; title: string; attribution: string },
): Promise<void> {
  const ink = rgbVar('--color-ink-0')
  const pad = 24
  const strip = 56
  const canvas = document.createElement('canvas')
  canvas.width = drawW
  canvas.height = drawH + strip + pad
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = rgbaCss(ink, 1)
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, drawW, drawH)
  ctx.font = '600 18px "Spline Sans Mono Variable", monospace'
  ctx.fillStyle = rgbaCss(rgbVar('--color-paper'), 0.9)
  ctx.fillText(opts.title, pad, drawH + 22)
  ctx.font = '16px "Spline Sans Mono Variable", monospace'
  ctx.fillStyle = rgbaCss(rgbVar('--color-paper-dim'), 0.9)
  ctx.fillText(opts.attribution, pad, drawH + 46)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  if (blob) downloadBlob(opts.filename, blob)
}

/**
 * ECharts 캔버스 → 출처 표기 스트립 합성 PNG.
 * (DOM/캔버스 의존 — 단위 테스트 대신 playwright에서 실검증)
 */
export async function exportEchartsPng(
  chart: { getDataURL: (o: object) => string },
  opts: { filename: string; title: string; attribution: string },
): Promise<void> {
  const url = chart.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: rgbaCss(rgbVar('--color-ink-0'), 1),
  })
  const img = await loadImage(url)
  await composeWithAttribution(img, img.width, img.height, opts)
}

/** 자체 조립 SVG 마크업 → PNG (SYNOPTIC 지진계처럼 DOM SVG 뱅크인 차트용). */
export async function exportSvgPng(
  svgMarkup: string,
  width: number,
  height: number,
  opts: { filename: string; title: string; attribution: string },
): Promise<void> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${rgbaCss(rgbVar('--color-ink-0'), 1)}"/>` +
    svgMarkup +
    '</svg>'
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = await loadImage(url)
  await composeWithAttribution(img, width, height, opts)
}
