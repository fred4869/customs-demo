export function isReadableSnippet(value = '') {
  const text = String(value || '').trim()
  if (!text) return false

  const sample = text.slice(0, 1200)
  const replacementChars = (sample.match(/[�]/g) || []).length
  if (replacementChars > sample.length * 0.01) return false

  const mojibakeChars = (sample.match(/[ÃÂÐÑÈÊËÌÍÎÏÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length
  if (mojibakeChars > sample.length * 0.01) return false

  if (/%PDF-\d\.\d/.test(sample)) return false
  if ((sample.match(/_{20,}/g) || []).length >= 1) return false

  const visibleChars = (sample.match(/[\u4e00-\u9fffA-Za-z0-9，。、“”‘’：；！？,.:'"()\-/%$#@&\s]/g) || []).length
  return visibleChars / sample.length >= 0.8
}

export function toDisplaySnippet(value = '', fallback = '当前不展示文本摘要，请以上方原始文件预览为准。') {
  return isReadableSnippet(value) ? value : fallback
}
