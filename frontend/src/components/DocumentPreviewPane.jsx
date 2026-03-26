import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import { displayFilename } from '../lib/filenames'

export default function DocumentPreviewPane({ document, previewSource }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [html, setHtml] = useState('')
  const [sheets, setSheets] = useState([])
  const [activeSheet, setActiveSheet] = useState('')

  const fileType = useMemo(() => detectFileType(document?.file_name, previewSource?.mime), [document?.file_name, previewSource?.mime])

  useEffect(() => {
    let cancelled = false

    async function loadPreview() {
      setError('')
      setHtml('')
      setSheets([])
      setActiveSheet('')

      if (!document || !previewSource || fileType === 'pdf') return

      try {
        setLoading(true)
        const buffer = await readArrayBuffer(previewSource)
        if (cancelled) return

        if (fileType === 'excel') {
          const workbook = XLSX.read(buffer, { type: 'array' })
          const nextSheets = workbook.SheetNames.map((name) => ({
            name,
            html: XLSX.utils.sheet_to_html(workbook.Sheets[name], { editable: false })
          }))
          setSheets(nextSheets)
          setActiveSheet(nextSheets[0]?.name || '')
          return
        }

        if (fileType === 'word') {
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
          if (!cancelled) {
            setHtml(result.value || '<p>文档内容为空</p>')
          }
        }
      } catch (previewError) {
        if (!cancelled) setError(previewError.message || '预览生成失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPreview()

    return () => {
      cancelled = true
    }
  }, [document, previewSource, fileType])

  if (!document) {
    return (
      <section className="panel preview-panel">
        <div className="panel-header">
          <h3>原始文件预览</h3>
          <span>未选择文件</span>
        </div>
        <p className="muted">先上传文件或加载样例包，再选择一份文档查看原始内容。</p>
      </section>
    )
  }

  const activeSheetHtml = sheets.find((sheet) => sheet.name === activeSheet)?.html

  return (
    <section className="panel preview-panel">
      <div className="panel-header">
        <h3>原始文件预览</h3>
        <span>{labelForType(fileType)}</span>
      </div>

      <div className="preview-file-name">{displayFilename(document.file_name)}</div>

      {fileType === 'pdf' && previewSource?.url && (
        <object className="file-frame" data={previewSource.url} type="application/pdf" aria-label={displayFilename(document.file_name)}>
          <iframe className="file-frame" src={previewSource.url} title={displayFilename(document.file_name)} />
        </object>
      )}

      {fileType === 'excel' && (
        <>
          {loading && <p className="muted">正在生成 Excel 预览...</p>}
          {sheets.length > 0 && (
            <>
              <div className="sheet-tabs">
                {sheets.map((sheet) => (
                  <button
                    key={sheet.name}
                    className={`sheet-tab ${sheet.name === activeSheet ? 'sheet-tab-active' : ''}`}
                    onClick={() => setActiveSheet(sheet.name)}
                  >
                    {sheet.name}
                  </button>
                ))}
              </div>
              <div className="excel-preview" dangerouslySetInnerHTML={{ __html: activeSheetHtml }} />
            </>
          )}
        </>
      )}

      {fileType === 'word' && (
        <>
          {loading && <p className="muted">正在生成 Word 预览...</p>}
          {!loading && html && <div className="word-preview" dangerouslySetInnerHTML={{ __html: html }} />}
        </>
      )}

      {!loading && error && <p className="error-inline">{error}</p>}
      {!loading && !error && (fileType === 'text' || !previewSource) && (
        <div className="preview-empty-state">
          <strong>当前文件暂不支持真实预览</strong>
          <p className="muted">
            {previewSource ? '该文件类型暂不提供原始页面预览。' : '当前样例文件无法访问原始二进制内容。'}
          </p>
        </div>
      )}
    </section>
  )
}

async function readArrayBuffer(previewSource) {
  if (previewSource.file) return previewSource.file.arrayBuffer()
  const response = await fetch(previewSource.url)
  if (!response.ok) throw new Error('加载原始文件失败')
  return response.arrayBuffer()
}

function detectFileType(filename = '', mime = '') {
  const lower = String(filename).toLowerCase()
  if (mime.includes('pdf') || lower.endsWith('.pdf')) return 'pdf'
  if (mime.includes('sheet') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel'
  if (mime.includes('word') || lower.endsWith('.docx') || lower.endsWith('.doc')) return 'word'
  return 'text'
}

function labelForType(fileType) {
  if (fileType === 'pdf') return 'PDF 文档'
  if (fileType === 'excel') return 'Excel 表格'
  if (fileType === 'word') return 'Word 文档'
  return '暂不支持预览'
}
