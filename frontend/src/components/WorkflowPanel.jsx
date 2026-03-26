export default function WorkflowPanel({ workflow, showHeader = true }) {
  return (
    <section className="workflow-panel">
      {showHeader && (
        <div className="panel-header">
          <h3>Agent 工作流</h3>
          <span>{workflow.length} 个节点</span>
        </div>
      )}
      <div className="workflow-flow">
        {workflow.map((node, index) => (
          <article className={`workflow-node workflow-${node.status}`} key={`${node.title}-${index}`}>
            <div className="workflow-node-top">
              <strong>{String(index + 1).padStart(2, '0')} {node.title}</strong>
              <span className={`pill pill-${node.status}`}>{toWorkflowStatusLabel(node.status)}</span>
            </div>
            <div className="workflow-node-body">
              <span>{node.input_summary}</span>
              <span>{node.output_summary}</span>
            </div>
            <small>{node.duration_ms} ms</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function toWorkflowStatusLabel(value) {
  if (value === 'completed') return '已完成'
  if (value === 'needs_confirm') return '待确认'
  if (value === 'failed') return '失败'
  return '处理中'
}
