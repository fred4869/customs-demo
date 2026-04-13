export const samplePackets = [
  {
    id: 'generic-reference',
    label: '一般贸易主样例',
    description: '主流程演示：输入合同 / 发票 / 箱单参考材料，输出报关草单预览与模拟提交。',
    files: ['sample-assets/reference/一般贸易 报关资料(1).pdf']
  },
  {
    id: 'cross-border-9710',
    label: '9710 参考样例',
    description: '参考样例：保留 9710 场景展示，但不作为当前主叙事。',
    files: ['sample-assets/reference/9710报关资料雨伞101件(1).xls']
  },
  {
    id: 'schneider-bonded',
    label: '施耐德参考样例',
    description: '参考样例：展示多单证包解析能力，不作为一般贸易主流程。',
    files: [
      'sample-assets/schneider-bonded/CV01683476 - OriginalInvoice - 9146017012.PDF',
      'sample-assets/schneider-bonded/CV01683476 - Packing List - 1.PDF',
      'sample-assets/schneider-bonded/EDI.xlsx',
      'sample-assets/schneider-bonded/EMAIL COPY - HAWB No_ CDGA23334323.PDF'
    ]
  },
  {
    id: 'mixed-demo',
    label: '混合参考样例',
    description: '参考样例：多来源材料混合输入，仅用于展示兼容性。',
    files: [
      'sample-assets/schneider-bonded/CV01683476 - OriginalInvoice - 9146017012.PDF',
      'sample-assets/schneider-bonded/CV01683476 - Packing List - 1.PDF',
      'sample-assets/schneider-bonded/EDI.xlsx',
      'sample-assets/reference/9710报关资料雨伞101件(1).xls',
      'sample-assets/reference/一般贸易 报关资料(1).pdf'
    ]
  }
]
