/**
 * Great-circle particle arcs for bilateral flows — the signature layer.
 * DESIGN.md §6: observed = continuous particle stream, derived = dashed,
 * modelled = sparse + fog. Encoded here as trail-length / density classes;
 * MapCanvas maps classes to TripsLayer configs.
 */
import type { BilateralRecord, CountryMaster } from '../../types/data'
import { OBSERVED_GRADES, logScale } from './aggregate'

export type GradeClass = 'obs' | 'derived' | 'model'

export interface FlowArc {
  key: string
  path: [number, number, number][]
  timestamps: number[]
  gradeClass: GradeClass
  /** 0..1 within the current arc set (log-scaled |value|) */
  intensity: number
  /** capital arriving at the selected country (or at issuer in global view) */
  inbound: boolean
  record: BilateralRecord
}

/** abstract time units per animation loop (currentTime wraps at this) */
export const ARC_LOOP = 40

const EARTH_R = 6.371e6
const PATH_STEPS = 32

function gradeClass(record: BilateralRecord): GradeClass {
  if (OBSERVED_GRADES.has(record.confidence_grade)) return 'obs'
  return record.confidence_grade === 'C' ? 'derived' : 'model'
}

type Vec3 = [number, number, number]

function toVec([lon, lat]: [number, number]): Vec3 {
  const φ = (lat * Math.PI) / 180
  const λ = (lon * Math.PI) / 180
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)]
}

function toLonLat([x, y, z]: Vec3): [number, number] {
  return [
    (Math.atan2(y, x) * 180) / Math.PI,
    (Math.asin(Math.min(Math.max(z, -1), 1)) * 180) / Math.PI,
  ]
}

/** deterministic 0..1 phase from the record key (no Math.random — stable) */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function greatCirclePath(
  from: [number, number],
  to: [number, number],
): { path: [number, number, number][]; fracs: number[] } | null {
  const a = toVec(from)
  const b = toVec(to)
  const dot = Math.min(
    Math.max(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1),
    1,
  )
  const ω = Math.acos(dot)
  if (ω < 1e-6) return null
  const sinω = Math.sin(ω)
  // hug the surface like wind — high arcs read as rings, not weather
  const height = Math.min(Math.max(ω * EARTH_R * 0.045, 45_000), 520_000)
  const path: [number, number, number][] = []
  const fracs: number[] = []
  for (let i = 0; i <= PATH_STEPS; i += 1) {
    const t = i / PATH_STEPS
    const s0 = Math.sin((1 - t) * ω) / sinω
    const s1 = Math.sin(t * ω) / sinω
    const [lon, lat] = toLonLat([
      s0 * a[0] + s1 * b[0],
      s0 * a[1] + s1 * b[1],
      s0 * a[2] + s1 * b[2],
    ])
    path.push([lon, lat, Math.sin(Math.PI * t) * height])
    fracs.push(t)
  }
  return { path, fracs }
}

export interface BuildArcsOptions {
  /** ISO3 of the selected country, or null for the global view */
  selected: string | null
  /** true → use CPIS positions (grade A); false → derived flows (grade D) */
  useStockMeasure: boolean
  includeEstimates: boolean
  capGlobal?: number
  capSelected?: number
}

export function buildArcs(
  records: readonly BilateralRecord[],
  countries: ReadonlyMap<string, CountryMaster>,
  {
    selected,
    useStockMeasure,
    includeEstimates,
    capGlobal = 420,
    capSelected = 220,
  }: BuildArcsOptions,
): FlowArc[] {
  const wanted = useStockMeasure ? 'stock' : 'flow'
  let recs = records.filter(
    (r) =>
      r.measure === wanted &&
      (includeEstimates || OBSERVED_GRADES.has(r.confidence_grade)),
  )
  if (selected) {
    recs = recs.filter(
      (r) => r.owner_country === selected || r.issuer_country === selected,
    )
  }
  recs.sort((x, y) => Math.abs(y.value_usd) - Math.abs(x.value_usd))
  recs = recs.slice(0, selected ? capSelected : capGlobal)

  const scale = logScale(recs.map((r) => Math.abs(r.value_usd)))
  const arcs: FlowArc[] = []

  for (const r of recs) {
    // negative derived flow = net disinvestment → capital travels back
    const reversed = !useStockMeasure && r.value_usd < 0
    const fromIso = reversed ? r.issuer_country : r.owner_country
    const toIso = reversed ? r.owner_country : r.issuer_country
    const from = countries.get(fromIso)
    const to = countries.get(toIso)
    if (!from || !to) continue
    const gc = greatCirclePath(from.centroid, to.centroid)
    if (!gc) continue

    const key = `${r.owner_country}-${r.issuer_country}-${r.asset}-${r.measure}`
    const intensity = scale(Math.abs(r.value_usd))
    const cls = gradeClass(r)
    const duration = ARC_LOOP * (0.85 - 0.45 * intensity) // bigger → faster
    const copies = cls === 'obs' ? 2 : 1 // continuous stream needs overlap

    // keep timestamps within [0, ARC_LOOP] so heads always fire each loop
    const phaseRoom = Math.max(ARC_LOOP - duration, 0.01)
    for (let c = 0; c < copies; c += 1) {
      const phase = ((hash01(key) + c / copies) % 1) * phaseRoom
      arcs.push({
        key: c === 0 ? key : `${key}~${c}`,
        path: gc.path,
        timestamps: gc.fracs.map((f) => phase + f * duration),
        gradeClass: cls,
        intensity,
        inbound: selected ? toIso === selected : true,
        record: r,
      })
    }
  }
  return arcs
}
