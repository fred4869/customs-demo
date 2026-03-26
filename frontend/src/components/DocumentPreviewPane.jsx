import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import { displayFilename } from '../lib/filenames'
import { detectPreviewType, previewTypeLabel } from '../lib/preview'

const EXCEL_MAX_ROWS = 80
const EXCEL_MAX_COLS = 14

export default function DocumentPreviewPane({ document, previewSource }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [html, setHtml] = useState('')
  const [sheets, setSheets] = useState([])
  const [activeSheet, setActiveSheet] = useState('')

  const fileType = useMemo(
    () => detectPreviewType(document?.file_name, previewSource?.mime, previewSource?.name),
    [document?.file_name, previewSource?.mime, previewSource?.name]
  )
  const activeSheetData = sheets.find((sheet) => sheet.name === activeSheet)
  const previewKey = `${fileType}:${previewSource?.url || previewSource?.name || document?.file_name || 'empty'}`

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
            rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' })
              .slice(0, EXCEL_MAX_ROWS)
              .map((row) => row.slice(0, EXCEL_MAX_COLS).map((cell) => formatCell(cell)))
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

  return (
    <section className="panel preview-panel">
      <div className="panel-header">
        <h3>原始文件预览</h3>
        <span>{previewTypeLabel(fileType)}</span>
      </div>

      <div className="preview-file-name">{displayFilename(document.file_name)}</div>

      {fileType === 'pdf' && previewSource?.url && (
        <div className="pdf-preview-shell">
          <div className="pdf-preview-toolbar">
            <span>当前文件使用浏览器 PDF 预览器</span>
            <a href={previewSource.url} target="_blank" rel="noreferrer">
              新窗口打开
            </a>
          </div>
          <iframe
            key={previewKey}
            className="file-frame"
            src={previewSource.url}
            title={displayFilename(document.file_name)}
          />
        </div>
      )}

      {fileType === 'excel' && (
        <>
          {loading && <p className="muted">正在生成 Excel 预览...</p>}
          {sheets.length > 0 && (
            <div className="excel-viewer-shell">
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
              <div className="excel-meta">
                <span>展示前 {activeSheetData?.rows?.length || 0} 行</span>
                <span>最多 {EXCEL_MAX_COLS} 列</span>
              </div>
              <ExcelPreviewTable rows={activeSheetData?.rows || []} />
            </div>
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

function ExcelPreviewTable({ rows }) {
  if (!rows.length) {
    return (
      <div className="preview-empty-state preview-empty-state-compact">
        <strong>当前工作表为空</strong>
      </div>
    )
  }

  const header = rows[0] || []
  const bodyRows = rows.slice(1)

  return (
    <div className="excel-preview-table-wrap">
      <table className="excel-preview-table">
        <thead>
          <tr>
            <th className="excel-row-index">#</th>
            {header.map((cell, index) => (
              <th key={`header-${index}`} title={cell}>{cell || `列 ${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              <td className="excel-row-index">{rowIndex + 2}</td>
              {header.map((_, cellIndex) => {
                const cell = row[cellIndex] || ''
                return <td key={`cell-${rowIndex}-${cellIndex}`} title={cell}>{cell}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

async function readArrayBuffer(previewSource) {
  if (previewSource.file) return previewSource.file.arrayBuffer()
  const response = await fetch(previewSource.url)
  if (!response.ok) throw new Error('加载原始文件失败')
  return response.arrayBuffer()
}

function formatCell(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}
