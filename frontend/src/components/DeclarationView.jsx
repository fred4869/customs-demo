const HEADER_LAYOUT = [
  [
    { label: '境内发货人', field: 'domestic_consignor', span: 8 },
    { label: '出境关别', field: 'customs_office', span: 4 },
    { label: '出口日期', field: 'import_export_date', span: 4 },
    { label: '申报日期', field: 'declaration_date', span: 4 },
    { label: '备案号', field: 'filing_no', span: 4 }
  ],
  [
    { label: '境外收货人', field: 'overseas_consignor', span: 8 },
    { label: '运输方式', field: 'transport_mode', span: 4, emptyText: '待确认' },
    { label: '运输工具名称及航次号', field: 'transport_name', span: 8 },
    { label: '提运单号', field: 'bill_no', span: 4 }
  ],
  [
    { label: '生产销售单位', field: 'buyer_seller', fallbackField: 'domestic_consignor', span: 8 },
    { label: '监管方式', field: 'supervision_mode', span: 4 },
    { label: '征免性质', field: 'levy_nature', span: 4 },
    { label: '许可证号', field: 'license_no', span: 8 }
  ],
  [
    { label: '合同协议号', field: 'contract_no', span: 8 },
    { label: '贸易国(地区)', field: 'trade_country', span: 4 },
    { label: '运抵国(地区)', field: 'destination_country', span: 4, emptyText: '待确认' },
    { label: '指运港', field: 'destination_port', span: 4 },
    { label: '离境口岸', field: 'departure_port', span: 4 }
  ],
  [
    { label: '包装种类', field: 'package_type', span: 8 },
    { label: '件数', field: 'package_count', span: 4 },
    { label: '毛重(千克)', field: 'gross_weight_kg', span: 4 },
    { label: '净重(千克)', field: 'net_weight_kg', span: 4 },
    { label: '成交方式', field: 'terms_of_delivery', span: 4 }
  ]
]

export default function DeclarationView({ draft }) {
  if (!draft) return null

  return (
    <section className="panel declaration-sheet-panel">
      <div className="panel-header">
        <h3>报关草单</h3>
        <span className="pill">出口货物报关单样式</span>
      </div>

      <div className="declaration-sheet declaration-sheet-reference">
        <div className="sheet-record-caption">出口货物报关单录入凭单</div>
        <div className="sheet-record-title">
          <div className="sheet-record-badge">出口</div>
          <div className="sheet-record-heading">
            <h2>中华人民共和国海关出口货物报关单</h2>
            <div className="sheet-record-subtitle">录入凭单</div>
          </div>
          <div className="sheet-record-code">
            <div className="sheet-record-code-label">海关编号</div>
            <strong>{draft.header?.declaration_no || ''}</strong>
          </div>
        </div>

        <div className="sheet-record-grid">
          {HEADER_LAYOUT.map((row, rowIndex) => (
            <div key={rowIndex} className="sheet-record-row">
              {row.map((item) => (
                <div
                  key={`${rowIndex}-${item.label}`}
                  className="sheet-record-cell"
                  style={{ gridColumn: `span ${item.span}` }}
                >
                  <label>{item.label}</label>
                  <strong>{resolveSheetCellValue(draft.header, item)}</strong>
                </div>
              ))}
            </div>
          ))}

          <div className="sheet-record-row">
            <div className="sheet-record-cell" style={{ gridColumn: 'span 24' }}>
              <label>随附单证及编号</label>
              <strong className="sheet-record-attachments">
                {formatDisplayValue(draft.header?.attached_docs)}
              </strong>
            </div>
          </div>

          <div className="sheet-record-row">
            <div className="sheet-record-cell" style={{ gridColumn: 'span 24' }}>
              <label>标记唛码及备注</label>
              <strong className="sheet-record-remark">
                {formatDisplayValue(draft.header?.marks_remarks)}
              </strong>
            </div>
          </div>
        </div>

        <div className="sheet-table-wrap sheet-table-reference-wrap">
          <table className="sheet-table sheet-table-reference">
            <thead>
              <tr>
                <th>项号</th>
                <th>商品编号</th>
                <th>商品名称及规格型号</th>
                <th>数量及单位</th>
                <th>单价</th>
                <th>总价</th>
                <th>币制</th>
                <th>原产国(地区)</th>
                <th>最终目的国(地区)</th>
                <th>境内货源地</th>
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item) => (
                <FragmentRow key={item.line_no} item={item} draft={draft} />
              ))}
              {Array.from({ length: Math.max(0, 3 - (draft.items?.length || 0)) }).map((_, index) => (
                <tr key={`blank-${index}`} className="sheet-table-blank">
                  <td>{(draft.items?.length || 0) + index + 1}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sheet-footer sheet-footer-reference">
          <div className="sheet-footer-row">
            <span>商品条数: {draft.items?.length || 0}</span>
            <span>成交方式: {formatDisplayValue(draft.header?.terms_of_delivery) || '待确认'}</span>
            <span>币制: {formatDisplayValue(draft.header?.currency) || '待确认'}</span>
          </div>
          <div className="sheet-stamp">报关专用章</div>
        </div>
      </div>
    </section>
  )
}

function FragmentRow({ item, draft }) {
  return (
    <tr>
      <td>{padLineNo(item.line_no)}</td>
      <td>{formatDisplayValue(item.product_code || item.hs_code) || '待确认'}</td>
      <td className="sheet-goods-cell">
        <div>{item.product_name_cn || item.product_name_en || ''}</div>
        <small>{item.spec_model || item.product_name_en || ''}</small>
      </td>
      <td>{formatSheetQuantity(item.declared_qty, item.declared_unit)}</td>
      <td>{formatNumber(item.unit_price)}</td>
      <td>{formatNumber(item.line_amount)}</td>
      <td>{formatDisplayValue(item.currency || draft.header?.currency)}</td>
      <td>{formatDisplayValue(item.origin_country || draft.header?.origin_country)}</td>
      <td>{formatDisplayValue(item.destination_country || draft.header?.destination_country)}</td>
      <td>{formatDisplayValue(item.source_region) || '待确认'}</td>
    </tr>
  )
}

function resolveCellValue(header, item) {
  if (item.value !== undefined) return item.value
  const value = header?.[item.field]
  if (value !== null && value !== undefined && value !== '') return formatValue(value)
  if (item.fallbackField) {
    const fallbackValue = header?.[item.fallbackField]
    if (fallbackValue !== null && fallbackValue !== undefined && fallbackValue !== '') {
      return formatValue(fallbackValue)
    }
  }
  return '待确认'
}

function resolveSheetCellValue(header, item) {
  if (item.value !== undefined) return item.value
  const value = header?.[item.field]
  if (value !== null && value !== undefined && value !== '') return formatDisplayValue(value)
  if (item.fallbackField) {
    const fallbackValue = header?.[item.fallbackField]
    if (fallbackValue !== null && fallbackValue !== undefined && fallbackValue !== '') {
      return formatDisplayValue(fallbackValue)
    }
  }
  return item.emptyText || '待确认'
}

function padLineNo(value) {
  if (value === null || value === undefined || value === '') return ''
  return String(value).padStart(2, '0')
}

function formatSheetQuantity(qty, unit) {
  if (qty === null || qty === undefined || qty === '') return ''
  return `${qty}${unit || ''}`
}

function formatDisplayValue(value) {
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '待确认'
  return String(value)
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}
