/**
 * data:changed (Phase N) — 주간 크론의 커밋 게이트.
 * public/data 워킹트리 변경을 HEAD와 대조해 세 갈래로 분류한다:
 *   substantive     실질 데이터 변경 → 커밋·배포 가치 있음
 *   timestamp-only  index.generated_at / sources.retrieved_at만 변경
 *   metadata        pipeline_report·global_crypto (단독으로는 비실질)
 * 실질 변경이 없으면 워크플로가 커밋을 생략한다(레포·배포 churn 0).
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT_DIR, REPO_ROOT } from '../fetch/lib.ts'

export type ChangeClass = 'substantive' | 'timestamp-only' | 'metadata'

export interface FileChange {
  /** public/data/ 기준 상대 경로 */
  path: string
  /** HEAD 버전 원문 (신규 파일이면 null) */
  head: string | null
  /** 워킹트리 버전 원문 (삭제면 null) */
  work: string | null
}

/** 단독으로는 커밋 가치가 없는 파생 메타데이터 */
const METADATA_PATHS = new Set([
  'meta/pipeline_report.json',
  'meta/global_crypto.json',
])

const parse = (s: string | null): unknown | undefined => {
  if (s === null) return undefined
  try {
    return JSON.parse(s) as unknown
  } catch {
    return undefined // 파싱 불가 → 호출부가 실질로 승격
  }
}

const omitKey = (v: unknown, key: string): unknown => {
  if (typeof v !== 'object' || v === null) return v
  const rest = { ...(v as Record<string, unknown>) }
  delete rest[key]
  return rest
}

const stripIndexTimestamp = (v: unknown): unknown => omitKey(v, 'generated_at')

const stripRetrievedAt = (v: unknown): unknown =>
  Array.isArray(v) ? v.map((e) => omitKey(e, 'retrieved_at')) : v

export function classifyChange(c: FileChange): ChangeClass {
  if (METADATA_PATHS.has(c.path)) return 'metadata'
  const strip =
    c.path === 'index.json'
      ? stripIndexTimestamp
      : c.path === 'meta/sources.json'
        ? stripRetrievedAt
        : null
  if (!strip) return 'substantive'
  const head = parse(c.head)
  const work = parse(c.work)
  if (head === undefined || work === undefined) return 'substantive'
  return JSON.stringify(strip(head)) === JSON.stringify(strip(work))
    ? 'timestamp-only'
    : 'substantive'
}

export function classifyAll(changes: FileChange[]): {
  substantive: string[]
  timestampOnly: string[]
  metadata: string[]
} {
  const out = {
    substantive: [] as string[],
    timestampOnly: [] as string[],
    metadata: [] as string[],
  }
  for (const c of changes) {
    const cls = classifyChange(c)
    if (cls === 'substantive') out.substantive.push(c.path)
    else if (cls === 'timestamp-only') out.timestampOnly.push(c.path)
    else out.metadata.push(c.path)
  }
  return out
}

// ------------------------------------------------------------------ CLI ----

function gitChangedPaths(): string[] {
  // execFileSync + 인자 배열 — 셸 미개입(파일명 메타문자 인젝션 차단).
  // -uall: 미추적 디렉터리를 개별 파일로 전개(디렉터리 경로 EISDIR 방지)
  const raw = execFileSync(
    'git',
    ['status', '--porcelain=v1', '-uall', '--', 'public/data'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((p) => p.startsWith('public/data/'))
    .map((p) => p.slice('public/data/'.length))
}

function headVersion(rel: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:public/data/${rel}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null // HEAD에 없음(신규)
  }
}

if (process.argv[1]?.endsWith('changed.ts')) {
  const changes: FileChange[] = gitChangedPaths().map((rel) => {
    const abs = join(OUT_DIR, rel)
    return {
      path: rel,
      head: headVersion(rel),
      work: existsSync(abs) ? readFileSync(abs, 'utf8') : null,
    }
  })
  const r = classifyAll(changes)
  const substantive = r.substantive.length > 0
  console.log(
    `[changed] substantive=${substantive} ` +
      `(${r.substantive.length} substantive, ${r.timestampOnly.length} timestamp-only, ${r.metadata.length} metadata)`,
  )
  for (const p of r.substantive.slice(0, 20)) console.log(`  S ${p}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `substantive=${substantive}\n`)
  }
}
