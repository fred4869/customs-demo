function formatValue(value) {
  if (value === null || value === undefined || value === '') return '待确认'
  return String(value)
}

export default function FieldDecisionTable({ decisions }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h3>字段决策</h3>
        <span>{decisions.length} 个字段</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>最终值</th>
              <th>来源</th>
              <th>状态</th>
              <th>候选数</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((decision) => (
              <tr key={decision.field}>
                <td>{decision.field}</td>
                <td>{formatValue(decision.selected_value)}</td>
                <td>{decision.selected_source || '-'}</td>
                <td>
                  <span className={`pill pill-${decision.status}`}>{decision.status}</span>
                </td>
                <td>{decision.candidates?.length || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
