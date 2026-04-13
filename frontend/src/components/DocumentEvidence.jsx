import { displayFilename } from '../lib/filenames'
import { isReadableSnippet, toDisplaySnippet } from '../lib/textQuality'

export default function DocumentEvidence({ document, compact = false }) {
  if (!document) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>抽取依据</h3>
          <span>未选择文件</span>
        </div>
        <p className="muted">先上传文件或加载样例包，再从上方卡片中选择一份文档查看字段来源和来源片段。</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>抽取依据</h3>
        <span>{toDocumentTypeLabel(document.document_type)}</span>
      </div>
      <div className="evidence-meta">
        <div className="declaration-cell">
          <label>文件名</label>
          <strong>{displayFilename(document.file_name)}</strong>
        </div>
        <div className="declaration-cell">
          <label>来源路径</label>
          <strong>{document.source_path || '上传文件'}</strong>
        </div>
      </div>
      {!compact && (
        <div className="evidence-preview">
          <label>来源片段</label>
          <pre>{toDisplaySnippet(document.raw_text?.slice(0, 3200) || document.text_excerpt, '当前文件未生成可直接展示的文本片段，请以上方原始文件预览为准。')}</pre>
        </div>
      )}
      <div className="evidence-grid">
        {(document.evidence_blocks || []).filter((block) => isReadableSnippet(block.text)).slice(0, compact ? 6 : 30).map((block) => (
          <article key={block.id} className="evidence-card">
            <small>{block.id}</small>
            <p>{block.text}</p>
          </article>
        ))}
        {!(document.evidence_blocks || []).filter((block) => isReadableSnippet(block.text)).length && (
          <article className="evidence-card">
            <small>说明</small>
            <p>当前文件没有可直接展示的文本片段，请以上方文件预览为准。</p>
          </article>
        )}
      </div>
    </section>
  )
}

function toDocumentTypeLabel(value) {
  if (value === 'invoice') return '发票'
  if (value === 'packing_list') return '箱单'
  if (value === 'cargo_manifest') return '运单/舱单'
  if (value === 'declaration_reference') return '参考资料'
  return '其他'
}
