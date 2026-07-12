/**
 * Build public/data/countries_geo.json — Natural Earth 110m country polygons
 * (world-atlas TopoJSON) joined to ISO3 via world-countries numeric codes.
 *
 * Runs offline (both inputs are npm packages). Features that cannot be mapped
 * to ISO3 keep iso3=null and render as no-data landmass.
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'

const require = createRequire(import.meta.url)

interface WorldCountry {
  cca3: string
  ccn3?: string
  name: { common: string }
}

const topo = require('world-atlas/countries-110m.json') as Topology
const wc = require('world-countries') as WorldCountry[]

const byNumeric = new Map<string, WorldCountry>()
for (const c of wc) {
  if (c.ccn3) byNumeric.set(c.ccn3.padStart(3, '0'), c)
}

const countries = topo.objects.countries as GeometryCollection<{
  name?: string
}>
const fc = feature(topo, countries)

let matched = 0
const features = fc.features.map((f) => {
  const id = typeof f.id === 'number' ? String(f.id).padStart(3, '0') : f.id
  const hit = id ? byNumeric.get(String(id)) : undefined
  if (hit) matched += 1
  return {
    type: 'Feature' as const,
    geometry: f.geometry,
    properties: {
      iso3: hit?.cca3 ?? null,
      name: hit?.name.common ?? f.properties?.name ?? 'Unknown',
    },
  }
})

const out = { type: 'FeatureCollection' as const, features }
writeFileSync('public/data/countries_geo.json', JSON.stringify(out))
console.log(
  `countries_geo.json: ${features.length} features, ${matched} ISO3-matched, ${(
    JSON.stringify(out).length / 1024
  ).toFixed(0)} KiB`,
)
