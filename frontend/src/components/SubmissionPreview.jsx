const PRIORITY_FIELDS = [
  ['报关单号', 'declaration_no'],
  ['预录入编号', 'pre_entry_no'],
  ['海关', 'customs_office'],
  ['境内收发货人', 'domestic_consignor'],
  ['境外收发货人', 'overseas_consignor'],
  ['监管方式', 'supervision_mode'],
  ['成交方式', 'terms_of_delivery'],
  ['币制', 'currency'],
  ['总价', 'total_amount']
]

export default function SubmissionPreview({ preview }) {
  if (!preview) return null

  const { form_data: formData = {}, valid } = preview
  const items = formData.items || []

  return (
    <section className="panel gateway-shell">
      <div className="gateway-topbar">
        <div>
          <strong>录入页面</strong>
          <span>报关单录入效果</span>
        </div>
        <div className="gateway-topbar-right">
          <button className="primary-button" disabled={!valid}>提交</button>
        </div>
      </div>

      <div className="gateway-layout">
        <aside className="gateway-sidebar">
          <div className="gateway-brand">BG</div>
          <nav className="gateway-menu">
            <button className="gateway-menu-item gateway-menu-item-active">报关制单</button>
            <button className="gateway-menu-item">单据录入</button>
            <button className="gateway-menu-item">单据列表</button>
            <button className="gateway-menu-item">基础资料</button>
          </nav>
        </aside>

        <div className="gateway-main">
          <div className="gateway-toolbar">
            <div>
              <h3>报关单录入</h3>
              <p className="muted">根据材料解析结果生成录入内容。</p>
            </div>
            <div className="gateway-metrics">
              <div><label>商品行</label><strong>{items.length}</strong></div>
              <div><label>填充状态</label><strong>{valid ? '已生成' : '已载入'}</strong></div>
            </div>
          </div>

          <div className="gateway-card">
            <div className="gateway-card-title">报关单表头</div>
            <div className="gateway-form-grid">
              {PRIORITY_FIELDS.map(([label, key]) => (
                <label className="gateway-field" key={key}>
                  <span>{label}</span>
                  <input readOnly value={formData[key] ?? ''} placeholder="待确认" />
                </label>
              ))}
            </div>
          </div>

          <div className="gateway-card">
            <div className="gateway-card-title">商品表体</div>
            <div className="table-wrap">
              <table className="gateway-table">
                <thead>
                  <tr>
                    <th>项号</th>
                    <th>商品编码</th>
                    <th>商品名称</th>
                    <th>数量</th>
                    <th>单位</th>
                    <th>总价</th>
                    <th>原产国</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`submit-${item.line_no}`}>
                      <td>{item.line_no}</td>
                      <td>{item.product_code || item.hs_code || '-'}</td>
                      <td>{item.product_name_cn || item.product_name_en || '-'}</td>
                      <td>{item.declared_qty ?? '-'}</td>
                      <td>{item.declared_unit || '-'}</td>
                      <td>{item.line_amount ?? '-'}</td>
                      <td>{item.origin_country || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
