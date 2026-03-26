import { useEffect, useMemo, useState } from 'react'

export default function IssueResolver({ issues, onSubmit, busy }) {
  const visibleIssues = issues.slice(0, 6)
  const initial = useMemo(() => Object.fromEntries(visibleIssues.map((issue) => [issue.field, { selected_candidate_index: 0, manual_value: '' }])), [visibleIssues])
  const [form, setForm] = useState(initial)

  useEffect(() => {
    setForm(initial)
  }, [initial])

  if (!issues.length) {
    return (
      <section className="panel accent success">
        <div className="panel-header">
          <h3>人工确认</h3>
          <span>无需处理</span>
        </div>
        <p className="muted">当前没有冲突字段或缺失字段，系统可直接生成统一报关单。</p>
      </section>
    )
  }

  const update = (field, patch) => {
    setForm((current) => ({
      ...current,
      [field]: { ...current[field], ...patch }
    }))
  }

  const buildPayload = () => Object.entries(form).reduce((acc, [field, payload]) => {
    if (field === 'goods_items' && payload.manual_value?.trim()) {
      acc[field] = {
        manual_items: payload.manual_value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [product_code = '', product_name = '', declared_qty = '', declared_unit = 'PCS', line_amount = ''] = line.split('|').map((cell) => cell.trim())
            return {
              product_code,
              product_name_cn: /[\u4e00-\u9fff]/.test(product_name) ? product_name : null,
              product_name_en: /[\u4e00-\u9fff]/.test(product_name) ? null : product_name,
              declared_qty,
              declared_unit: declared_unit || 'PCS',
              line_amount
            }
          })
      }
      return acc
    }

    acc[field] = payload
    return acc
  }, {})

  return (
    <section className="panel accent warning">
      <div className="panel-header">
        <h3>人工确认</h3>
        <span>{issues.length} 个待处理问题</span>
      </div>
      {issues.length > visibleIssues.length && <p className="muted">当前只展示最重要的 {visibleIssues.length} 个问题，避免页面过载。</p>}
      <div className="issue-list">
        {visibleIssues.map((issue) => (
          <article key={issue.field} className="issue-card">
            <div className="issue-title-row">
              <strong>{toFieldLabel(issue.field)}</strong>
              <span className={`pill pill-${issue.severity}`}>{toSeverityLabel(issue.severity)}</span>
            </div>
            <p>{issue.message}</p>
            {Array.isArray(issue.candidates) && issue.candidates.length > 0 && (
              <label>
                <span>采用候选值</span>
                <select
                  value={form[issue.field]?.selected_candidate_index ?? 0}
                  onChange={(event) => update(issue.field, { selected_candidate_index: Number(event.target.value) })}
                >
                  {issue.candidates.map((candidate, index) => (
                    <option key={`${issue.field}-${index}`} value={index}>
                      {index + 1}. {String(candidate.value)} [{candidate.source}] 置信度 {candidate.confidence}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {issue.field === 'goods_items' && (
              <label>
                <span>手工补录商品行</span>
                <textarea
                  rows={5}
                  value={form[issue.field]?.manual_value ?? ''}
                  onChange={(event) => update(issue.field, { manual_value: event.target.value })}
                  placeholder="每行一个商品，格式：商品编码|商品名称|数量|单位|金额"
                />
              </label>
            )}
            <label>
              <span>或手动输入</span>
              <input
                value={form[issue.field]?.manual_value ?? ''}
                onChange={(event) => update(issue.field, { manual_value: event.target.value })}
                placeholder={issue.field === 'goods_items' ? '如已在上方录入商品行，这里可留空' : '留空则采用上方候选值'}
              />
            </label>
          </article>
        ))}
      </div>
      <button className="primary-button" disabled={busy} onClick={() => onSubmit(buildPayload())}>
        {busy ? '处理中...' : '应用确认并重新生成报关单'}
      </button>
    </section>
  )
}

function toSeverityLabel(value) {
  if (value === 'high') return '高'
  if (value === 'medium') return '中'
  if (value === 'low') return '低'
  return value
}

function toFieldLabel(field) {
  const normalized = String(field || '')
  const map = {
    declaration_template: '申报模板',
    domestic_consignor: '境内收发货人',
    overseas_consignor: '境外收发货人',
    buyer_seller: '买卖方',
    destination_country: '指运港/目的国',
    trade_country: '贸易国',
    origin_country: '启运国/原产国',
    transport_mode: '运输方式',
    package_count: '件数',
    gross_weight_kg: '毛重',
    net_weight_kg: '净重',
    currency: '币制',
    total_amount: '总价',
    terms_of_delivery: '成交方式',
    goods_items: '商品表体'
  }
  if (map[normalized]) return map[normalized]
  return normalized.replace(/^goods_items\[\d+\]\.declared_qty$/, '商品数量')
}
