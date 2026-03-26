export default function WorkflowPanel({ workflow, showHeader = true, activeIndex = 0, onNodeClick }) {
  return (
    <section className="workflow-panel">
      {showHeader && (
        <div className="panel-header">
          <h3>Agent 工作流</h3>
          <span>{workflow.length} 个节点</span>
        </div>
      )}
      <div className="workflow-flow-map">
        {workflow.map((node, index) => (
          <div className="workflow-step-wrap" key={`${node.title}-${index}`}>
            <button
              type="button"
              className={`workflow-node workflow-${node.status} ${activeIndex === index ? 'workflow-node-active' : ''}`}
              onClick={() => onNodeClick?.(node, index)}
              disabled={!onNodeClick}
            >
              <div className="workflow-node-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="workflow-node-main">
                <div className="workflow-node-top">
                  <strong>{node.title}</strong>
                  <span className={`workflow-status-dot workflow-status-${node.status === 'completed' ? 'completed' : node.status === 'needs_confirm' ? 'needs_confirm' : node.status === 'failed' ? 'failed' : 'running'}`} aria-hidden="true" />
                </div>
                <div className="workflow-node-meta">
                  <span className={`pill pill-${node.status}`}>{toWorkflowStatusLabel(node.status)}</span>
                </div>
              </div>
            </button>
            {index < workflow.length - 1 && <div className="workflow-connector" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </section>
  )
}

function toWorkflowStatusLabel(value) {
  if (value === 'completed') return '已完成'
  if (value === 'needs_confirm') return '待确认'
  if (value === 'failed') return '失败'
  if (value === 'pending') return '待执行'
  return '处理中'
}
