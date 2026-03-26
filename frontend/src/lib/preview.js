export function detectPreviewType(filename = '', mime = '', sourceName = '') {
  const candidates = [filename, sourceName, mime].filter(Boolean).join(' ').toLowerCase()

  if (/\bapplication\/pdf\b/.test(candidates) || /\.pdf\b/.test(candidates)) return 'pdf'
  if (
    /\bapplication\/vnd\.ms-excel\b/.test(candidates) ||
    /\bspreadsheetml\b/.test(candidates) ||
    /\.xlsx\b/.test(candidates) ||
    /\.xls\b/.test(candidates)
  ) return 'excel'
  if (
    /\bapplication\/msword\b/.test(candidates) ||
    /\bwordprocessingml\b/.test(candidates) ||
    /\.docx\b/.test(candidates) ||
    /\.doc\b/.test(candidates)
  ) return 'word'

  return 'text'
}

export function previewTypeLabel(fileType) {
  if (fileType === 'pdf') return 'PDF 文档'
  if (fileType === 'excel') return 'Excel 表格'
  if (fileType === 'word') return 'Word 文档'
  return '暂不支持预览'
}
