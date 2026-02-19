import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const dashboard = readFileSync(resolve(root, 'weather-dashboard.html'), 'utf-8')
const index = readFileSync(resolve(root, 'index.html'), 'utf-8')

describe('weather-dashboard', () => {
  it('index.html and weather-dashboard.html are identical', () => {
    expect(index).toBe(dashboard)
  })

  it.each(['Berlin', '8&deg;C', 'Cloudy'])('contains %s', (text) => {
    expect(dashboard).toContain(text)
  })
})
