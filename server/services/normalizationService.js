import {
  maybeCountry,
  normalizeUnit,
  parseNumber,
  round2
} from '../lib/utils.js'

const FIELD_PRIORITY = {
  goods_items: ['cargo_manifest', 'packing_list', 'invoice', 'declaration_reference', 'other'],
  package_count: ['packing_list', 'cargo_manifest', 'invoice', 'declaration_reference', 'other'],
  gross_weight_kg: ['packing_list', 'cargo_manifest', 'invoice', 'declaration_reference', 'other'],
  net_weight_kg: ['packing_list', 'cargo_manifest', 'invoice', 'declaration_reference', 'other'],
  currency: ['invoice', 'cargo_manifest', 'declaration_reference', 'packing_list', 'other'],
  total_amount: ['cargo_manifest', 'declaration_reference', 'invoice', 'packing_list', 'other'],
  domestic_consignor: ['declaration_reference', 'invoice', 'packing_list', 'cargo_manifest', 'other'],
  overseas_consignor: ['declaration_reference', 'invoice', 'packing_list', 'cargo_manifest', 'other'],
  buyer_seller: ['declaration_reference', 'invoice', 'packing_list', 'cargo_manifest', 'other'],
  trade_country: ['declaration_reference', 'invoice', 'packing_list', 'cargo_manifest', 'other'],
  destination_country: ['declaration_reference', 'invoice', 'packing_list', 'cargo_manifest', 'other'],
  origin_country: ['declaration_reference', 'cargo_manifest', 'packing_list', 'invoice', 'other'],
  transport_mode: ['packing_list', 'invoice', 'declaration_reference', 'cargo_manifest', 'other'],
  terms_of_delivery: ['declaration_reference', 'invoice', 'packing_list', 'other'],
  import_export_flag: ['declaration_reference', 'invoice', 'packing_list', 'other'],
  declaration_template: ['declaration_reference', 'invoice', 'packing_list', 'other']
}

const REQUIRED_FIELDS = [
  'import_export_flag',
  'declaration_template',
  'domestic_consignor',
  'overseas_consignor',
  'package_count',
  'gross_weight_kg',
  'net_weight_kg',
  'currency',
  'total_amount'
]

export function buildNormalizedRecord(documents, resolutions = []) {
  const resolutionMap = new Map(resolutions.map((item) => [item.field, item]))
  const fieldNames = [
    'import_export_flag',
    'declaration_template',
    'domestic_consignor',
    'overseas_consignor',
    'buyer_seller',
    'trade_country',
    'destination_country',
    'origin_country',
    'transport_mode',
    'package_count',
    'gross_weight_kg',
    'net_weight_kg',
    'currency',
    'total_amount',
    'terms_of_delivery'
  ]

  const fieldDecisions = fieldNames.map((field) => decideField(field, documents, resolutionMap.get(field)))
  const header = Object.fromEntries(fieldDecisions.map((item) => [item.field, item.selected_value]))
  const goodsItems = buildGoodsItems(documents, resolutionMap.get('goods_items'))
  const openIssues = collectIssues(fieldDecisions, goodsItems)

  return {
    header,
    goods_items: goodsItems.items,
    field_decisions: fieldDecisions,
    open_issues: openIssues,
    summary: {
      documents_count: documents.length,
      resolved_fields: fieldDecisions.filter((item) => item.status === 'resolved').length,
      needs_confirm_fields: openIssues.length
    }
  }
}

export function buildDeclarationDraft(normalizedRecord) {
  const { header, goods_items: goodsItems, open_issues: openIssues } = normalizedRecord
  const issues = [...openIssues]
  const declarationDate = new Date().toISOString().slice(0, 10)
  const compactDate = declarationDate.replace(/-/g, '')
  const primaryItem = goodsItems[0] ?? null

  if (!goodsItems.length) {
    issues.push({
      field: 'goods_items',
      code: 'MISSING_GOODS_ITEMS',
      message: '没有可用商品行，系统已保留空草单，请人工补录。',
      severity: 'high'
    })
  }

  const items = goodsItems.length
    ? goodsItems
    : [{
        line_no: 1,
        product_code: null,
        product_name_cn: '待补录商品',
        product_name_en: 'PENDING GOODS',
        spec_model: null,
        hs_code: null,
        declared_qty: null,
        declared_unit: 'PCS',
        unit_price: null,
        line_amount: null,
        origin_country: header.origin_country ?? null,
        source_documents: []
      }]

  return {
    header: {
      declaration_no: buildDeclarationNo(header, compactDate),
      pre_entry_no: buildPreEntryNo(compactDate),
      customs_office: header.import_export_flag === 'export' ? '上海海关' : '浦东机场海关',
      filing_no: 'DEMO-备案-001',
      import_export_flag: header.import_export_flag,
      declaration_date: declarationDate,
      import_export_date: compactDate,
      domestic_consignor: header.domestic_consignor,
      overseas_consignor: header.overseas_consignor,
      buyer_seller: header.buyer_seller,
      trade_country: header.trade_country,
      destination_country: header.destination_country ?? header.trade_country,
      origin_country: primaryItem?.origin_country ?? header.origin_country,
      transport_mode: header.transport_mode,
      transport_name: deriveTransportName(header.transport_mode),
      declaration_template: header.declaration_template,
      supervision_mode: deriveSupervisionMode(header.declaration_template, header.import_export_flag),
      levy_nature: header.import_export_flag === 'export' ? '照章征税' : '一般征税',
      package_type: '纸箱',
      package_count: header.package_count,
      gross_weight_kg: header.gross_weight_kg,
      net_weight_kg: header.net_weight_kg,
      currency: header.currency,
      total_amount: header.total_amount,
      terms_of_delivery: header.terms_of_delivery,
      attached_docs: '发票 / 箱单 / EDI / 参考资料'
    },
    items,
    notes: [
      '统一报关单展示结构',
      '字段差异已收敛到候选来源和人工确认层',
      '当前为演示草单，不代表真实申报合法性校验'
    ],
    validation: {
      status: issues.length ? 'needs_confirm' : 'pass',
      issues
    }
  }
}

function buildDeclarationNo(header, compactDate) {
  const suffix = header.import_export_flag === 'export' ? 'E001' : 'I001'
  return `DEMO${compactDate}${suffix}`
}

function buildPreEntryNo(compactDate) {
  return `PRE${compactDate}0001`
}

function deriveTransportName(mode) {
  if (mode === 'AIR') return '航空运输'
  if (mode === 'SEA') return '海运运输'
  if (mode === 'ROAD') return '公路运输'
  return '待确认'
}

function deriveSupervisionMode(template, importExportFlag) {
  if (/9710/i.test(template ?? '')) return '9710'
  if (/一般贸易/.test(template ?? '')) return '0110'
  if (importExportFlag === 'export') return '0110'
  return '保税流转'
}

export function buildSubmissionPreview(declarationDraft) {
  return {
    prefilled: true,
    valid: declarationDraft.validation.status === 'pass',
    missing_fields: declarationDraft.validation.issues
      .filter((item) => item.code.startsWith('MISSING'))
      .map((item) => item.field),
    warnings: declarationDraft.validation.issues,
    form_data: {
      ...declarationDraft.header,
      items: declarationDraft.items
    }
  }
}

function decideField(field, documents, resolution) {
  const priority = FIELD_PRIORITY[field] ?? ['other']
  const candidates = []

  for (const document of documents) {
    const values = document.header_candidates?.[field] ?? []
    for (const candidate of values) {
      candidates.push({
        value: normalizeFieldValue(field, candidate.value),
        source: document.document_type,
        source_document_id: document.file_id,
        source_document_name: document.file_name,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
        priority_rank: priority.indexOf(document.document_type)
      })
    }
  }

  candidates.sort((left, right) => {
    const pr = (left.priority_rank === -1 ? 99 : left.priority_rank) - (right.priority_rank === -1 ? 99 : right.priority_rank)
    if (pr !== 0) return pr
    return right.confidence - left.confidence
  })

  const distinctValues = [...new Set(candidates.map((item) => String(item.value)))]
  const selected = chooseCandidate(candidates, resolution)
  const required = REQUIRED_FIELDS.includes(field)
  let status = 'resolved'
  const hasResolution = Boolean(
    resolution && (
      (resolution.manual_value !== undefined && resolution.manual_value !== null && resolution.manual_value !== '') ||
      typeof resolution.selected_candidate_index === 'number'
    )
  )
  if (!selected?.value && required) status = 'needs_confirm'
  else if (!hasResolution && distinctValues.length > 1) status = 'needs_confirm'
  else if (!hasResolution && (selected?.confidence ?? 0) < 0.65 && candidates.length <= 1) status = 'needs_confirm'

  return {
    field,
    candidates,
    selected_value: selected?.value ?? null,
    selected_source: selected?.source ?? null,
    selected_evidence: selected?.evidence ?? null,
    status
  }
}

function chooseCandidate(candidates, resolution) {
  if (resolution?.manual_value !== undefined && resolution.manual_value !== null && resolution.manual_value !== '') {
    return {
      value: normalizeFieldValue(resolution.field, resolution.manual_value),
      source: 'manual',
      confidence: 1,
      evidence: 'manual input'
    }
  }

  if (typeof resolution?.selected_candidate_index === 'number' && candidates[resolution.selected_candidate_index]) {
    return candidates[resolution.selected_candidate_index]
  }

  return candidates[0] ?? null
}

function buildGoodsItems(documents, resolution) {
  const sourcePriority = FIELD_PRIORITY.goods_items
  const rankedDocuments = [...documents].sort((left, right) => sourcePriority.indexOf(left.document_type) - sourcePriority.indexOf(right.document_type))
  const baseDocument = rankedDocuments.find((document) => document.line_items?.length)

  const items = (baseDocument?.line_items ?? []).map((item, index) => ({
    line_no: index + 1,
    product_code: item.product_code ?? null,
    product_name_cn: item.product_name_cn ?? null,
    product_name_en: item.product_name_en ?? null,
    spec_model: item.spec_model ?? item.product_code ?? null,
    hs_code: item.hs_code ?? null,
    declared_qty: parseNumber(item.declared_qty),
    declared_unit: normalizeUnit(item.declared_unit ?? 'PCS'),
    unit_price: parseNumber(item.unit_price),
    line_amount: parseNumber(item.line_amount),
    origin_country: maybeCountry(item.origin_country ?? ''),
    source_documents: [{
      file_id: baseDocument?.file_id ?? null,
      file_name: baseDocument?.file_name ?? null,
      source: baseDocument?.document_type ?? null
    }]
  }))

  for (const document of rankedDocuments) {
    if (!document.line_items?.length || document === baseDocument) continue
    for (const extra of document.line_items) {
      const target = items.find((item) => sameItem(item, extra))
      if (!target) continue
      target.product_code ??= extra.product_code ?? null
      target.product_name_cn ??= extra.product_name_cn ?? null
      target.product_name_en ??= extra.product_name_en ?? null
      target.spec_model ??= extra.spec_model ?? null
      target.hs_code ??= extra.hs_code ?? null
      target.declared_qty ??= parseNumber(extra.declared_qty)
      target.declared_unit ??= normalizeUnit(extra.declared_unit ?? 'PCS')
      target.unit_price ??= parseNumber(extra.unit_price)
      target.line_amount ??= parseNumber(extra.line_amount)
      target.origin_country ??= maybeCountry(extra.origin_country ?? '')
      target.source_documents.push({
        file_id: document.file_id,
        file_name: document.file_name,
        source: document.document_type
      })
    }
  }

  const resolvedItems = applyGoodsResolution(items, resolution)
  const issues = []
  if (!resolvedItems.length) {
    issues.push({
      field: 'goods_items',
      code: 'MISSING_GOODS_ITEMS',
      message: '未从文件中稳定识别出商品行。',
      severity: 'high'
    })
  } else {
    resolvedItems.forEach((item, index) => {
      if (!item.product_name_cn && !item.product_name_en && !item.product_code) {
        issues.push({
          field: `goods_items[${index}].name`,
          code: 'MISSING_ITEM_NAME',
          message: `第 ${index + 1} 行缺少商品名称。`,
          severity: 'medium'
        })
      }
      if (!item.declared_qty) {
        issues.push({
          field: `goods_items[${index}].declared_qty`,
          code: 'MISSING_ITEM_QTY',
          message: `第 ${index + 1} 行缺少申报数量。`,
          severity: 'medium'
        })
      }
    })
  }

  return { items: resolvedItems, issues }
}

function applyGoodsResolution(items, resolution) {
  if (!resolution?.manual_items?.length) return items
  return resolution.manual_items.map((item, index) => ({
    line_no: index + 1,
    product_code: item.product_code ?? null,
    product_name_cn: item.product_name_cn ?? null,
    product_name_en: item.product_name_en ?? null,
    spec_model: item.spec_model ?? null,
    hs_code: item.hs_code ?? null,
    declared_qty: parseNumber(item.declared_qty),
    declared_unit: normalizeUnit(item.declared_unit ?? 'PCS'),
    unit_price: parseNumber(item.unit_price),
    line_amount: parseNumber(item.line_amount),
    origin_country: maybeCountry(item.origin_country ?? ''),
    source_documents: [{ file_id: null, file_name: 'manual', source: 'manual' }]
  }))
}

function collectIssues(fieldDecisions, goodsItems) {
  const issues = fieldDecisions
    .filter((decision) => decision.status !== 'resolved')
    .map((decision) => ({
      field: decision.field,
      code: decision.selected_value ? 'CONFLICTING_FIELD' : 'MISSING_FIELD',
      message: decision.selected_value
        ? `字段 ${decision.field} 存在多个候选值，请确认最终值。`
        : `字段 ${decision.field} 缺失，请确认或补录。`,
      severity: REQUIRED_FIELDS.includes(decision.field) ? 'high' : 'medium',
      candidates: decision.candidates
    }))

  return [...issues, ...goodsItems.issues]
}

function normalizeFieldValue(field, value) {
  if (value === null || value === undefined || value === '') return null
  if (['package_count'].includes(field)) {
    const parsed = parseNumber(value)
    return parsed === null ? null : Math.round(parsed)
  }
  if (['gross_weight_kg', 'net_weight_kg', 'total_amount'].includes(field)) {
    const parsed = parseNumber(value)
    return parsed === null ? null : round2(parsed)
  }
  if (['origin_country', 'trade_country', 'destination_country'].includes(field)) return maybeCountry(value)
  if (field === 'currency') return String(value).trim().toUpperCase()
  if (['domestic_consignor', 'overseas_consignor', 'buyer_seller'].includes(field)) return String(value).trim().toUpperCase()
  return value
}

function sameItem(current, extra) {
  if (current.product_code && extra.product_code) {
    return current.product_code === extra.product_code
  }
  const currentName = `${current.product_name_cn ?? ''} ${current.product_name_en ?? ''}`.trim().toLowerCase()
  const extraName = `${extra.product_name_cn ?? ''} ${extra.product_name_en ?? ''}`.trim().toLowerCase()
  return Boolean(currentName && extraName && currentName === extraName)
}
