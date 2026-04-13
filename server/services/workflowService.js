export function buildWorkflowView(documents, normalizedRecord, declarationDraft) {
  const issueCount = normalizedRecord.open_issues.length
  const parsedLineCount = documents.reduce((sum, doc) => sum + doc.line_items.length, 0)

  return [
    makeNode('材料接收', 'completed', `${documents.length} 份材料`, documents.map((doc) => doc.file_name).join(' | ')),
    makeNode('材料解析', 'completed', '已提取字段与商品信息', `${parsedLineCount} 条商品信息`),
    makeNode('信息核对', issueCount ? 'needs_confirm' : 'completed', issueCount ? `待补充 ${issueCount} 项` : '主要字段已确认', normalizedRecord.field_decisions.map((item) => `${item.field}: ${item.selected_value ?? '空'}`).slice(0, 5).join(' | ')),
    makeNode('报关单生成', 'completed', '已生成报关草单', `${declarationDraft.items.length} 条商品表体`),
    makeNode('录入展示', declarationDraft.validation.status === 'pass' ? 'completed' : 'needs_confirm', declarationDraft.validation.status === 'pass' ? '已生成录入内容' : '仍有待补充字段', declarationDraft.validation.issues.map((item) => item.code).join(' | ') || '已完成')
  ]
}

function makeNode(title, status, inputSummary, outputSummary) {
  return {
    title,
    status,
    input_summary: inputSummary,
    output_summary: outputSummary,
    duration_ms: Math.round(300 + Math.random() * 1200)
  }
}
