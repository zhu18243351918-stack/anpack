import { describe, expect, it } from 'vitest'
import { artworkPreviewStyle } from './artworkTransform'

const artwork = { url: 'data:image/png;base64,test', repeat: false, scale: 1, offsetX: 0, offsetY: 0, rotation: 0 }

describe('artwork preview fitting', () => {
  it('shows the complete artwork by default', () => {
    expect(artworkPreviewStyle(artwork)?.backgroundSize).toBe('contain')
  })

  it('only crops when cover mode is explicitly selected', () => {
    expect(artworkPreviewStyle({ ...artwork, fit: 'cover' })?.backgroundSize).toBe('cover')
  })
})
