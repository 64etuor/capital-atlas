/**
 * meta/sources.json builder — the published registry is always derived from
 * SOURCE_REGISTRY (scripts/fetch/registry.ts, the SSOT). Standalone runs
 * (`pnpm data:sources`) preserve each source's previous retrieved_at so the
 * classification can be re-published without refetching anything.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'
import { SOURCE_REGISTRY } from '../fetch/registry.ts'

interface SourceStampOptions {
  stampAll?: string
  preserveSourceIds?: readonly string[]
}

export function resolveRetrievedAt(
  sourceId: string,
  previous: ReadonlyMap<string, string>,
  opts: SourceStampOptions,
  now: string,
): string {
  if (opts.preserveSourceIds?.includes(sourceId))
    return previous.get(sourceId) ?? now
  return opts.stampAll ?? previous.get(sourceId) ?? now
}

export function writeSourcesJson(
  opts: SourceStampOptions = {},
): void {
  const path = join(OUT_DIR, 'meta', 'sources.json')
  const prev = new Map<string, string>()
  if (existsSync(path)) {
    const entries = JSON.parse(readFileSync(path, 'utf8')) as Array<{
      source_id: string
      retrieved_at?: string
    }>
    for (const e of entries) {
      if (e.retrieved_at) prev.set(e.source_id, e.retrieved_at)
    }
  }
  const now = new Date().toISOString()
  writeJson(
    'meta/sources.json',
    SOURCE_REGISTRY.map((def) => ({
      ...def,
      retrieved_at: resolveRetrievedAt(def.source_id, prev, opts, now),
    })),
  )
}

// CLI: pnpm data:sources — republish classification, keep retrieved_at
if (process.argv[1]?.endsWith('sources.ts')) {
  writeSourcesJson()
  console.log(`[sources] meta/sources.json ← ${SOURCE_REGISTRY.length} sources (SSOT)`)
}
