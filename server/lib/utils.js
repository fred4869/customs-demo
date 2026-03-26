import path from 'node:path'

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function toFileId(name, index = 0) {
  return `${index + 1}-${name}`.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase()
}

export function extname(filename = '') {
  return path.extname(filename).toLowerCase()
}

export function normalizeWhitespace(value = '') {
  return String(value).replace(/[\s ]+/g, ' ').trim()
}

export function normalizeKey(value = '') {
  return normalizeWhitespace(value).toLowerCase()
}

export function firstTruthy(values = []) {
  return values.find(Boolean) ?? null
}

export function uniqBy(items, getKey) {
  const seen = new Set()
  return items.filter((item) => {
    const key = getKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/(?<=\d)\.(?=\d{3}(\D|$))/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '')
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

export function detectCurrency(value = '') {
  const text = normalizeKey(value)
  if (/(\busd\b|美元)/.test(text)) return 'USD'
  if (/(\beur\b|欧元)/.test(text)) return 'EUR'
  if (/(\bcny\b|人民币|rmb)/.test(text)) return 'CNY'
  return null
}

export function normalizeUnit(value = '') {
  const text = normalizeKey(value)
  if (!text) return null
  if (/(pcs|piece|件|个)/.test(text)) return 'PCS'
  if (/(kg|kgs|千克|公斤)/.test(text)) return 'KGS'
  if (/(set|套)/.test(text)) return 'SET'
  return String(value).trim().toUpperCase()
}

export function maybeCountry(value = '') {
  const text = normalizeWhitespace(value)
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower.includes('france')) return 'FRANCE'
  if (lower.includes('china')) return 'CHINA'
  if (lower.includes('united states') || lower === 'us' || lower === 'usa') return 'UNITED STATES'
  if (/[法]/.test(text)) return 'FRANCE'
  if (/[中]/.test(text)) return 'CHINA'
  return text.toUpperCase()
}

export function round2(value) {
  return value === null || value === undefined ? null : Math.round(value * 100) / 100
}
