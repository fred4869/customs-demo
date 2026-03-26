import { useEffect, useMemo, useState } from 'react'
import DeclarationView from './components/DeclarationView'
import DocumentEvidence from './components/DocumentEvidence'
import DocumentList from './components/DocumentList'
import DocumentPreviewPane from './components/DocumentPreviewPane'
import IssueResolver from './components/IssueResolver'
import SubmissionPreview from './components/SubmissionPreview'
import WorkflowPanel from './components/WorkflowPanel'
import { fetchSamplePackets, getSampleFileUrl, parseSamplePacket, parseUploadedFiles, resolveIssues } from './lib/api'

const emptyState = {
  packet_id: null,
  documents: [],
  normalized_record: null,
  declaration_draft: null,
  submission_preview: { warnings: [], form_data: {} },
  workflow: []
}

export default function App() {
  const [samplePackets, setSamplePackets] = useState([])
  const [state, setState] = useState(emptyState)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [selectedDocumentId, setSelectedDocumentId] = useState(null)
  const [activePage, setActivePage] = useState('overview')
  const [deliveryTab, setDeliveryTab] = useState('declaration')
  const [activeSamplePacketId, setActiveSamplePacketId] = useState(null)
  const [uploadedPreviewFiles, setUploadedPreviewFiles] = useState([])

  useEffect(() => {
    fetchSamplePackets().then(setSamplePackets).catch((err) => setError(err.message))
  }, [])

  useEffect(() => () => {
    uploadedPreviewFiles.forEach((item) => URL.revokeObjectURL(item.url))
  }, [uploadedPreviewFiles])

  const openIssues = state.normalized_record?.open_issues || []
  const selectedDocument = state.documents.find((document) => document.file_id === selectedDocumentId) || state.documents[0] || null
  const previewSource = useMemo(() => {
    if (!selectedDocument) return null

    if (Number.isInteger(selectedDocument.source_index) && uploadedPreviewFiles[selectedDocument.source_index]) {
      return uploadedPreviewFiles[selectedDocument.source_index]
    }

    const uploaded = uploadedPreviewFiles.find((item) => normalizeFileToken(item.name) === normalizeFileToken(selectedDocument.file_name))
    if (uploaded) return uploaded

    if (selectedDocument.preview_url) {
      return {
        url: selectedDocument.preview_url,
        mime: mimeFromName(selectedDocument.file_name),
        name: selectedDocument.file_name
      }
    }

    if (!activeSamplePacketId) return null
    const packet = samplePackets.find((item) => item.id === activeSamplePacketId)
    if (!packet) return null
    const fileIndex = (packet.files || []).findIndex((file) => {
      const path = file.path || ''
      return normalizeFileToken(path.split('/').pop()) === normalizeFileToken(selectedDocument.file_name)
    })
    if (fileIndex < 0) return null
    return {
      url: getSampleFileUrl(activeSamplePacketId, fileIndex),
      mime: mimeFromName(selectedDocument.file_name),
      name: selectedDocument.file_name
    }
  }, [selectedDocument, uploadedPreviewFiles, activeSamplePacketId, samplePackets])
  const summaryCards = useMemo(() => {
    if (!state.normalized_record) return []
    return [
      { label: '文件数', value: state.documents.length },
      { label: '商品行', value: state.declaration_draft?.items?.length || 0 },
      { label: '待确认字段', value: openIssues.length },
      { label: '已完成节点', value: state.workflow.filter((node) => node.status === 'completed').length }
    ]
  }, [state, openIssues.length])

  async function handleUpload(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setUploadedPreviewFiles((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.url))
      return files.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
        mime: file.type || mimeFromName(file.name),
        file
      }))
    })
    setActiveSamplePacketId(null)
    setLoading(true)
    setError('')
    try {
      const payload = await parseUploadedFiles(files)
      setState(payload)
      setSelectedDocumentId(payload.documents?.[0]?.file_id ?? null)
      setDeliveryTab('declaration')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      event.target.value = ''
    }
  }

  async function handleSample(id) {
    setActiveSamplePacketId(id)
    setUploadedPreviewFiles((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.url))
      return []
    })
    setLoading(true)
    setError('')
    try {
      const payload = await parseSamplePacket(id)
      setState(payload)
      setSelectedDocumentId(payload.documents?.[0]?.file_id ?? null)
      setDeliveryTab('declaration')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve(form) {
    const resolutions = Object.entries(form).map(([field, payload]) => ({ field, ...payload }))
    setResolving(true)
    setError('')
    try {
      const payload = await resolveIssues(state.documents, resolutions)
      setState((current) => ({ ...current, ...payload }))
      setSelectedDocumentId(payload.documents?.[0]?.file_id ?? state.documents?.[0]?.file_id ?? null)
      setDeliveryTab('declaration')
    } catch (err) {
      setError(err.message)
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="app-shell app-shell-v2">
      <header className="page-header page-header-bar">
        <div className="page-header-left">
          <div className="page-header-title">
            <h1>统一单证解析与报关单预览</h1>
          </div>
          <nav className="page-nav page-nav-inline">
            <button className={`page-nav-item ${activePage === 'overview' ? 'page-nav-item-active' : ''}`} onClick={() => setActivePage('overview')}>
              首页进度
            </button>
            <button
              className={`page-nav-item ${activePage === 'review' ? 'page-nav-item-active' : ''}`}
              onClick={() => setActivePage('review')}
              disabled={!state.documents.length}
            >
              文件预览与确认
            </button>
            <button
              className={`page-nav-item ${activePage === 'declaration' ? 'page-nav-item-active' : ''}`}
              onClick={() => setActivePage('declaration')}
              disabled={!state.declaration_draft}
            >
              报关单预览
            </button>
          </nav>
        </div>
        <div className="header-meta">
          <span className="meta-chip">支持多格式文档</span>
          <span className="meta-chip">统一报关单结构</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="page-stack">
        <div className="workspace-shell">
          <section className="workspace-main panel">
            {activePage === 'overview' && (
              <section className="section-block">
                <div className="section-heading">
                  <div>
                    <p className="section-index">01</p>
                    <h2>概览</h2>
                  </div>
                </div>
                {state.documents.length ? (
                  <div className="overview-main">
                    <div className="panel-header">
                      <h3>Agent 工作流</h3>
                      <span>{state.workflow.length} 个节点</span>
                    </div>
                    <WorkflowPanel workflow={state.workflow} showHeader={false} />
                  </div>
                ) : (
                  <EmptyState title="等待输入" message="右侧上传文件或加载样例包后，这里展示工作流节点和执行进度。" />
                )}
              </section>
            )}

            {activePage === 'review' && (
              <section className="section-block">
                <div className="section-heading">
                  <div>
                    <p className="section-index">02</p>
                    <h2>文件预览与字段确认</h2>
                  </div>
                </div>
                {state.documents.length ? (
                  <div className="review-layout">
                    <div className="review-preview-column">
                      <DocumentList documents={state.documents} selectedId={selectedDocumentId} onSelect={setSelectedDocumentId} />
                      <DocumentPreviewPane document={selectedDocument} previewSource={previewSource} />
                      <DocumentEvidence document={selectedDocument} compact />
                    </div>
                    <div className="review-issues-column">
                      <IssueResolver issues={openIssues} onSubmit={handleResolve} busy={resolving} />
                    </div>
                  </div>
                ) : (
                  <EmptyState title="文件预览与确认" message="上传文件后，这里显示原始预览、抽取依据和待确认字段。" />
                )}
              </section>
            )}

            {activePage === 'declaration' && (
              <section className="section-block">
                <div className="section-heading">
                  <div>
                    <p className="section-index">03</p>
                    <h2>统一报关单预览</h2>
                  </div>
                </div>
                <div className="subpage-tabs">
                  <button className={`subpage-tab ${deliveryTab === 'declaration' ? 'subpage-tab-active' : ''}`} onClick={() => setDeliveryTab('declaration')}>
                    统一报关单
                  </button>
                  <button className={`subpage-tab ${deliveryTab === 'gateway' ? 'subpage-tab-active' : ''}`} onClick={() => setDeliveryTab('gateway')}>
                    模拟报关宝
                  </button>
                </div>
                <div className="declaration-stack">
                  {deliveryTab === 'declaration'
                    ? (state.declaration_draft ? <DeclarationView draft={state.declaration_draft} /> : <EmptyState title="统一报关单" message="完成解析后，这里会生成统一报关单结构。" />)
                    : (state.submission_preview ? <SubmissionPreview preview={state.submission_preview} /> : <EmptyState title="模拟提交" message="生成报关单后，这里展示模拟关务宝提交效果。" />)}
                </div>
              </section>
            )}
          </section>

          <aside className="workspace-side panel">
            <section className="side-section">
              <div className="panel-header">
                <h3>文件输入</h3>
                <span>{state.documents.length || 0} 份</span>
              </div>
              <label className="primary-button upload-button upload-button-wide">
                上传本地文件
                <input type="file" multiple onChange={handleUpload} />
              </label>
              <div className="sample-strip sample-strip-inline">
                {samplePackets.map((packet) => (
                  <button key={packet.id} className="sample-card sample-card-inline" onClick={() => handleSample(packet.id)} disabled={loading}>
                    <strong>{packet.label}</strong>
                    <span>{packet.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="side-section">
              <div className="panel-header">
                <h3>概览状态</h3>
                <span>{summaryCards.length ? '已生成' : '空态'}</span>
              </div>
              <div className="summary-inline">
                {(summaryCards.length > 0 ? summaryCards : [{ label: '当前状态', value: '等待输入' }]).map((card) => (
                  <article className="summary-chip" key={card.label}>
                    <label>{card.label}</label>
                    <strong>{card.value}</strong>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {(loading || resolving) && <div className="loading-mask">{loading ? '正在解析单据...' : '正在应用人工确认...'}</div>}
    </div>
  )
}

function EmptyState({ title, message }) {
  return (
    <section className="panel empty-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>未生成</span>
      </div>
      <p className="muted">{message}</p>
    </section>
  )
}

function mimeFromName(filename = '') {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  return 'application/octet-stream'
}

function normalizeFileToken(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}
