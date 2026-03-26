import { displayFilename } from '../lib/filenames'

export default function DocumentList({ documents, selectedId, onSelect }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>文件列表</h3>
        <span>{documents.length} 份文件</span>
      </div>
      <div className="document-grid">
        {documents.map((document) => (
          <article
            className={`document-card ${selectedId === document.file_id ? 'document-card-active' : ''}`}
            key={document.file_id}
            onClick={() => onSelect?.(document.file_id)}
          >
            <div className="document-card-top">
              <strong>{displayFilename(document.file_name)}</strong>
              <span className={`tag tag-${document.document_type}`}>{toDocumentTypeLabel(document.document_type)}</span>
            </div>
            <p className="muted">{(document.text_excerpt || '无可预览文本').slice(0, 120)}</p>
            <div className="mini-block">
              <div>
                <label>字段候选</label>
                <strong>{Object.keys(document.header_candidates || {}).length}</strong>
              </div>
              <div>
                <label>商品行</label>
                <strong>{document.line_items?.length || 0}</strong>
              </div>
              <div>
                <label>来源</label>
                <strong>{document.source_path ? '本地样例' : '上传'}</strong>
              </div>
            </div>
          </article>
        ))}
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
