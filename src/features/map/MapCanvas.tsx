import { useEffect, useRef, useState } from 'react'
import {
  DeckGL,
  _GlobeView as GlobeView,
  LinearInterpolator,
  GeoJsonLayer,
  PathLayer,
  SolidPolygonLayer,
  TripsLayer,
} from 'deck.gl'
import type { GlobeViewState, Layer, PickingInfo } from 'deck.gl'
import type { FeatureCollection } from 'geojson'
import { useViewStore } from '../../store/viewStore'
import { periodFromIndex } from '../../lib/periods'
import {
  getBilateral,
  getCountries,
  getFlowsCountry,
  getGeometry,
  getIndex,
  getStocks,
  nearestAvailable,
  type CountriesGeo,
  type CountryFeatureProps,
} from '../../lib/dataClient'
import type {
  CountryMaster,
  PeriodIndexFile,
  PeriodKey,
} from '../../types/data'
import {
  logScale,
  summarizeFlows,
  summarizeStocks,
  type CountryReading,
} from './aggregate'
import { ARC_LOOP, buildArcs, type FlowArc, type GradeClass } from './arcs'
import { lerpRgb, pressureColor, rgbVar } from '../../lib/tokens'
import { formatUsd, formatUsdNet } from '../../lib/format'

/**
 * BAROMETER data canvas — deck.gl globe. Pressure choropleth (stocks),
 * particle wind (bilateral flows), fog for estimates (DESIGN.md §2/§6),
 * load sequence §4. Owns everything inside the viewport; reads useViewStore,
 * reports picks via selectCountry.
 */

const GLOBE_VIEW = new GlobeView({ id: 'globe' })
const FLY = new LinearInterpolator(['longitude', 'latitude', 'zoom'])

const INITIAL_VIEW: GlobeViewState = {
  longitude: -32,
  latitude: 26,
  zoom: 1.42,
  minZoom: 0.3,
  maxZoom: 4,
}

const REDUCED_MOTION =
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

/** faint observatory graticule (30° grid) */
const GRATICULE: [number, number][][] = (() => {
  const paths: [number, number][][] = []
  for (let lon = -180; lon < 180; lon += 30) {
    const p: [number, number][] = []
    for (let lat = -88; lat <= 88; lat += 4) p.push([lon, lat])
    paths.push(p)
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const p: [number, number][] = []
    for (let lon = -180; lon <= 180; lon += 5) p.push([lon, lat])
    paths.push(p)
  }
  return paths
})()

/** representative longitude for the coastline sweep reveal */
function firstLon(geometry: unknown): number {
  const g = geometry as { type?: string; coordinates?: unknown }
  try {
    if (g.type === 'Polygon') {
      return (g.coordinates as number[][][])[0][0][0]
    }
    if (g.type === 'MultiPolygon') {
      return (g.coordinates as number[][][][])[0][0][0][0]
    }
  } catch {
    /* fall through */
  }
  return 0
}

function smoothstep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  return x * x * (3 - 2 * x)
}

interface BaseData {
  geo: CountriesGeo
  countries: Map<string, CountryMaster>
  index: PeriodIndexFile
}

interface ChoroState {
  key: string
  readings: Map<string, CountryReading>
  scale: (v: number) => number
  effPeriod: PeriodKey | null
  noData: boolean
}

interface ArcState {
  key: string
  arcs: FlowArc[]
  effPeriod: PeriodKey | null
}

interface HoverState {
  x: number
  y: number
  name: string
  lines: string[]
}

const TRIP_CLASSES: Record<
  GradeClass,
  { trail: number; alpha: number; widthMul: number; dim: number }
> = {
  obs: { trail: 0.5 * ARC_LOOP, alpha: 235, widthMul: 1, dim: 0.95 },
  derived: { trail: 0.17 * ARC_LOOP, alpha: 205, widthMul: 0.9, dim: 0.85 },
  model: { trail: 0.075 * ARC_LOOP, alpha: 150, widthMul: 0.8, dim: 0.6 },
}

export function MapCanvas() {
  const basis = useViewStore((s) => s.basis)
  const measure = useViewStore((s) => s.measure)
  const includeEstimates = useViewStore((s) => s.includeEstimates)
  const periodIndex = useViewStore((s) => s.periodIndex)
  const selectedCountry = useViewStore((s) => s.selectedCountry)
  const selectCountry = useViewStore((s) => s.selectCountry)

  const [viewState, setViewState] = useState<GlobeViewState>(INITIAL_VIEW)
  const [clockMs, setClockMs] = useState(0)
  const [base, setBase] = useState<BaseData | null>(null)
  const [choro, setChoro] = useState<ChoroState | null>(null)
  const [arcState, setArcState] = useState<ArcState | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const interactedRef = useRef(false)
  const clockRef = useRef(0)
  const [seqStart, setSeqStart] = useState<number | null>(null)

  const period = periodFromIndex(periodIndex)
  const choroKey = `${basis}|${measure}|${period}|${includeEstimates}`
  const arcKey = `${period}|${selectedCountry ?? '*'}|${measure}|${includeEstimates}`

  // ── base datasets (geometry + country master + period index) ─────────────
  useEffect(() => {
    let alive = true
    Promise.all([getGeometry(), getCountries(), getIndex()])
      .then(([geo, countries, index]) => {
        if (!alive) return
        // annotate representative longitude once for the sweep reveal
        for (const f of geo.features) {
          f.properties.lon = firstLon(f.geometry)
        }
        setBase({ geo, countries, index })
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  // ── choropleth readings for the current instrument state ────────────────
  useEffect(() => {
    if (!base) return
    let alive = true
    const { index } = base
    const commit = (s: Omit<ChoroState, 'key'>) => {
      if (alive) setChoro({ key: choroKey, ...s })
    }
    const empty = {
      readings: new Map<string, CountryReading>(),
      scale: () => 0,
    }
    async function load() {
      if (measure === 'turnover') {
        // v1 has no turnover observations — honest empty canvas, no fake fill
        commit({ ...empty, effPeriod: null, noData: true })
        return
      }
      if (measure === 'stock') {
        const eff = nearestAvailable(index.periods[`stocks_${basis}`], period)
        if (!eff) {
          commit({ ...empty, effPeriod: null, noData: false })
          return
        }
        const file = await getStocks(basis, eff)
        const readings = summarizeStocks(file.records, includeEstimates)
        commit({
          readings,
          scale: logScale([...readings.values()].map((r) => r.value)),
          effPeriod: eff,
          noData: false,
        })
        return
      }
      const eff = nearestAvailable(index.periods.flows_country, period)
      if (!eff) {
        commit({ ...empty, effPeriod: null, noData: false })
        return
      }
      const file = await getFlowsCountry(eff)
      const readings = summarizeFlows(file.records, measure, includeEstimates)
      commit({
        readings,
        scale: logScale([...readings.values()].map((r) => r.value)),
        effPeriod: eff,
        noData: false,
      })
    }
    load().catch((err: unknown) => {
      if (alive) setLoadError(String(err))
    })
    return () => {
      alive = false
    }
  }, [base, basis, measure, period, includeEstimates, choroKey])

  // ── bilateral arcs (particle wind) ───────────────────────────────────────
  useEffect(() => {
    if (!base) return
    let alive = true
    const data = base
    async function load() {
      const eff = nearestAvailable(data.index.periods.flows_bilateral, period)
      if (!eff) {
        if (alive) setArcState({ key: arcKey, arcs: [], effPeriod: null })
        return
      }
      const file = await getBilateral(eff)
      if (!alive) return
      const arcs = buildArcs(file.records, data.countries, {
        selected: selectedCountry,
        useStockMeasure: measure === 'stock',
        includeEstimates,
      })
      setArcState({ key: arcKey, arcs, effPeriod: eff })
    }
    load().catch((err: unknown) => {
      if (alive) setLoadError(String(err))
    })
    return () => {
      alive = false
    }
  }, [base, period, selectedCountry, measure, includeEstimates, arcKey])

  // ── clock: particles + idle rotation (§1.3 — the map never freezes) ─────
  useEffect(() => {
    if (REDUCED_MOTION) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = now - t0
      clockRef.current = t
      setClockMs(t)
      if (!interactedRef.current && !useViewStore.getState().selectedCountry) {
        setViewState((vs) => ({
          ...vs,
          longitude: ((vs.longitude + 0.0115 + 540) % 360) - 180,
          transitionDuration: 0,
          transitionInterpolator: undefined,
        }))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // camera glide to a picked country (called from the click handler)
  const flyTo = (c: CountryMaster) => {
    setViewState((vs) => ({
      ...vs,
      longitude: c.centroid[0],
      latitude: c.centroid[1],
      zoom: Math.max(vs.zoom ?? 0.9, 1.35),
      transitionDuration: 1100,
      transitionInterpolator: FLY,
    }))
  }

  const ready = base !== null && choro !== null

  // anchor the load sequence to the first ready frame
  useEffect(() => {
    if (ready) {
      setSeqStart((prev) => (prev === null ? clockRef.current : prev))
    }
  }, [ready])

  const seqElapsed = ready && seqStart !== null ? clockMs - seqStart : 0
  const stage = (from: number, to: number) =>
    REDUCED_MOTION ? 1 : smoothstep((seqElapsed - from) / (to - from))
  const coastP = stage(150, 900)
  const fillP = stage(750, 1450)
  const particleP = stage(1350, 1750)

  const layers: Layer[] = []
  if (ready) {
    const { readings, scale, noData } = choro
    const inkRgb = rgbVar('--color-ink-1')
    const sphere = lerpRgb(rgbVar('--color-ink-1'), rgbVar('--color-ink-2'), 0.55)
    const landBase = lerpRgb(
      rgbVar('--color-ink-2'),
      rgbVar('--color-pressure-1'),
      0.4,
    )
    const coast = rgbVar('--color-pressure-2')
    const grat = rgbVar('--color-pressure-1')
    const amber = rgbVar('--color-flow-in')
    const cyan = rgbVar('--color-flow-out')
    const coastBucket = Math.round(coastP * 24)

    layers.push(
      new SolidPolygonLayer({
        id: 'globe-base',
        data: [
          [
            [-180, 90],
            [0, 90],
            [180, 90],
            [180, -90],
            [0, -90],
            [-180, -90],
          ] as [number, number][],
        ],
        getPolygon: (d: [number, number][]) => d,
        filled: true,
        stroked: false,
        getFillColor: [sphere[0], sphere[1], sphere[2], 255],
        pickable: false,
      }),
      new PathLayer({
        id: 'graticule',
        data: GRATICULE,
        getPath: (d: [number, number][]) => d,
        getColor: [grat[0], grat[1], grat[2], 66],
        widthMinPixels: 1,
        widthMaxPixels: 1,
        opacity: 0.5,
        pickable: false,
      }),
      new GeoJsonLayer<CountryFeatureProps>({
        id: 'countries-fill',
        data: base.geo as unknown as FeatureCollection,
        stroked: false,
        filled: true,
        opacity: 0.92 * fillP,
        getFillColor: (f) => {
          const iso3 = f.properties.iso3
          const r = iso3 ? readings.get(iso3) : undefined
          if (!r || noData) {
            return [landBase[0], landBase[1], landBase[2], 58]
          }
          const t = scale(r.value)
          const fogMix = Math.min(r.fog * 1.7, 0.75)
          const c = lerpRgb(pressureColor(t), inkRgb, fogMix)
          return [c[0], c[1], c[2], Math.round(232 * (1 - r.fog * 0.85))]
        },
        pickable: true,
        autoHighlight: true,
        highlightColor: [...rgbVar('--atlas-paper'), 26],
        onHover: (info: PickingInfo) => {
          const obj = info.object as {
            properties: CountryFeatureProps
          } | null
          if (!obj?.properties.iso3) {
            setHover(null)
            return
          }
          const iso3 = obj.properties.iso3
          const master = base.countries.get(iso3)
          const r = readings.get(iso3)
          const lines: string[] = []
          if (noData) {
            lines.push('NO TURNOVER OBSERVATIONS (V1)')
          } else if (!r) {
            lines.push(
              includeEstimates
                ? 'NO OBSERVATION'
                : 'NO OBSERVATION · OBS MODE',
            )
          } else if (measure === 'stock') {
            lines.push(`${formatUsd(r.value)} · GRADE ${r.grade}`)
          } else {
            lines.push(`GROSS ${formatUsd(r.value)} · GRADE ${r.grade}`)
            lines.push(`NET ${formatUsdNet(r.net ?? 0)}`)
          }
          if (choro.effPeriod && choro.effPeriod !== period) {
            lines.push(`OBS ${choro.effPeriod} (NEAREST)`)
          }
          setHover({
            x: info.x,
            y: info.y,
            name: master?.name ?? obj.properties.name,
            lines,
          })
        },
        onClick: (info: PickingInfo) => {
          const obj = info.object as {
            properties: CountryFeatureProps
          } | null
          const iso3 = obj?.properties.iso3
          if (!iso3) return
          selectCountry(iso3)
          const master = base.countries.get(iso3)
          if (master) flyTo(master)
        },
        updateTriggers: { getFillColor: [choro.key] },
      }),
      new GeoJsonLayer<CountryFeatureProps>({
        id: 'countries-coast',
        data: base.geo as unknown as FeatureCollection,
        stroked: true,
        filled: false,
        opacity: 0.85,
        lineWidthMinPixels: 0.7,
        lineWidthMaxPixels: 1.2,
        getLineColor: (f) => {
          const reveal =
            coastP >= 1
              ? 1
              : (f.properties.lon ?? 0) < -180 + 360 * coastP
                ? 1
                : 0
          return [coast[0], coast[1], coast[2], Math.round(190 * reveal)]
        },
        pickable: false,
        updateTriggers: { getLineColor: [coastBucket] },
      }),
    )

    if (arcState && arcState.arcs.length > 0) {
      layers.push(
        new PathLayer<FlowArc>({
          id: 'flow-routes',
          data: arcState.arcs,
          getPath: (a) => a.path,
          getColor: (a) => {
            const alpha =
              a.gradeClass === 'model'
                ? 13
                : a.gradeClass === 'derived'
                  ? 21
                  : 30
            return [cyan[0], cyan[1], cyan[2], alpha]
          },
          widthMinPixels: 1,
          widthMaxPixels: 1.5,
          opacity: particleP,
          pickable: false,
        }),
      )
      const currentTime = REDUCED_MOTION
        ? ARC_LOOP * 0.37
        : ((clockMs / 1000) * 4.0) % ARC_LOOP
      for (const cls of ['obs', 'derived', 'model'] as const) {
        const list = arcState.arcs.filter((a) => a.gradeClass === cls)
        if (list.length === 0) continue
        const cfg = TRIP_CLASSES[cls]
        layers.push(
          new TripsLayer<FlowArc>({
            id: `flow-particles-${cls}`,
            data: list,
            getPath: (a) => a.path,
            getTimestamps: (a) => a.timestamps,
            currentTime,
            trailLength: REDUCED_MOTION ? ARC_LOOP : cfg.trail,
            getColor: (a) => {
              const c = a.inbound ? amber : cyan
              return [c[0], c[1], c[2], cfg.alpha]
            },
            getWidth: (a) => (1.4 + a.intensity * 4.6) * cfg.widthMul,
            widthUnits: 'pixels',
            capRounded: true,
            jointRounded: true,
            fadeTrail: true,
            opacity: particleP * cfg.dim,
            pickable: false,
          }),
        )
      }
    }
  }

  const syncing = ready && choro.key !== choroKey
  const nearestNote =
    ready && choro.effPeriod && choro.effPeriod !== period
      ? choro.effPeriod
      : null

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* horizon glow — the atmosphere breathes even before data arrives */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 115%, color-mix(in srgb, var(--pressure-2) 26%, transparent) 0%, transparent 65%)',
        }}
      />

      {ready ? (
        <DeckGL
          views={GLOBE_VIEW}
          viewState={viewState}
          onViewStateChange={({ viewState: vs }) =>
            setViewState(vs as GlobeViewState)
          }
          onInteractionStateChange={(s) => {
            if (s.isDragging || s.isZooming || s.isPanning) {
              interactedRef.current = true
            }
          }}
          controller={{ inertia: 260 }}
          layers={layers}
          getCursor={({ isHovering, isDragging }) =>
            isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
          }
          onClick={(info: PickingInfo) => {
            if (!info.picked) selectCountry(null)
          }}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          {loadError ? (
            <>
              <p className="dial-label text-signal">OBSERVATION FAULT</p>
              <p className="readout max-w-md text-center text-[11px] text-paper-dim">
                {loadError}
              </p>
            </>
          ) : (
            <>
              <p className="dial-label text-paper-dim">
                PREPARING OBSERVATION
              </p>
              <p className="readout text-[11px] tracking-[0.12em] text-paper-dim/60">
                SYNCING SHARDS
              </p>
            </>
          )}
        </div>
      )}

      {/* honesty chips — nearest-shard + sync state (instrument language) */}
      <div className="pointer-events-none absolute bottom-24 left-6 z-10 space-y-1">
        {nearestNote && (
          <p className="readout text-[10px] tracking-[0.12em] text-paper-dim/80">
            NEAREST OBS {nearestNote}
          </p>
        )}
        {syncing && (
          <p className="readout text-[10px] tracking-[0.12em] text-flow-in/80">
            SYNCING OBSERVATION…
          </p>
        )}
      </div>

      {/* hover tooltip — mono readout, grade before beauty */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 border border-paper/15 bg-ink-0/90 px-2.5 py-1.5"
          style={{ left: hover.x + 14, top: hover.y + 10 }}
        >
          <p className="font-sans text-[12px] leading-tight text-paper">
            {hover.name}
          </p>
          {hover.lines.map((l) => (
            <p
              key={l}
              className="readout text-[10px] leading-snug tracking-[0.1em] text-paper-dim"
            >
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
