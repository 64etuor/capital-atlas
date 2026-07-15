interface MapLoadingKeys {
  ready: boolean
  requestedChoroKey: string
  loadedChoroKey: string | null
  requestedArcKey: string
  loadedArcKey: string | null
}

/** Keep the current globe visible while making stale shard state explicit. */
export function isMapSyncing({
  ready,
  requestedChoroKey,
  loadedChoroKey,
  requestedArcKey,
  loadedArcKey,
}: MapLoadingKeys): boolean {
  return (
    ready &&
    (loadedChoroKey !== requestedChoroKey || loadedArcKey !== requestedArcKey)
  )
}
