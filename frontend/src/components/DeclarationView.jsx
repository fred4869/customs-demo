import { displayFilename } from '../lib/filenames'

const HEADER_ROWS = [
  [
    ['预录入编号', 'pre_entry_no'],
    ['海关编号', 'declaration_no'],
    ['申报日期', 'declaration_date'],
    ['备案号', 'filing_no']
  ],
  [
    ['境内收发货人', 'domestic_consignor'],
    ['进境关别', 'customs_office'],
    ['进出口日期', 'import_export_date'],
    ['申报模式', 'declaration_template']
  ],
  [
    ['境外收发货人', 'overseas_consignor'],
    ['运输方式', 'transport_mode'],
    ['运输工具名称', 'transport_name'],
    ['征免性质', 'levy_nature']
  ],
  [
    ['买卖方', 'buyer_seller'],
    ['监管方式', 'supervision_mode'],
    ['征免性质', 'levy_nature'],
    ['贸易国(地区)', 'trade_country']
  ],
  [
    ['启运国(地区)', 'origin_country'],
    ['指运港', 'destination_country'],
    ['包装种类', 'package_type'],
    ['件数', 'package_count']
  ],
  [
    ['毛重(千克)', 'gross_weight_kg'],
    ['净重(千克)', 'net_weight_kg'],
    ['成交方式', 'terms_of_delivery'],
    ['币制', 'currency'],
    ['总价/总值', 'total_amount']
  ]
]

export default function DeclarationView({ draft }) {
  if (!draft) return null

  return (
    <section className="panel declaration-sheet-panel">
      <div className="panel-header">
        <h3>统一报关单</h3>
        <span className={`pill pill-${draft.validation.status}`}>{draft.validation.status}</span>
      </div>

      <div className="declaration-sheet">
        <div className="sheet-topline">
          <div className="sheet-mark">海关</div>
          <div className="sheet-title-wrap">
            <h2>中华人民共和国海关进出口货物报关单</h2>
            <div className="sheet-subtitle">CUSTOMS DECLARATION PREVIEW</div>
          </div>
          <div className="sheet-code-box">
            <div className="sheet-code">{draft.header?.declaration_no || draft.packet_id || 'DEMO-DECLARATION'}</div>
            <div className="sheet-page">页码 1 / 1</div>
          </div>
        </div>

        <div className="sheet-meta-row">
          <div><label>统一编号</label><strong>{draft.header?.declaration_no || 'DEMO-2026-001'}</strong></div>
          <div><label>申报状态</label><strong>{draft.validation.status}</strong></div>
          <div><label>商品条数</label><strong>{draft.items?.length || 0}</strong></div>
        </div>

        <div className="sheet-grid">
          {HEADER_ROWS.flatMap((row, rowIndex) => row.map(([label, field], colIndex) => (
            <div key={`${rowIndex}-${colIndex}`} className={`sheet-cell ${field ? '' : 'sheet-cell-empty'}`}>
              <label>{label}</label>
              <strong>{field ? formatValue(draft.header?.[field]) : ''}</strong>
            </div>
          )))}
        </div>

        <div className="sheet-attachment-row">
          <label>随附单证及编号</label>
          <div className="sheet-attachment-value">
            {draft.header?.attached_docs || (draft.items || []).slice(0, 3).map((item) => item.source_documents?.map((doc) => displayFilename(doc.file_name || doc.source)).join(' / ')).filter(Boolean).join('；') || '系统自动归并单证'}
          </div>
        </div>

        <div className="sheet-table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>项号</th>
                <th>商品编码</th>
                <th>商品名称及规格型号</th>
                <th>数量及单位</th>
                <th>单价</th>
                <th>总价</th>
                <th>原产国(地区)</th>
                <th>最终目的国(地区)</th>
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item) => (
                <tr key={item.line_no}>
                  <td>{item.line_no}</td>
                  <td>{item.product_code || item.hs_code || '-'}</td>
                  <td className="sheet-goods-cell">
                    <div>{item.product_name_cn || item.product_name_en || '-'}</div>
                    <small>{item.spec_model || item.product_name_en || ''}</small>
                  </td>
                  <td>{[item.declared_qty ?? '-', item.declared_unit || ''].join(' ')}</td>
                  <td>{formatNumber(item.unit_price)}</td>
                  <td>{formatNumber(item.line_amount)}</td>
                  <td>{item.origin_country || draft.header?.origin_country || '-'}</td>
                  <td>{draft.header?.destination_country || draft.header?.trade_country || '-'}</td>
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 5 - (draft.items?.length || 0)) }).map((_, index) => (
                <tr key={`blank-${index}`} className="sheet-table-blank">
                  <td>{(draft.items?.length || 0) + index + 1}</td>
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

        <div className="sheet-footer">
          <div className="sheet-footer-row">
            <span>特殊关系确认: 否</span>
            <span>价格影响确认: 否</span>
            <span>支付特许权使用费确认: 否</span>
            <span>自报自缴: 是</span>
          </div>
          <div className="sheet-stamp">报关专用章</div>
        </div>
      </div>
    </section>
  )
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '待确认'
  return String(value)
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}
