import { useEffect, useMemo, useState } from 'react'
import { fetchKnowledgeSources, streamSecurityCheck } from './lib/api'

const samplePrompts = [
  {
    id: 'prompt-1',
    label: '有限空间警示标志',
    text: '污水处理池入口处未设置明显有限空间安全警示标志。'
  },
  {
    id: 'prompt-2',
    label: '风险告知牌',
    text: '废水处理区域多个有限空间集中布置，但现场未设置安全风险告知牌。'
  },
  {
    id: 'prompt-3',
    label: '高压容器标志',
    text: '储气罐现场未设置“注意高压容器”安全标志。'
  },
  {
    id: 'prompt-4',
    label: '防火防爆措施',
    text: '使用易燃加工原料的增材制造机床，未采取惰性气体保护或其他防止材料燃烧的措施。'
  },
  {
    id: 'prompt-5',
    label: '未命中示例',
    text: '污水处理区域一洗眼器未进行操作检查与维护。'
  }
]

const emptyResult = {
  status: 'idle',
  query: '',
  rows: [],
  answer_text: '',
  message: '',
  transport: null
}

export default function App() {
  const [sources, setSources] = useState([])
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(emptyResult)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [liveEvents, setLiveEvents] = useState([])

  useEffect(() => {
    fetchKnowledgeSources()
      .then((payload) => setSources(payload.sources || []))
      .catch((err) => setError(err.message))
  }, [])

  const stats = useMemo(
    () => [
      { label: '知识来源', value: sources.length || '--' },
      { label: '当前命中', value: result.rows.length || 0 },
      { label: '输出模式', value: '表格渲染' }
    ],
    [result.rows.length, sources.length]
  )

  const progressState = useMemo(() => buildProgressState(liveEvents, loading, result), [liveEvents, loading, result])

  async function submitSearch(nextQuery) {
    const value = String(nextQuery ?? query).trim()
    if (!value) return

    setLoading(true)
    setError('')
    setLiveEvents([])
    setResult({
      status: 'pending',
      query: value,
      rows: [],
      answer_text: '',
      message: '正在检索，请稍候。',
      transport: null
    })

    try {
      await streamSecurityCheck(value, {
        onMessage(payload) {
          setLiveEvents((current) => {
            const next = [...current, normalizeLiveEvent(payload)]
            return next.slice(-8)
          })
        },
        onFinal(payload) {
          setResult(payload)
        }
      })
      setQuery(value)
    } catch (err) {
      setError(err.message)
      setResult({
        status: 'error',
        query: value,
        rows: [],
        answer_text: '',
        message: err.message,
        transport: null
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await submitSearch(query)
  }

  async function handleSampleClick(text) {
    setQuery(text)
    await submitSearch(text)
  }

  async function handleCopyAnswer() {
    if (!result.answer_text) return
    await navigator.clipboard.writeText(result.answer_text)
  }

  return (
    <div className="security-demo-shell">
      <header className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">LangCore Demo</span>
          <h1>安全检查技术规范问答</h1>
          <p>
            输入现场隐患描述，系统按现有知识材料检索规范文件、条款号和依据片段。最终结果固定渲染为表格，便于客户演示和人工复核。
          </p>
        </div>
        <div className="hero-stats">
          {stats.map((item) => (
            <article key={item.label} className="stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="security-layout">
        <section className="panel panel-input">
          <div className="panel-head">
            <div>
              <p className="eyebrow">输入与样例</p>
              <h2>现场隐患描述</h2>
            </div>
            <span className="status-dot">{loading ? '检索中' : '已就绪'}</span>
          </div>

          <form className="query-form" onSubmit={handleSubmit}>
            <div className="sample-select-wrap">
              <label htmlFor="sample-question" className="sample-select-label">
                样例问题
              </label>
              <select
                id="sample-question"
                className="sample-select"
                value=""
                onChange={(event) => {
                  const value = event.target.value
                  if (!value) return
                  setQuery(value)
                }}
                disabled={loading}
              >
                <option value="">请选择一个样例问题</option>
                {samplePrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.text}>
                    {prompt.label}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：废水处理区域多个有限空间集中布置，但现场未设置安全风险告知牌。"
              rows={5}
            />
            <div className="query-actions">
              <button type="submit" className="primary-action" disabled={loading}>
                {loading ? '正在检索…' : '开始检索'}
              </button>
              <button type="button" className="secondary-action" onClick={() => setQuery('')} disabled={loading}>
                清空输入
              </button>
            </div>
          </form>

        </section>

        <section className="panel panel-result">
          <div className="panel-head">
            <div>
              <p className="eyebrow">结果展示</p>
              <h2>检查依据表</h2>
            </div>
            <div className="result-head-actions">
              <span className={`result-badge result-badge-${result.status}`}>{labelForStatus(result.status)}</span>
              <button type="button" className="secondary-action compact" onClick={handleCopyAnswer} disabled={!result.answer_text}>
                复制严格输出
              </button>
            </div>
          </div>

          {result.status === 'idle' && (
            <div className="empty-state">
              <h3>等待输入</h3>
              <p>请输入一条现场隐患描述，或直接点击左侧样例，查看表格化结果。</p>
            </div>
          )}

          {result.status !== 'idle' && result.rows.length > 0 && (
            <>
              <div className="query-summary">
                <span className="query-summary-label">当前问题</span>
                <strong>{result.query}</strong>
                <small>{result.message}</small>
                {result.transport?.repoQueries?.length > 0 && (
                  <em className="transport-note">检索问题：{result.transport.repoQueries.join('；')}</em>
                )}
              </div>

              <div className="table-shell">
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>规范文件</th>
                      <th>条款号</th>
                      <th>依据片段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={`${row.fileName}-${row.clauseNo}`}>
                        <td>{row.id}</td>
                        <td>{row.fileName}</td>
                        <td>{row.clauseNo}</td>
                        <td>{row.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {progressState.visible && (
            <div className="progress-card">
              <div className="progress-copy">
                <span className={`progress-dot progress-dot-${progressState.tone}`} />
                <div>
                  <strong>{progressState.title}</strong>
                  <p>{progressState.description}</p>
                </div>
              </div>
              <div className="progress-tags">
                {progressState.tags.map((tag) => (
                  <span key={tag} className="progress-tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.status === 'no_hit' && (
            <div className="no-hit-card">
              <h3>未命中当前知识材料</h3>
              <p>检查依据：未检索到明确依据。请补充隐患发生区域、涉及设施设备名称、异常现象或现场标识信息后再试。</p>
            </div>
          )}

          {result.status === 'pending' && (
            <div className="no-hit-card">
              <h3>正在检索</h3>
              <p>{result.message}</p>
              {result.transport?.repoQueries?.length > 0 && <p>当前知识库检索问题：{result.transport.repoQueries.join('；')}</p>}
            </div>
          )}

          {result.status === 'error' && (
            <div className="no-hit-card">
              <h3>检索失败</h3>
              <p>{result.message}</p>
            </div>
          )}

          {result.answer_text && (
            <div className="strict-output">
              <div className="strict-output-head">
                <span>严格输出文本</span>
                <small>用于对接智能体或复制到演示稿</small>
              </div>
              <pre>{result.answer_text}</pre>
            </div>
          )}
        </section>
      </main>

      <section className="panel sources-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">知识材料</p>
            <h2>当前演示知识来源</h2>
          </div>
        </div>

        <div className="sources-grid">
          {sources.map((source) => (
            <article key={source.id} className="source-card">
              <span>{source.standardNo}</span>
              <strong>{source.fileName}</strong>
              <p>{source.scope}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function labelForStatus(status) {
  if (status === 'matched') return '已命中'
  if (status === 'no_hit') return '未命中'
  if (status === 'empty') return '待输入'
  if (status === 'pending') return '检索中'
  if (status === 'error') return '失败'
  return '待检索'
}

function normalizeLiveEvent(payload) {
  const base = {
    id: payload.id || `${Date.now()}-${Math.random()}`,
    kind: payload.type || 'message',
    label: '过程',
    title: '收到实时事件',
    detail: ''
  }

  if (payload.type === 'repo') {
    return {
      ...base,
      kind: 'repo',
      label: '检索',
      title: payload.data?.query || '知识库检索中',
      detail: payload.data?.status || ''
    }
  }

  const text = extractEventText(payload)
  return {
    ...base,
    kind: payload.type || 'message',
    label: payload.type === 'reasoning' ? '推理' : '消息',
    title: text || '收到上游响应',
    detail: payload.role ? `角色：${payload.role}` : ''
  }
}

function extractEventText(payload) {
  if (typeof payload.content === 'string' && payload.content.trim()) return payload.content.trim()
  if (typeof payload.delta === 'string' && payload.delta.trim()) return payload.delta.trim()
  if (typeof payload.data === 'string' && payload.data.trim()) return payload.data.trim()
  if (Array.isArray(payload.content)) {
    const text = payload.content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part?.text === 'string') return part.text
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
      .trim()
    if (text) return text
  }

  return ''
}

function buildProgressState(liveEvents, loading, result) {
  const repoEvents = liveEvents.filter((event) => event.kind === 'repo')
  const runningCount = repoEvents.filter((event) => event.detail === 'RUNNING').length
  const successCount = repoEvents.filter((event) => event.detail === 'SUCCEED').length

  if (loading || result.status === 'pending') {
    return {
      visible: true,
      tone: 'running',
      title: '知识库检索中',
      description: '系统正在整理检查依据，请稍候。',
      tags: [`检索任务 ${Math.max(repoEvents.length, 1)} 个`, runningCount > 0 ? `进行中 ${runningCount}` : '等待返回']
    }
  }

  if (result.status === 'matched') {
    return {
      visible: true,
      tone: 'done',
      title: '检查依据已生成',
      description: '结果已整理为表格，可直接用于演示或人工复核。',
      tags: [`命中 ${result.rows.length} 条`, successCount > 0 ? `检索完成 ${successCount}` : '已完成']
    }
  }

  if (result.status === 'no_hit') {
    return {
      visible: true,
      tone: 'quiet',
      title: '未命中明确依据',
      description: '当前描述未能定位到明确条款，可补充区域、设备名称或异常现象后重试。',
      tags: [successCount > 0 ? `已完成 ${successCount} 次检索` : '检索结束']
    }
  }

  if (result.status === 'error') {
    return {
      visible: true,
      tone: 'error',
      title: '服务调用失败',
      description: result.message || '请稍后重试。',
      tags: ['调用异常']
    }
  }

  return {
    visible: false,
    tone: 'quiet',
    title: '',
    description: '',
    tags: []
  }
}
