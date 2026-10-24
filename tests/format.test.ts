import { describe, expect, it } from 'vitest'
import { orderValue, rupees } from '../lib/format'

describe('order value', () => {
  const rates = { SKU001: 12, SKU013: 114 }

  it('adds up quantity times purchase price', () => {
    expect(orderValue([{ skuId: 'SKU001', qty: 750 }, { skuId: 'SKU013', qty: 120 }], rates)).toBe(22680)
  })

  it('gives no total when any price is unknown, rather than a misleading partial one', () => {
    expect(orderValue([{ skuId: 'SKU001', qty: 10 }, { skuId: 'SKU999', qty: 5 }], rates)).toBe(null)
    expect(orderValue([{ skuId: 'SKU001', qty: 10 }], { SKU001: 0 })).toBe(null)
  })

  it('formats rupees the Indian way', () => {
    expect(rupees(22680)).toBe('₹22,680')
    expect(rupees(1234567)).toBe('₹12,34,567')
  })
})
