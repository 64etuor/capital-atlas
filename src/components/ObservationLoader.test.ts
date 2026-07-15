import { createElement } from 'react'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

describe('ObservationLoader', () => {
  it('announces loading and renders the orbital instrument', async () => {
    const { ObservationLoader } = await import('./ObservationLoader')
    const html = renderToStaticMarkup(
      createElement(ObservationLoader, {
        label: 'PREPARING OBSERVATION',
        detail: 'SYNCING SHARDS',
      }),
    )

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('data-loader-orbit="outer"')
    expect(html).toContain('data-loader-orbit="inner"')
    expect(html).toContain('PREPARING OBSERVATION')
    expect(html).toContain('SYNCING SHARDS')
  })

  it.each(['compact', 'inline'] as const)(
    'renders the %s affordance without changing status semantics',
    async (variant) => {
      const { ObservationLoader } = await import('./ObservationLoader')
      const Loader = ObservationLoader as ComponentType<
        Record<string, unknown>
      >
      const html = renderToStaticMarkup(
        createElement(Loader, { variant, label: 'CALIBRATING' }),
      )

      expect(html).toContain('role="status"')
      expect(html).toContain(`data-loader-variant="${variant}"`)
      expect(html).toContain(`observation-loader--${variant}`)
    },
  )
})
