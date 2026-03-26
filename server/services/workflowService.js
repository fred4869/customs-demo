export function buildWorkflowView(documents, normalizedRecord, declarationDraft) {
  const issueCount = normalizedRecord.open_issues.length
  const status = issueCount ? 'needs_confirm' : 'completed'

  return [
    makeNode('文件接收', 'completed', `${documents.length} 个文件已纳入 document_packet`, documents.map((doc) => doc.file_name).join(' | ')),
    makeNode('文档分类', 'completed', '已完成 invoice / packing list / cargo manifest / reference 分类', documents.map((doc) => `${doc.file_name}: ${doc.document_type}`).join(' | ')),
    makeNode('文档解析', 'completed', '已输出原始结构化字段与商品行', `${documents.reduce((sum, doc) => sum + doc.line_items.length, 0)} 个商品行候选`),
    makeNode('字段标准化', 'completed', '已统一单位、币制、数量和公司名格式', `${normalizedRecord.field_decisions.length} 个字段决策`),
    makeNode('字段归并决策', issueCount ? 'needs_confirm' : 'completed', issueCount ? `发现 ${issueCount} 个待确认问题` : '所有字段已自动决策', normalizedRecord.field_decisions.map((item) => `${item.field}: ${item.selected_value ?? '空'}`).slice(0, 6).join(' | ')),
    makeNode('异常确认', issueCount ? 'needs_confirm' : 'completed', issueCount ? '等待人工确认冲突字段或缺失字段' : '无需人工确认', normalizedRecord.open_issues.map((item) => item.code).join(' | ') || '无'),
    makeNode('报关单生成', 'completed', '统一 declaration_draft 已生成', `${declarationDraft.items.length} 条商品表体`),
    makeNode('模拟提交', declarationDraft.validation.status === 'pass' ? 'completed' : 'needs_confirm', declarationDraft.validation.status === 'pass' ? '前端校验通过，可模拟提交' : '仍有校验问题，提交页会展示警告', declarationDraft.validation.issues.map((item) => item.code).join(' | ') || '校验通过')
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
