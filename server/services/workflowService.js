export function buildWorkflowView(documents, normalizedRecord, declarationDraft) {
  const issueCount = normalizedRecord.open_issues.length
  const parsedLineCount = documents.reduce((sum, doc) => sum + doc.line_items.length, 0)

  return [
    makeNode('材料接收', 'completed', `${documents.length} 份原始单据已纳入处理`, documents.map((doc) => doc.file_name).join(' | ')),
    makeNode('材料解析', 'completed', '已从合同、发票、箱单等原始材料提取字段与商品行', `${parsedLineCount} 条商品候选`),
    makeNode('字段校验', issueCount ? 'needs_confirm' : 'completed', issueCount ? `发现 ${issueCount} 个待确认字段` : '关键字段已完成校验', normalizedRecord.field_decisions.map((item) => `${item.field}: ${item.selected_value ?? '空'}`).slice(0, 5).join(' | ')),
    makeNode('草单生成', 'completed', '已生成报关草单预览', `${declarationDraft.items.length} 条商品表体`),
    makeNode('模拟提交', declarationDraft.validation.status === 'pass' ? 'completed' : 'needs_confirm', declarationDraft.validation.status === 'pass' ? '映射录入通过，可演示模拟提交' : '仍有待确认字段，提交页保留提醒', declarationDraft.validation.issues.map((item) => item.code).join(' | ') || '校验通过')
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
