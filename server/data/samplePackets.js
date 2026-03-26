export const samplePackets = [
  {
    id: 'schneider-bonded',
    label: '施耐德入保税区单证包',
    description: 'Invoice + Packing List + EDI + 运单，适合演示多文档归并与字段决策。',
    files: [
      'sample-assets/schneider-bonded/CV01683476 - OriginalInvoice - 9146017012.PDF',
      'sample-assets/schneider-bonded/CV01683476 - Packing List - 1.PDF',
      'sample-assets/schneider-bonded/EDI.xlsx',
      'sample-assets/schneider-bonded/EMAIL COPY - HAWB No_ CDGA23334323.PDF'
    ]
  },
  {
    id: 'generic-reference',
    label: '一般贸易参考资料',
    description: '参考报关资料，可单独输入或作为统一报关单的增强资料。',
    files: ['sample-assets/reference/一般贸易 报关资料(1).pdf']
  },
  {
    id: 'cross-border-9710',
    label: '9710 参考报关资料',
    description: 'Excel 版参考申报资料，可作为商品名、编码和模板映射来源。',
    files: ['sample-assets/reference/9710报关资料雨伞101件(1).xls']
  },
  {
    id: 'mixed-demo',
    label: '混合演示数据包',
    description: '施耐德业务单证 + 参考报关资料，演示通用引擎兼容不同来源。',
    files: [
      'sample-assets/schneider-bonded/CV01683476 - OriginalInvoice - 9146017012.PDF',
      'sample-assets/schneider-bonded/CV01683476 - Packing List - 1.PDF',
      'sample-assets/schneider-bonded/EDI.xlsx',
      'sample-assets/reference/9710报关资料雨伞101件(1).xls',
      'sample-assets/reference/一般贸易 报关资料(1).pdf'
    ]
  }
]
