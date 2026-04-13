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

const workflowSkeleton = [
  { title: '材料接收', status: 'pending' },
  { title: '材料解析', status: 'pending' },
  { title: '字段校验', status: 'pending' },
  { title: '草单生成', status: 'pending' },
  { title: '模拟提交', status: 'pending' }
]

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
  const [activeWorkflowIndex, setActiveWorkflowIndex] = useState(0)

  useEffect(() => {
    fetchSamplePackets().then(setSamplePackets).catch((err) => setError(err.message))
  }, [])

  useEffect(() => () => {
    uploadedPreviewFiles.forEach((item) => URL.revokeObjectURL(item.url))
  }, [uploadedPreviewFiles])

  useEffect(() => {
    setActiveWorkflowIndex(0)
  }, [state.workflow])

  const openIssues = state.normalized_record?.open_issues || []
  const selectedDocument = state.documents.find((document) => document.file_id === selectedDocumentId) || state.documents[0] || null
  const workflowItems = state.workflow.length ? state.workflow : workflowSkeleton

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
      setActivePage('overview')
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
      setActivePage('overview')
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

  function handleWorkflowClick(node, index) {
    setActiveWorkflowIndex(index)

    if (/草单生成|报关单生成/.test(node.title)) {
      setDeliveryTab('declaration')
      setActivePage('declaration')
      return
    }

    if (/模拟提交/.test(node.title)) {
      setDeliveryTab('gateway')
      setActivePage('declaration')
      return
    }

    if (state.documents.length) {
      setActivePage('review')
    }
  }

  return (
    <div className="app-shell app-shell-v2">
      <header className="page-header page-header-bar">
        <div className="page-header-main">
          <div className="page-header-left">
            <div className="page-header-title">
              <h1>原始单据解析与报关草单预览</h1>
            </div>
          </div>
          <nav className="page-step-nav" aria-label="页面步骤">
            <button className={`page-step-item ${activePage === 'overview' ? 'page-step-item-active' : ''}`} onClick={() => setActivePage('overview')}>
              <span className="page-step-index">01</span>
              <span className="page-step-copy">
                <strong>首页进度</strong>
                <small>输入原始单据与流程概览</small>
              </span>
            </button>
            <button
              className={`page-step-item ${activePage === 'review' ? 'page-step-item-active' : ''}`}
              onClick={() => setActivePage('review')}
              disabled={!state.documents.length}
            >
              <span className="page-step-index">02</span>
              <span className="page-step-copy">
                <strong>文件预览与确认</strong>
                <small>查看原始单据并核对字段</small>
              </span>
            </button>
            <button
              className={`page-step-item ${activePage === 'declaration' ? 'page-step-item-active' : ''}`}
              onClick={() => setActivePage('declaration')}
              disabled={!state.declaration_draft}
            >
              <span className="page-step-index">03</span>
              <span className="page-step-copy">
                <strong>报关单预览</strong>
                <small>生成草单并模拟提交</small>
              </span>
            </button>
          </nav>
        </div>
        <div className="header-meta">
          <span className="meta-chip">一般贸易主场景</span>
          <span className="meta-chip">仅原始材料参与抽取</span>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="page-stack">
        <section className="workspace-main panel workspace-main-single">
          {activePage === 'overview' && (
            <section className="section-block">
              <div className="section-heading">
                <div>
                  <p className="section-index">01</p>
                  <h2>输入原始单据与流程进度</h2>
                </div>
              </div>

              <div className="overview-input-panel">
                <div className="input-entry-shell">
                  <div className="input-entry input-entry-upload">
                    <div className="input-entry-head">
                      <span className="input-entry-label">方式 A</span>
                      <h3>上传本地文件</h3>
                    </div>
                    <p className="muted input-entry-note">支持 PDF、Excel、Word。只把原始业务材料作为输入，报关单样例页不参与抽取。</p>
                    <label className="primary-button upload-button upload-button-wide">
                      选择本地文件
                      <input type="file" multiple onChange={handleUpload} />
                    </label>
                  </div>
                  <div className="input-entry-divider">
                    <span>或</span>
                  </div>
                  <div className="input-entry input-entry-sample">
                    <div className="input-entry-head">
                      <span className="input-entry-label">方式 B</span>
                      <h3>使用现成 Demo</h3>
                    </div>
                    <p className="muted input-entry-note">默认推荐一般贸易主样例。9710 和施耐德仅作参考展示，最后一页或报关单 sheet 不参与抽取。</p>
                    <details className="sample-dropdown">
                      <summary className="sample-dropdown-trigger">
                        <span>选择 Demo 样例包</span>
                        <small>{samplePackets.length} 个可选</small>
                      </summary>
                      <div className="sample-dropdown-list">
                        {samplePackets.map((packet, index) => (
                          <button key={packet.id} className="sample-card sample-card-inline" onClick={() => handleSample(packet.id)} disabled={loading}>
                            <strong>{packet.label}{index === 0 ? ' · 推荐' : ''}</strong>
                            <span>{packet.description}</span>
                          </button>
                        ))}
                      </div>
                    </details>
                  </div>
                </div>

                <div className="summary-inline summary-inline-overview">
                  {(summaryCards.length > 0 ? summaryCards : [{ label: '当前状态', value: '等待输入' }]).map((card) => (
                    <article className="summary-chip" key={card.label}>
                      <label>{card.label}</label>
                      <strong>{card.value}</strong>
                    </article>
                  ))}
                </div>
              </div>

              {state.documents.length ? (
                <div className="workflow-stage">
                  <div className="panel-header">
                    <h3>Agent 工作流</h3>
                    <span>{workflowItems.length} 个节点</span>
                  </div>
                  <WorkflowPanel
                    workflow={workflowItems}
                    showHeader={false}
                    activeIndex={activeWorkflowIndex}
                    onNodeClick={handleWorkflowClick}
                  />
                </div>
              ) : (
                <div className="workflow-stage">
                  <div className="panel-header">
                    <h3>Agent 工作流</h3>
                    <span>{workflowItems.length} 个节点</span>
                  </div>
                  <WorkflowPanel
                    workflow={workflowItems}
                    showHeader={false}
                    activeIndex={-1}
                  />
                  <p className="muted">先上传文件或加载样例包，流程会从“文件接收”开始推进。</p>
                </div>
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
                    <div className="review-file-workbench">
                      <div className="review-file-rail">
                        <DocumentList documents={state.documents} selectedId={selectedDocumentId} onSelect={setSelectedDocumentId} compact />
                      </div>
                      <div className="review-preview-pane">
                        <DocumentPreviewPane document={selectedDocument} previewSource={previewSource} />
                      </div>
                    </div>
                  </div>
                  <div className="review-issues-column">
                    <IssueResolver issues={openIssues} onSubmit={handleResolve} busy={resolving} />
                    <DocumentEvidence document={selectedDocument} compact />
                  </div>
                </div>
              ) : (
                <EmptyState title="文件预览与确认" message="上传原始材料后，这里显示文件预览、抽取依据和待确认字段。参考样例页只用于对照，不参与抽取。" />
              )}
            </section>
          )}

          {activePage === 'declaration' && (
            <section className="section-block">
              <div className="section-heading">
                <div>
                  <p className="section-index">03</p>
                  <h2>报关草单预览</h2>
                </div>
              </div>
              <div className="subpage-tabs">
                <button className={`subpage-tab ${deliveryTab === 'declaration' ? 'subpage-tab-active' : ''}`} onClick={() => setDeliveryTab('declaration')}>
                  报关草单
                </button>
                <button className={`subpage-tab ${deliveryTab === 'gateway' ? 'subpage-tab-active' : ''}`} onClick={() => setDeliveryTab('gateway')}>
                  模拟报关宝
                </button>
              </div>
              <div className="declaration-stack">
                {deliveryTab === 'declaration'
                  ? (state.declaration_draft ? <DeclarationView draft={state.declaration_draft} /> : <EmptyState title="报关草单" message="完成原始材料解析后，这里会生成报关草单。" />)
                  : (state.submission_preview ? <SubmissionPreview preview={state.submission_preview} /> : <EmptyState title="模拟提交" message="生成报关单后，这里展示模拟关务宝提交效果。" />)}
              </div>
            </section>
          )}
        </section>
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

function toWorkflowStatusLabel(value) {
  if (value === 'completed') return '已完成'
  if (value === 'needs_confirm') return '待确认'
  if (value === 'failed') return '失败'
  return '处理中'
}
