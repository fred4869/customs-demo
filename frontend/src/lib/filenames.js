export function displayFilename(value = '') {
  const base = normalizeVisibleWhitespace(tryDecodeMojibake(String(value)))
  return base || '-'
}

function normalizeVisibleWhitespace(value = '') {
  return String(value)
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tryDecodeMojibake(value = '') {
  if (!/[ÃÂÐÑ]/.test(value)) return value

  try {
    const bytes = Uint8Array.from([...value].map((char) => char.charCodeAt(0) & 0xff))
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return scoreReadable(decoded) > scoreReadable(value) ? decoded : value
  } catch {
    return value
  }
}

function scoreReadable(value = '') {
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (value.match(/[A-Za-z0-9._()\- ]/g) || []).length
  const mojibake = (value.match(/[ÃÂÐÑ]/g) || []).length
  return cjk * 5 + latin - mojibake * 3
}
