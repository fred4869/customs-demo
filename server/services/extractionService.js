import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { enrichWithDashScope } from '../lib/dashscope.js'
import {
  detectCurrency,
  extname,
  maybeCountry,
  normalizeKey,
  normalizeUnit,
  normalizeWhitespace,
  parseNumber,
  round2,
  toFileId,
  uniqBy
} from '../lib/utils.js'

const DOC_TYPES = {
  invoice: 'invoice',
  packing: 'packing_list',
  manifest: 'cargo_manifest',
  reference: 'declaration_reference',
  other: 'other'
}

const COUNTRY_WORDS = ['france', 'china', 'usa', 'united states', 'germany', 'japan', 'czech']
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sampleAssetRoot = path.join(repoRoot, 'sample-assets')

export async function loadFilesFromSample(packet) {
  const files = []
  for (const filePath of packet.files) {
    const resolvedPath = await resolveSampleFilePath(filePath)
    const buffer = await fs.readFile(resolvedPath)
    files.push({
      buffer,
      originalname: path.basename(resolvedPath),
      mimetype: getMimeFromPath(resolvedPath),
      sourcePath: resolvedPath
    })
  }
  return files
}

export async function resolveSampleFilePath(filePath) {
  const directCandidates = path.isAbsolute(filePath)
    ? [filePath]
    : [path.resolve(repoRoot, filePath), path.resolve(sampleAssetRoot, path.basename(filePath))]

  for (const candidate of directCandidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // continue
    }
  }

  try {
    await fs.access(filePath)
    return filePath
  } catch {
    const normalizedTarget = normalizePathToken(filePath)
    const searchRoots = [sampleAssetRoot, '/Users/alfred/Downloads']
    const segments = filePath.split('/').filter(Boolean)
    const filename = segments.at(-1)
    const parentName = segments.at(-2)

    let candidates = []
    for (const root of searchRoots) {
      candidates.push(...await walkFiles(root, 4))
    }
    const exactNameMatch = candidates.find((candidate) => normalizePathToken(candidate) === normalizedTarget)
    if (exactNameMatch) return exactNameMatch

    const filenameMatch = candidates.find((candidate) => {
      const sameFile = normalizePathToken(path.basename(candidate)) === normalizePathToken(filename)
      const sameParent = parentName ? normalizePathToken(path.basename(path.dirname(candidate))) === normalizePathToken(parentName) : true
      return sameFile && sameParent
    })

    if (filenameMatch) return filenameMatch
    throw new Error(`Sample file not found: ${filePath}`)
  }
}

export async function extractDocuments(files, dashscopeConfig) {
  const documents = []
  for (const [index, file] of files.entries()) {
    const filename = decodeFilename(file.originalname)
    const rawText = await readFileText({ ...file, originalname: filename })
    const documentType = classifyDocument(filename, rawText)
    const extraction = extractStructuredData({
      fileId: toFileId(filename, index),
      sourceIndex: index,
      filename,
      documentType,
      text: rawText,
      buffer: file.buffer,
      mimetype: file.mimetype
    })

    let llmSupplement = null
    try {
      llmSupplement = await enrichWithDashScope({
        ...dashscopeConfig,
        text: rawText,
        documentType
      })
    } catch (error) {
      llmSupplement = { error: error.message }
    }

    documents.push(mergeSupplement(extraction, llmSupplement, file.sourcePath))
  }
  return documents
}

function decodeFilename(filename = '') {
  try {
    const decoded = Buffer.from(filename, 'latin1').toString('utf8')
    const originalScore = scoreReadableFilename(filename)
    const decodedScore = scoreReadableFilename(decoded)
    return decodedScore > originalScore ? decoded : filename
  } catch {
    return filename
  }
}

function scoreReadableFilename(value = '') {
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length
  const ascii = (value.match(/[A-Za-z0-9._()\- ]/g) || []).length
  const mojibake = (value.match(/[ÃÂÐÑ]/g) || []).length
  return cjk * 5 + ascii - mojibake * 4
}

function normalizePathToken(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function walkFiles(root, maxDepth = 3, depth = 0) {
  if (depth > maxDepth) return []
  let entries = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const files = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isFile()) {
      files.push(fullPath)
      continue
    }
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath, maxDepth, depth + 1))
    }
  }
  return files
}

async function readFileText(file) {
  const extension = extname(file.originalname)
  if (['.xlsx', '.xls'].includes(extension)) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' })
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
      return [`# ${sheetName}`, ...rows.map((row) => row.join(' | '))].join('\n')
    }).join('\n\n')
  }

  if (extension === '.pdf') {
    let parser
    try {
      const { PDFParse } = await import('pdf-parse')
      parser = new PDFParse({ data: file.buffer })
      const result = await parser.getText()
      if (result.text?.trim()) return result.text
    } catch {
      // ignore and use binary fallback below
    } finally {
      await parser?.destroy().catch(() => {})
    }
  }

  return file.buffer.toString('utf8').replace(/\u0000/g, ' ')
}

function classifyDocument(filename, text) {
  const name = normalizeKey(filename)
  const sample = `${name} ${normalizeKey(text).slice(0, 5000)}`

  if (/报关资料|9710|一般贸易|declaration/.test(name)) return DOC_TYPES.reference
  if (/hawb|awb|air waybill|idoc#|edi|sum value/.test(sample)) return DOC_TYPES.manifest
  if (/packing list|parcel no|gross wght|section 1: content|handling unit/.test(sample)) return DOC_TYPES.packing
  if (/net weight/.test(sample)) return DOC_TYPES.manifest
  if (/报关|general trade|一般贸易|proforma invoice/.test(sample) && !/originalinvoice/.test(name)) return DOC_TYPES.reference
  if (sample.includes('invoice')) return DOC_TYPES.invoice
  return DOC_TYPES.other
}

function extractStructuredData({ fileId, sourceIndex, filename, documentType, text }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)

  const lineItems = extractLineItems(documentType, lines, filename)
  const header = buildHeaderCandidates(documentType, lines, filename, lineItems)

  return {
    file_id: fileId,
    source_index: sourceIndex,
    file_name: filename,
    document_type: documentType,
    text_excerpt: normalizeWhitespace(text).slice(0, 800),
    raw_text: text,
    header_candidates: header,
    line_items: lineItems,
    evidence_blocks: lines.slice(0, 30).map((line, index) => ({ id: `${fileId}:line:${index + 1}`, text: line }))
  }
}

function buildHeaderCandidates(documentType, lines, filename, lineItems = []) {
  const text = lines.join('\n')
  const fileNameText = normalizeWhitespace(filename)
  const normalizedLines = lines.map((line) => normalizeWhitespace(line))
  const header = {
    import_export_flag: [],
    declaration_template: [],
    domestic_consignor: [],
    overseas_consignor: [],
    buyer_seller: [],
    trade_country: [],
    destination_country: [],
    origin_country: [],
    transport_mode: [],
    package_count: [],
    gross_weight_kg: [],
    net_weight_kg: [],
    currency: [],
    total_amount: [],
    terms_of_delivery: []
  }

  pushCandidate(header.declaration_template, documentType === DOC_TYPES.reference ? '历史报关模板' : '统一报关单', 0.7, fileNameText)
  if (documentType === DOC_TYPES.reference && /\bexport\b(?!-control)|出口|9710|by sea|from ningbo port/i.test(text)) {
    pushCandidate(header.import_export_flag, 'export', 0.72, text.slice(0, 160))
  } else if (/import|进口|入保税区|保税区/i.test(text + fileNameText)) {
    pushCandidate(header.import_export_flag, 'import', 0.72, text.slice(0, 160))
  } else {
    pushCandidate(header.import_export_flag, 'import', 0.55, text.slice(0, 120))
  }

  const currency = documentType === DOC_TYPES.manifest ? null : (
    detectCurrency(text) ||
    detectCurrency(normalizedLines.find((line) => /total\s+(?:us\$|usd|eur|cny|\$)/i.test(line)) || '')
  )
  if (currency) pushCandidate(header.currency, currency, 0.92, findEvidence(lines, currency))

  const totalAmount = extractTotalAmount(normalizedLines, text)
  if (totalAmount !== null) pushCandidate(header.total_amount, round2(totalAmount), 0.88, 'total amount')

  const gross = matchNumber(text, [
    /gross(?:\s+wght|\s+weight)?\s*[:：]?\s*([\d.,]+)/i,
    /gross\s+wght\s*\|?\s*([\d.,]+)/i
  ])
  if (gross !== null) pushCandidate(header.gross_weight_kg, round2(gross), 0.9, 'gross weight')

  const net = matchNumber(text, [
    /net(?:\s+weight)?\s*[:：]?\s*([\d.,]+)/i,
    /net\s+weight\s*\|?\s*([\d.,]+)/i
  ])
  if (net !== null) pushCandidate(header.net_weight_kg, round2(net), 0.9, 'net weight')

  const packages = matchNumber(text, [
    /parcel\s+no\s*[:：]?\s*([\d.,]+)/i,
    /packages?\s*[:：]?\s*([\d.,]+)/i,
    /件数\s*[:：]?\s*([\d.,]+)/i,
    /no\.\s*of\s*pieces\s*[:：]?\s*([\d.,]+)/i
  ])
  if (packages !== null) pushCandidate(header.package_count, Math.round(packages), 0.82, 'package count')

  const inco = extractInco(normalizedLines, text)
  if (inco) pushCandidate(header.terms_of_delivery, inco.toUpperCase(), 0.78, inco)

  const overseas = normalizePartyValue(extractParty(normalizedLines, 'seller') || matchText(text, [
    /Shipper's Name and Address[\s\S]{0,180}?(SCHNEIDER ELECTRIC INDUSTRIES SAS)/i,
    /Schneider Electric Industries SAS/i,
    /beneficiary name\s*[:：]?\s*([^\n]+)/i,
    /Consignor\s*[:：]?\s*([^\n]+)/i,
    /seller\s*[:：]?\s*([^\n]+)/i
  ]), PARTY_BLACKLIST)
  if (overseas) pushCandidate(header.overseas_consignor, normalizeWhitespace(overseas), 0.76, overseas)

  const domestic = normalizePartyValue(extractParty(normalizedLines, 'buyer') || matchText(text, [
    /Consignee's Name and Address[\s\S]{0,260}?(SCHNEIDER ELECTRIC \(CHINA\) CO\.,?\s*LTD[^\n]*)/i,
    /Schneider Electric \(China\) Co\. Ltd/i,
    /notify party\s*[:：]?\s*([^\n]+)/i,
    /buyer\s*[:：]?\s*([^\n]+)/i
  ]), PARTY_BLACKLIST)
  if (domestic) {
    pushCandidate(header.domestic_consignor, normalizeWhitespace(domestic), 0.76, domestic)
    pushCandidate(header.buyer_seller, normalizeWhitespace(domestic), 0.7, domestic)
  }

  const countries = uniqBy(
    COUNTRY_WORDS.map((word) => new RegExp(word, 'i').exec(text)?.[0]).filter(Boolean),
    (value) => value.toLowerCase()
  )
  if (countries[0]) pushCandidate(header.trade_country, maybeCountry(countries[0]), 0.7, countries[0])
  if (countries[1]) pushCandidate(header.destination_country, maybeCountry(countries[1]), 0.68, countries[1])
  if (countries[0]) pushCandidate(header.origin_country, maybeCountry(countries[0]), 0.65, countries[0])

  if (/hawb|awb|air/i.test(text)) {
    pushCandidate(header.transport_mode, 'AIR', 0.9, 'HAWB/AWB')
  } else if (/truck|road|陆运/i.test(text)) {
    pushCandidate(header.transport_mode, 'ROAD', 0.7, 'road')
  } else if (/by sea|ocean|vessel/i.test(text)) {
    pushCandidate(header.transport_mode, 'SEA', 0.82, 'sea freight wording')
  }

  if (documentType === DOC_TYPES.reference) {
    pushCandidate(header.declaration_template, /9710/i.test(text + fileNameText) ? '9710参考模板' : '一般贸易参考模板', 0.9, fileNameText)
  }

  if (!header.package_count.length && documentType === DOC_TYPES.packing && lineItems.length) {
    pushCandidate(header.package_count, lineItems.length, 0.66, 'derived from packing rows')
  }

  if (!header.total_amount.length && canDeriveTotalAmount(documentType, lineItems)) {
    const lineTotal = round2(lineItems.reduce((sum, item) => sum + (parseNumber(item.line_amount) ?? 0), 0))
    if (lineTotal) pushCandidate(header.total_amount, lineTotal, 0.68, 'derived from line items')
  }

  return header
}

function extractTotalAmount(lines, text) {
  for (const line of lines) {
    if (!/\btotal\b/i.test(line)) continue
    if (/unit price|total price/i.test(line)) continue
    const matched = line.match(/total(?:\s+amount(?:\s+of\s+invoice)?)?(?:\s*[:：]|\s)+(?:us\$|\$|usd|eur|cny)?\s*([\d,]+(?:\.\d+)?)/i)
    if (matched?.[1]) {
      const value = parseLooseNumber(matched[1])
      if (value !== null) return value
    }
  }

  return matchNumber(text, [
    /total amount(?: of invoice)?\s*[:：]?\s*([\d.,]+)/i,
    /total net amount\s*[:：]?\s*([\d.,]+)/i,
    /sum value\s*\|?\s*([\d.,]+)/i
  ])
}

function extractParty(lines, role) {
  const label = role === 'seller' ? /seller|shipper|consignor/i : /buyer|consignee/i
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!label.test(line)) continue

    const direct = line.match(new RegExp(`${role}\\s*[:：]\\s*(.+)$`, 'i'))
    const directValue = normalizePartyValue(direct?.[1], PARTY_BLACKLIST)
    if (directValue) return directValue

    const inline = line
      .replace(/seller|shipper|consignor|buyer|consignee/gi, '')
      .replace(/[:：]/g, ' ')
      .trim()
    const inlineValue = normalizePartyValue(inline, PARTY_BLACKLIST)
    if (inlineValue) return inlineValue

    const nextValue = normalizePartyValue(lines[index + 1], PARTY_BLACKLIST)
    if (nextValue) return nextValue
  }

  if (role === 'seller') {
    const beneficiaryLine = lines.find((line) => /beneficiary name/i.test(line))
    const beneficiary = normalizePartyValue(beneficiaryLine?.split(/[:：]/).slice(1).join(':').trim(), PARTY_BLACKLIST)
    if (beneficiary) return beneficiary
  }

  if (role === 'buyer') {
    const buyerContext = lines.find((line) => /\bbuyer\b/i.test(line) && !PARTY_BLACKLIST.test(line))
    const buyerValue = normalizePartyValue(buyerContext?.split(/[:：]/).slice(1).join(':').trim(), PARTY_BLACKLIST)
    if (buyerValue) return buyerValue
  }

  return null
}

function normalizePartyValue(value, blacklist) {
  const text = normalizeWhitespace(value || '')
  if (!text) return null
  if (blacklist.test(text)) return null
  if (/\b(fca|cif|fob|exw|ddp|dap)\b/i.test(text)) return null
  if (/^[A-Z ]{1,12}$/.test(text)) return null
  if (/^\d+(\.\d+)*$/.test(text)) return null
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return null
  return text
}

const PARTY_BLACKLIST = /(invoice no|invoice date|contract no|item|products|specification|quantity|unit price|total price|payment|beneficiary|bank|address|packing|delivery time|payment terms|note:|wooden case)/i

function extractInco(lines, text) {
  const direct = matchText(text, [
    /terms of delivery\s*[:：]?\s*([A-Z]{3}(?:\s+[A-Z]+)?)/i,
    /成交方式\s*[:：]?\s*([A-Z]{3,})/i,
    /incoterm\s*[:：]?\s*([A-Z]{3})/i
  ])
  if (direct) return direct

  for (const line of lines) {
    const matched = line.match(/\b(EXW|FCA|FOB|CIF|CFR|DDP|DAP)\b/i)
    if (matched?.[1]) return matched[1]
  }
  return null
}

function parseLooseNumber(value) {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const normalized = text.includes('.') ? text.replace(/,/g, '') : text.replace(/,/g, '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function extractLineItems(documentType, lines, filename) {
  if (documentType === DOC_TYPES.manifest || /\.xlsx?$/i.test(filename)) {
    const rows = lines
      .filter((line) => /\|/.test(line))
      .map((line) => line.split('|').map((cell) => normalizeWhitespace(cell)))
      .filter((row) => row.some(Boolean))

    const headerRow = rows.find((row) => row.some((cell) => /qty|quantity/i.test(cell)) && row.some((cell) => /material|description|commodity/i.test(cell)))
    if (headerRow) {
      const headerIndex = Object.fromEntries(headerRow.map((cell, index) => [normalizeKey(cell), index]))
      const qtyIndex = findHeaderIndex(headerIndex, [/^qty$/, /^quantity/, /quantity \(pc\)/])
      const codeIndex = findHeaderIndex(headerIndex, [/material/, /^design$/])
      const descIndex = findHeaderIndex(headerIndex, [/description/, /commodity&description/, /^products$/])
      const amountIndex = findHeaderIndex(headerIndex, [/sum value/, /^amount$/, /total price/])
      const unitPriceIndex = findHeaderIndex(headerIndex, [/net value/, /unit price/])
      const unitIndex = findHeaderIndex(headerIndex, [/unit$/, /^pc$/, /package/])
      const originIndex = findHeaderIndex(headerIndex, [/country of origin/, /^country$/])
      const startIndex = rows.indexOf(headerRow) + 1

      const items = []
      for (const row of rows.slice(startIndex)) {
        if (!row.some(Boolean)) continue
        const productCode = valueAt(row, codeIndex)
        const productName = valueAt(row, descIndex)
        const quantity = parseNumber(valueAt(row, qtyIndex))
        const amount = parseNumber(valueAt(row, amountIndex))
        const unitPrice = parseNumber(valueAt(row, unitPriceIndex))
        if (!productCode && !productName) continue
        if (quantity === null && amount === null && unitPrice === null) continue

        items.push({
          line_no: items.length + 1,
          product_code: productCode ?? null,
          product_name_cn: containsChinese(productName) ? productName : null,
          product_name_en: productName && !containsChinese(productName) ? productName : null,
          spec_model: productCode ?? null,
          hs_code: null,
          declared_qty: quantity,
          declared_unit: normalizeUnit(valueAt(row, unitIndex) ?? 'PCS'),
          unit_price: unitPrice,
          line_amount: amount,
          origin_country: maybeCountry(valueAt(row, originIndex) ?? ''),
          source_documents: []
        })
      }

      if (items.length) return items.slice(0, 50)
    }

    const items = []
    for (const row of rows) {
      const maybeCode = row.find((cell) => /^[A-Z0-9-]{4,}$/.test(cell))
      const maybeName = row.find((cell) => /[A-Za-z\u4e00-\u9fff]{4,}/.test(cell) && cell !== maybeCode)
      const numbers = row.map(parseNumber).filter((value) => value !== null)
      if (!maybeCode && !maybeName) continue
      items.push({
        line_no: items.length + 1,
        product_code: maybeCode,
        product_name_cn: containsChinese(maybeName) ? maybeName : null,
        product_name_en: maybeName && !containsChinese(maybeName) ? maybeName : null,
        spec_model: maybeCode,
        hs_code: null,
        declared_qty: numbers[0] ?? null,
        declared_unit: 'PCS',
        unit_price: numbers.length >= 2 ? numbers[numbers.length - 2] : null,
        line_amount: numbers.length >= 1 ? numbers[numbers.length - 1] : null,
        origin_country: maybeCountry(row.find((cell) => /france|china|usa|czech/i.test(cell)) ?? ''),
        source_documents: []
      })
    }

    if (items.length) return items.slice(0, 30)
  }

  const joined = lines.join('\n')
  const regexes = [
    /\b([A-Z0-9-]{5,})\b\s+([A-Z][A-Z0-9 ,+\-\/()]{4,})\s+([\d.,]+)\s+(\d+)\s+([\d.,]+)/g,
    /\b([A-Z0-9-]{5,})\b\s+(.{4,60}?)\s+([\d.,]+)\s+(\d+)\s+([\d.,]+)/g
  ]

  for (const regex of regexes) {
    const items = []
    for (const match of joined.matchAll(regex)) {
      items.push({
        line_no: items.length + 1,
        product_code: normalizeWhitespace(match[1]),
        product_name_cn: containsChinese(match[2]) ? normalizeWhitespace(match[2]) : null,
        product_name_en: !containsChinese(match[2]) ? normalizeWhitespace(match[2]) : null,
        spec_model: normalizeWhitespace(match[1]),
        hs_code: null,
        declared_qty: parseNumber(match[4]),
        declared_unit: 'PCS',
        unit_price: parseNumber(match[3]),
        line_amount: parseNumber(match[5]),
        origin_country: null,
        source_documents: []
      })
    }
    if (items.length) return items.slice(0, 20)
  }

  const keywordLine = lines.find((line) => /(umbrella|switch|sensor|contactor|按钮|开关)/i.test(line))
  if (keywordLine) {
    return [{
      line_no: 1,
      product_code: null,
      product_name_cn: containsChinese(keywordLine) ? keywordLine : null,
      product_name_en: !containsChinese(keywordLine) ? keywordLine : null,
      spec_model: null,
      hs_code: null,
      declared_qty: null,
      declared_unit: 'PCS',
      unit_price: null,
      line_amount: null,
      origin_country: null,
      source_documents: []
    }]
  }

  if (documentType === DOC_TYPES.reference) {
    return [{
      line_no: 1,
      product_code: 'REFERENCE-GOODS',
      product_name_cn: '参考申报商品',
      product_name_en: 'REFERENCE GOODS',
      spec_model: null,
      hs_code: null,
      declared_qty: null,
      declared_unit: 'PCS',
      unit_price: null,
      line_amount: null,
      origin_country: null,
      source_documents: []
    }]
  }

  return []
}

function mergeSupplement(extraction, llmSupplement, sourcePath) {
  const document = {
    ...extraction,
    source_path: sourcePath ?? null,
    llm_enriched: Boolean(llmSupplement && !llmSupplement.error),
    llm_notes: llmSupplement?.notes ?? null,
    llm_error: llmSupplement?.error ?? null
  }

  if (llmSupplement?.header) {
    for (const [field, value] of Object.entries(llmSupplement.header)) {
      if (value === null || value === undefined || value === '') continue
      document.header_candidates[field] ??= []
      pushCandidate(document.header_candidates[field], value, 0.63, 'DashScope extraction')
    }
  }

  if (Array.isArray(llmSupplement?.line_items) && llmSupplement.line_items.length) {
    const merged = [...document.line_items]
    for (const item of llmSupplement.line_items.slice(0, 10)) {
      merged.push({
        line_no: merged.length + 1,
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
        source_documents: []
      })
    }
    document.line_items = merged
  }

  return document
}

function pushCandidate(target, value, confidence, evidence) {
  if (value === null || value === undefined || value === '') return
  target.push({ value, confidence, evidence })
}

function matchNumber(text, regexes) {
  for (const regex of regexes) {
    const matched = regex.exec(text)
    if (matched?.[1] !== undefined) {
      const value = parseNumber(matched[1])
      if (value !== null) return value
    }
  }
  return null
}

function matchText(text, regexes) {
  for (const regex of regexes) {
    const matched = regex.exec(text)
    if (matched) return normalizeWhitespace(matched[1] ?? matched[0])
  }
  return null
}

function containsChinese(value = '') {
  return /[\u4e00-\u9fff]/.test(value)
}

function findEvidence(lines, needle) {
  return lines.find((line) => line.includes(needle)) ?? needle
}

function findHeaderIndex(headerIndex, patterns) {
  for (const [key, index] of Object.entries(headerIndex)) {
    if (patterns.some((pattern) => pattern.test(key))) return index
  }
  return null
}

function valueAt(row, index) {
  if (index === null || index === undefined || index < 0 || index >= row.length) return null
  const value = normalizeWhitespace(row[index])
  return value || null
}

function canDeriveTotalAmount(documentType, lineItems) {
  if (!lineItems.length) return false
  if (![DOC_TYPES.manifest, DOC_TYPES.reference].includes(documentType)) return false
  if (documentType === DOC_TYPES.manifest && lineItems.length < 3) return false
  const pricedItems = lineItems.filter((item) => parseNumber(item.line_amount) !== null && parseNumber(item.unit_price) !== null)
  if (!pricedItems.length) return false
  return pricedItems.every((item) => {
    const amount = parseNumber(item.line_amount)
    return amount !== null && amount < 1e8
  })
}

function getMimeFromPath(filePath) {
  const extension = extname(filePath)
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (extension === '.xls') return 'application/vnd.ms-excel'
  return 'application/octet-stream'
}
