const FIELD_ORDER = [
  'country',
  'owner_country',
  'issuer_country',
  'asset',
  'period',
  'measure',
  'entry',
  'accounting_entry',
  'counterparty_scope',
  'sector',
  'source_id',
] as const

const priority = (field: string) => {
  const index = FIELD_ORDER.indexOf(field as (typeof FIELD_ORDER)[number])
  return index === -1 ? FIELD_ORDER.length : index
}

const canonicalRecordKey = (record: object): string =>
  Object.entries(record)
    .sort(([left], [right]) => {
      const byPriority = priority(left) - priority(right)
      if (byPriority !== 0) return byPriority
      return left < right ? -1 : left > right ? 1 : 0
    })
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(',')

/**
 * Normalize upstream response order before publishing byte-stable shards.
 * Code-unit comparison is intentional: localeCompare can vary with ICU data.
 */
export function sortRecordsDeterministically<T extends object>(
  records: readonly T[],
): T[] {
  return records
    .map((record) => ({ record, key: canonicalRecordKey(record) }))
    .sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    )
    .map(({ record }) => record)
}
