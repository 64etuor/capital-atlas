const REEL = '0123456789'

/**
 * 오도미터 롤 (DESIGN.md §4 — 수치 변경은 자리수별 상하 롤).
 * Digits ride a vertical reel; punctuation and units stay put.
 */
export function Odometer({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <span className={`odo ${className ?? ''}`} aria-label={text} role="text">
      {Array.from(text).map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="odo-digit" aria-hidden="true">
            <span
              className="odo-reel"
              style={{ transform: `translateY(-${Number(ch)}em)` }}
            >
              {Array.from(REEL).map((d) => (
                <span key={d} className="odo-cell">
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={i} aria-hidden="true">
            {ch}
          </span>
        ),
      )}
    </span>
  )
}
