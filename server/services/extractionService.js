import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
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
  isReadableExtractedText,
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
const execFileAsync = promisify(execFile)

export async function loadFilesFromSample(packet) {
  return loadFilesFromSampleWithOrigin(packet)
}

export async function loadFilesFromSampleWithOrigin(packet, origin = '') {
  const files = []
  for (const filePath of packet.files) {
    const { buffer, filename, mimetype, sourcePath } = await readSampleFile(filePath, origin)
    files.push({
      buffer,
      originalname: filename,
      mimetype,
      sourcePath
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
    const workbook = buildWorkbookSnapshot({ ...file, originalname: filename })
    const rawText = await readFileText({ ...file, originalname: filename }, workbook)
    const documentType = classifyDocument(filename, rawText)
    const extraction = extractStructuredData({
      fileId: toFileId(filename, index),
      sourceIndex: index,
      filename,
      documentType,
      text: rawText,
      workbook,
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

async function readSampleFile(filePath, origin = '') {
  try {
    const resolvedPath = await resolveSampleFilePath(filePath)
    const buffer = await fs.readFile(resolvedPath)
    return {
      buffer,
      filename: path.basename(resolvedPath),
      mimetype: getMimeFromPath(resolvedPath),
      sourcePath: resolvedPath
    }
  } catch (localError) {
    if (!origin) throw localError

    const response = await fetch(new URL(toPublicSamplePath(filePath), origin))
    if (!response.ok) {
      throw new Error(`Sample file not available: ${filePath}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: path.basename(filePath),
      mimetype: response.headers.get('content-type') || getMimeFromPath(filePath),
      sourcePath: filePath
    }
  }
}

function toPublicSamplePath(filePath = '') {
  return `/${String(filePath)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

async function readFileText(file) {
  const extension = extname(file.originalname)
  if (['.xlsx', '.xls'].includes(extension)) {
    const workbook = buildWorkbookSnapshot(file)
    return workbook
      ? workbook.sheets.map((sheet) => [`# ${sheet.name}`, ...sheet.rows.map((row) => row.join(' | '))].join('\n')).join('\n\n')
      : ''
  }

  if (extension === '.pdf') {
    let parser
    try {
      const { PDFParse } = await import('pdf-parse')
      parser = new PDFParse({ data: file.buffer })
      const result = await parser.getText()
      if (isReadableExtractedText(result.text)) return result.text
    } catch {
      // ignore and fall through
    } finally {
      await parser?.destroy().catch(() => {})
    }

    const pythonText = await readPdfTextWithPython(file)
    const sanitizedPythonText = sanitizePdfText(pythonText)
    if (isReadableExtractedText(sanitizedPythonText)) return sanitizedPythonText
    return ''
  }

  const decoded = file.buffer.toString('utf8').replace(/\u0000/g, ' ')
  return isReadableExtractedText(decoded) ? decoded : ''
}

function sanitizePdfText(value = '') {
  return String(value)
    .replace(/_{20,}/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function readPdfTextWithPython(file) {
  let tempPath = null
  try {
    tempPath = file.path
    if (!tempPath) {
      tempPath = path.join(os.tmpdir(), `customs-demo-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`)
      await fs.writeFile(tempPath, file.buffer)
    }
    const script = [
      'from pypdf import PdfReader',
      'from pathlib import Path',
      'import sys',
      'p = Path(sys.argv[1])',
      "print('\\\\n'.join((page.extract_text() or '') for page in PdfReader(str(p)).pages))"
    ].join('; ')
    const { stdout } = await execFileAsync('python3', ['-c', script, tempPath], {
      maxBuffer: 10 * 1024 * 1024
    })
    return stdout || ''
  } catch {
    return ''
  } finally {
    if (tempPath && tempPath !== file.path) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
    }
  }
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

function extractStructuredData({ fileId, sourceIndex, filename, documentType, text, workbook }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
  const extractionLines = buildExtractionLines(documentType, lines, workbook)

  const lineItems = extractLineItems(documentType, extractionLines, filename, workbook)
  const header = buildHeaderCandidates(documentType, extractionLines, filename, lineItems, workbook)

  return {
    file_id: fileId,
    source_index: sourceIndex,
    file_name: filename,
    document_type: documentType,
    text_excerpt: isReadableExtractedText(extractionLines.join('\n')) ? normalizeWhitespace(extractionLines.join('\n')).slice(0, 800) : '',
    raw_text: isReadableExtractedText(extractionLines.join('\n')) ? extractionLines.join('\n') : '',
    header_candidates: header,
    line_items: lineItems,
    evidence_blocks: extractionLines
      .filter((line) => isReadableExtractedText(line))
      .filter((line) => !/^[_\-=]{10,}$/.test(line))
      .slice(0, 30)
      .map((line, index) => ({ id: `${fileId}:line:${index + 1}`, text: line }))
  }
}

function buildExtractionLines(documentType, lines, workbook) {
  if (documentType === DOC_TYPES.reference && isStructured9710Workbook(workbook)) {
    return build9710SourceLines(workbook)
  }

  if (documentType === DOC_TYPES.reference) {
    const declarationIndex = lines.findIndex((line) => /中华人民共和国海关出口货物报关单|出口货物报关单（最新版）/i.test(line))
    if (declarationIndex > 0) {
      return lines.slice(0, declarationIndex)
    }
  }

  return lines
}

function build9710SourceLines(workbook) {
  const sourceSheets = ['合同', '发票', '装箱单']
    .map((name) => getWorkbookSheet(workbook, name))
    .filter(Boolean)

  return sourceSheets.flatMap((sheet) => [
    `# ${sheet.name}`,
    ...sheet.rows
      .map((row) => row.map((cell) => normalizeWhitespace(cell)).filter(Boolean).join(' | '))
      .filter(Boolean)
  ])
}

function buildHeaderCandidates(documentType, lines, filename, lineItems = [], workbook = null) {
  if (documentType === DOC_TYPES.reference && isStructured9710Workbook(workbook)) {
    return build9710WorkbookHeaderCandidates(workbook, lineItems, filename)
  }

  const text = lines.join('\n')
  const fileNameText = normalizeWhitespace(filename)
  const normalizedLines = lines.map((line) => normalizeWhitespace(line))
  const header = {
    import_export_flag: [],
    declaration_template: [],
    contract_no: [],
    customs_office: [],
    filing_no: [],
    destination_port: [],
    departure_port: [],
    domestic_consignor: [],
    overseas_consignor: [],
    buyer_seller: [],
    trade_country: [],
    destination_country: [],
    origin_country: [],
    transport_mode: [],
    transport_name: [],
    supervision_mode: [],
    levy_nature: [],
    package_type: [],
    package_count: [],
    gross_weight_kg: [],
    net_weight_kg: [],
    currency: [],
    total_amount: [],
    terms_of_delivery: [],
    marks_remarks: []
  }

  if (documentType === DOC_TYPES.reference) {
    applyReferenceSourceHeaderCandidates(header, normalizedLines)
  }

  pushCandidate(header.declaration_template, documentType === DOC_TYPES.reference ? '历史报关模板' : '统一报关单', 0.7, fileNameText)
  if (documentType === DOC_TYPES.reference && /\bexport\b(?!-control)|出口|9710|by sea|from ningbo port|\bfca\b|\bcontract\b/i.test(text)) {
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
  } else if (/\btruck\b|by road|road transport|陆运/i.test(text)) {
    pushCandidate(header.transport_mode, 'ROAD', 0.7, 'road')
  } else if (/by sea|ocean|vessel/i.test(text)) {
    pushCandidate(header.transport_mode, 'SEA', 0.82, 'sea freight wording')
  }

  if (documentType === DOC_TYPES.packing) {
    const totalNet = matchNumber(text, [/total net weight\s*[:：]?\s*([\d.,]+)/i])
    const totalGross = matchNumber(text, [/total gross weight\s*[:：]?\s*([\d.,]+)/i])
    if (totalNet !== null) pushCandidate(header.net_weight_kg, round2(totalNet), 0.94, 'packing list total net')
    if (totalGross !== null) pushCandidate(header.gross_weight_kg, round2(totalGross), 0.94, 'packing list total gross')
  }

  if (documentType === DOC_TYPES.reference) {
    pushCandidate(header.declaration_template, /9710/i.test(text + fileNameText) ? '9710参考模板' : '一般贸易参考模板', 0.9, fileNameText)
  }

  const packages = matchNumber(text, [
    /parcel\s+no\s*[:：]?\s*([\d.,]+)/i,
    /number of parcels\s*[:：]?\s*([\d.,]+)/i,
    /^packages?\s*[:：]?\s*([\d.,]+)$/im,
    /件数\s*[:：]?\s*([\d.,]+)/i,
    /no\.\s*of\s*pieces\s*[:：]?\s*([\d.,]+)/i
  ])
  if (packages !== null && !header.package_count.length) {
    pushCandidate(header.package_count, Math.round(packages), 0.82, 'package count')
  }

  const inco = extractInco(normalizedLines, text)
  if (inco && !header.terms_of_delivery.length) {
    pushCandidate(header.terms_of_delivery, inco.toUpperCase(), 0.78, inco)
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
  if (text.length > 90) return null
  const digitCount = (text.match(/\d/g) || []).length
  if (digitCount > Math.max(8, text.length * 0.2)) return null
  if (!/[A-Za-z\u4e00-\u9fff]/.test(text)) return null
  return text
}

const PARTY_BLACKLIST = /(invoice no|invoice date|contract no|item|products|specification|quantity|unit price|total price|payment|beneficiary|bank|address|packing|delivery time|payment terms|note:|wooden case|subject to the conditions of contract|unless specific contrary instructions|carriage|reverse hereof|shipment may be carried via intermediate stopping|shipper agrees|places which the carrier deems appropriate|shipper'?s attention is drawn|copies 1, 2 and 3 of this air waybill|it is agreed that the goods described herein|notice concerning carrier'?s limitation of liability|may increase such|limited to those of the european union|this includes, but is not limited to shipment or transfer|causes the to violate, such laws or regulations|signature of or his agent|total prepaid total collect)/i

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

function extractLineItems(documentType, lines, filename, workbook = null) {
  if (documentType === DOC_TYPES.reference && isStructured9710Workbook(workbook)) {
    const workbookItems = extract9710WorkbookLineItems(workbook)
    if (workbookItems.length) return workbookItems
  }

  if (documentType === DOC_TYPES.reference) {
    const sourceTradeItems = extractReferenceSourceTradeItems(lines)
    if (sourceTradeItems.length) return sourceTradeItems

    const tradeItems = extractReferenceTradeItems(lines)
    if (tradeItems.length) return tradeItems
  }

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

  return []
}

function extractReferenceDeclarationItems(lines) {
  const items = []
  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine)
    if (!/^\d{10}\s+/.test(line)) continue
    if (!/(USD|CNY|EUR)\b/i.test(line)) continue

    const matched = line.match(
      /^(\d{10})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(台|卷|千克|公斤|KG|KGS|PCS|SET|SETS)\s+([^\s]+)\s+([^\s]+)\s+(?:US\$|\$)?([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([A-Z]{3})$/i
    )
    if (!matched) continue

    const [, hsCode, productNameRaw, qtyRaw, unitRaw, destinationRaw, originRaw, unitPriceRaw, lineAmountRaw] = matched
    const productName = normalizeWhitespace(productNameRaw)

    items.push({
      line_no: items.length + 1,
      product_code: hsCode,
      product_name_cn: containsChinese(productName) ? productName : null,
      product_name_en: !containsChinese(productName) ? productName : null,
      spec_model: productName,
      hs_code: hsCode,
      declared_qty: parseNumber(qtyRaw),
      declared_unit: normalizeUnit(unitRaw),
      unit_price: parseLooseNumber(unitPriceRaw),
      line_amount: parseLooseNumber(lineAmountRaw),
      origin_country: maybeCountry(originRaw),
      destination_country: maybeCountry(destinationRaw),
      source_documents: []
    })
  }
  return items
}

function extractReferenceTradeItems(lines) {
  const items = []
  const startIndex = lines.findIndex((line) => /item\s+products\s+specification\s+quantity\s+unit price\s+total price/i.test(line))
  if (startIndex < 0) return items

  const stopPatterns = [
    /^total\b/i,
    /^note:/i,
    /^packing list$/i,
    /^contract$/i,
    /^中华人民共和国海关出口货物报关单/i
  ]

  let index = startIndex + 1
  while (index < lines.length) {
    const line = normalizeWhitespace(lines[index])
    if (!line) {
      index += 1
      continue
    }
    if (stopPatterns.some((pattern) => pattern.test(line))) break

    const itemHeader = line.match(/^(\d+)\s+(.+)$/)
    if (!itemHeader) {
      index += 1
      continue
    }

    const [, itemNo, productHead] = itemHeader
    const detailLines = []
    index += 1

    while (index < lines.length) {
      const detailLine = normalizeWhitespace(lines[index])
      if (!detailLine) {
        index += 1
        continue
      }
      if (stopPatterns.some((pattern) => pattern.test(detailLine))) break
      if (/^\d+\s+/.test(detailLine)) break
      detailLines.push(detailLine)
      index += 1
    }

    const qtyLineIndex = detailLines.findIndex((detail) => /\b(US\$|\$)\s*[\d,]+(?:\.\d+)?\s+(US\$|\$)\s*[\d,]+(?:\.\d+)?/i.test(detail))
    if (qtyLineIndex === -1) continue

    const specLines = detailLines.slice(0, qtyLineIndex)
    const qtyLine = detailLines[qtyLineIndex]
    const matched = qtyLine.match(/^(\d+(?:\.\d+)?)\s+([A-Za-z]+)\s+(?:US\$|\$)\s*([\d,]+(?:\.\d+)?)\s+(?:US\$|\$)\s*([\d,]+(?:\.\d+)?)$/i)
    if (!matched) continue

    const [, qtyRaw, unitRaw, unitPriceRaw, lineAmountRaw] = matched
    const productName = normalizeWhitespace(productHead)
    const specModel = normalizeWhitespace(specLines.join(' | ')) || productName

    items.push({
      line_no: Number(itemNo) || items.length + 1,
      product_code: null,
      product_name_cn: containsChinese(productName) ? productName : null,
      product_name_en: !containsChinese(productName) ? productName : null,
      spec_model: specModel,
      hs_code: null,
      declared_qty: parseNumber(qtyRaw),
      declared_unit: normalizeUnit(unitRaw),
      unit_price: parseLooseNumber(unitPriceRaw),
      line_amount: parseLooseNumber(lineAmountRaw),
      origin_country: null,
      source_documents: []
    })
  }

  return items
}

function applyReferenceSourceHeaderCandidates(header, lines) {
  const text = lines.join('\n')
  const contractNo = matchText(text, [/Contract NO\.?\s*[:：]?\s*([A-Z0-9-]+)/i])
  if (contractNo) pushCandidate(header.contract_no, contractNo, 0.93, '合同页')

  const inco = extractInco(lines, text)
  if (inco) pushCandidate(header.terms_of_delivery, inco.toUpperCase(), 0.82, inco)

  const totalLine = lines.find((line) => /^Total\s+\d+\s+Packages?\s+/i.test(line))
  if (totalLine) {
    const matched = totalLine.match(/^Total\s+(\d+)\s+Packages?\s+([\d.,]+)\s+([\d.,]+)(?:\s+[\d.,]+)?$/i)
    if (matched) {
      pushCandidate(header.package_count, parseNumber(matched[1]), 0.9, totalLine)
      pushCandidate(header.gross_weight_kg, parseNumber(matched[2]), 0.88, totalLine)
      pushCandidate(header.net_weight_kg, parseNumber(matched[3]), 0.88, totalLine)
    }
  }
}

function extractReferenceSourceTradeItems(lines) {
  const startIndex = lines.findIndex((line) => /item products specification quantity unit price total price/i.test(line))
  if (startIndex < 0) return []

  const items = []
  let index = startIndex + 1
  while (index < lines.length) {
    const line = normalizeWhitespace(lines[index])
    if (!line) {
      index += 1
      continue
    }
    if (/^contract$/i.test(line)) break
    const inlineItem = line.match(/^(\d+)\s+(.+)$/)
    if (!/^\d+$/.test(line) && !inlineItem) {
      index += 1
      continue
    }

    const lineNo = Number(inlineItem?.[1] ?? line)
    index += 1
    const descriptionLines = inlineItem?.[2] ? [inlineItem[2]] : []
    let quantityLine = null

    while (index < lines.length) {
      const current = normalizeWhitespace(lines[index])
      if (!current) {
        index += 1
        continue
      }
      if (/^\d+(?:\.\d+)?\s+[A-Za-z]+\s+US\$/i.test(current)) {
        quantityLine = current
        index += 1
        break
      }
      const inlineQty = current.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+([A-Za-z]+)\s+US\$([\d,]+(?:\.\d+)?)\s+US\$([\d,]+(?:\.\d+)?)$/i)
      if (inlineQty) {
        if (inlineQty[1]) descriptionLines.push(normalizeWhitespace(inlineQty[1]))
        quantityLine = `${inlineQty[2]} ${inlineQty[3]} US$${inlineQty[4]} US$${inlineQty[5]}`
        index += 1
        break
      }
      if (/^\d+$/.test(current) || /^\d+\s+.+$/.test(current) || /^contract$/i.test(current)) break
      descriptionLines.push(current)
      index += 1
    }

    if (!descriptionLines.length || !quantityLine) continue

    const qtyMatch = quantityLine.match(/^(\d+(?:\.\d+)?)\s+([A-Za-z]+)\s+US\$([\d,]+(?:\.\d+)?)\s+US\$([\d,]+(?:\.\d+)?)$/i)
    if (!qtyMatch) continue

    const [, qtyRaw, unitRaw, unitPriceRaw, lineAmountRaw] = qtyMatch
    const productName = descriptionLines[0]
    const specModel = normalizeWhitespace(descriptionLines.join(' | '))

    items.push({
      line_no: lineNo,
      product_code: null,
      product_name_cn: containsChinese(productName) ? productName : null,
      product_name_en: !containsChinese(productName) ? productName : null,
      spec_model: specModel,
      hs_code: null,
      declared_qty: parseNumber(qtyRaw),
      declared_unit: normalizeUnit(unitRaw),
      unit_price: parseLooseNumber(unitPriceRaw),
      line_amount: parseLooseNumber(lineAmountRaw),
      origin_country: null,
      destination_country: null,
      source_documents: []
    })
  }

  return items
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

function buildWorkbookSnapshot(file) {
  const extension = extname(file.originalname)
  if (!['.xlsx', '.xls'].includes(extension)) return null

  const workbook = XLSX.read(file.buffer, { type: 'buffer' })
  return {
    sheet_names: workbook.SheetNames,
    sheets: workbook.SheetNames.map((sheetName) => ({
      name: sheetName,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
    }))
  }
}

function isStructured9710Workbook(workbook) {
  if (!workbook?.sheet_names?.length) return false
  const names = new Set(workbook.sheet_names.map((name) => normalizeWhitespace(name)))
  return ['合同', '发票', '装箱单', '报关单'].every((name) => names.has(name))
}

function getWorkbookSheet(workbook, targetName) {
  return workbook?.sheets?.find((sheet) => normalizeWhitespace(sheet.name) === targetName) ?? null
}

function build9710WorkbookHeaderCandidates(workbook, lineItems, filename) {
  const header = {
    import_export_flag: [],
    declaration_template: [],
    contract_no: [],
    customs_office: [],
    filing_no: [],
    destination_port: [],
    departure_port: [],
    domestic_consignor: [],
    overseas_consignor: [],
    buyer_seller: [],
    trade_country: [],
    destination_country: [],
    origin_country: [],
    transport_mode: [],
    transport_name: [],
    supervision_mode: [],
    levy_nature: [],
    package_type: [],
    package_count: [],
    gross_weight_kg: [],
    net_weight_kg: [],
    currency: [],
    total_amount: [],
    terms_of_delivery: [],
    marks_remarks: []
  }

  const packingSheet = getWorkbookSheet(workbook, '装箱单')
  const invoiceSheet = getWorkbookSheet(workbook, '发票')
  const contractSheet = getWorkbookSheet(workbook, '合同')
  const sourceSheet = invoiceSheet ?? contractSheet

  pushCandidate(header.import_export_flag, 'export', 0.9, '合同/发票')
  pushCandidate(header.declaration_template, '9710原始材料', 0.92, filename)

  const contractNo = extractWorkbookContractNo(sourceSheet)
  if (contractNo) pushCandidate(header.contract_no, contractNo, 0.96, '合同/发票')

  const routeLine = find9710RouteLine(sourceSheet)
  if (/by sea/i.test(routeLine)) pushCandidate(header.transport_mode, 'SEA', 0.88, routeLine)

  const destinationCountry = extract9710DestinationCountry(routeLine)
  if (destinationCountry) {
    pushCandidate(header.trade_country, destinationCountry, 0.84, routeLine)
    pushCandidate(header.destination_country, destinationCountry, 0.84, routeLine)
  }

  if (/ningbo port/i.test(routeLine)) {
    pushCandidate(header.departure_port, '宁波', 0.82, routeLine)
  }

  pushCandidate(header.origin_country, maybeCountry('china'), 0.8, '合同/装箱单')

  const packingTotals = extract9710PackingTotals(packingSheet)
  if (packingTotals.package_count !== null) pushCandidate(header.package_count, packingTotals.package_count, 0.94, '装箱单 TOTAL')
  if (packingTotals.gross_weight_kg !== null) pushCandidate(header.gross_weight_kg, packingTotals.gross_weight_kg, 0.94, '装箱单 TOTAL')
  if (packingTotals.net_weight_kg !== null) pushCandidate(header.net_weight_kg, packingTotals.net_weight_kg, 0.94, '装箱单 TOTAL')
  if (packingTotals.package_type) pushCandidate(header.package_type, packingTotals.package_type, 0.88, '装箱单 CTN')

  const inco = extractWorkbookInco(sourceSheet)
  if (inco) pushCandidate(header.terms_of_delivery, inco.toUpperCase(), 0.92, '合同/发票')

  const invoiceTotal = extractWorkbookTotal(invoiceSheet ?? contractSheet)
  const derivedTotal = lineItems.length ? round2(lineItems.reduce((sum, item) => sum + (parseNumber(item.line_amount) ?? 0), 0)) : null
  const totalAmount = invoiceTotal ?? derivedTotal
  if (totalAmount !== null) pushCandidate(header.total_amount, totalAmount, 0.94, '发票商品行')

  const currency = detectWorkbookCurrency(sourceSheet) ?? 'USD'
  pushCandidate(header.currency, currency, 0.9, '发票')

  const seller = extractWorkbookSeller(sourceSheet)
  if (seller) pushCandidate(header.overseas_consignor, seller, 0.72, '合同/发票')

  const packingCountry = normalizeWhitespace(cellAt(packingSheet, 5, 0))
  if (packingCountry && /china/i.test(packingCountry)) {
    pushCandidate(header.origin_country, maybeCountry('china'), 0.86, '装箱单')
  }

  const marksRemarks = extract9710ShippingMarks(packingSheet)
  if (marksRemarks) {
    pushCandidate(header.marks_remarks, marksRemarks, 0.84, '装箱单 SHIPPING MARKS')
  }

  return header
}

function extract9710WorkbookLineItems(workbook) {
  const sourceItems = extract9710SourceTradeItems(workbook)
  if (!sourceItems.length) return []

  const routeLine = find9710RouteLine(getWorkbookSheet(workbook, '发票') ?? getWorkbookSheet(workbook, '合同'))
  const destinationCountry = extract9710DestinationCountry(routeLine)
  const originCountry = maybeCountry('china')

  const items = []
  for (const sourceItem of sourceItems) {
    const sourceCategory = inferUmbrellaCategory(sourceItem?.raw_description || '')
    const preferredChineseName = sourceCategory?.cn || sourceItem.summary_description || null
    const preferredEnglishName = sourceCategory?.en || null
    const preferredSpec = normalizeWhitespace(sourceItem?.summary_description || sourceItem?.raw_description || '')
    items.push({
      line_no: items.length + 1,
      product_code: null,
      product_name_cn: preferredChineseName,
      product_name_en: preferredEnglishName,
      spec_model: preferredSpec || null,
      hs_code: null,
      declared_qty: sourceItem.declared_qty,
      declared_unit: normalizeUnit(sourceItem.declared_unit || '把'),
      unit_price: sourceItem.unit_price,
      line_amount: sourceItem.line_amount,
      currency: 'USD',
      origin_country: originCountry,
      destination_country: destinationCountry,
      source_region: null,
      declaration_elements: null,
      source_documents: []
    })
  }

  return items
}

function extract9710SourceTradeItems(workbook) {
  const sheet = getWorkbookSheet(workbook, '发票') ?? getWorkbookSheet(workbook, '合同')
  if (!sheet?.rows?.length) return []

  const items = []
  for (const row of sheet.rows) {
    const description = normalizeWhitespace(row?.[0])
    if (!description || /^COMMODITY&DESCRIPTION$/i.test(description) || /^TOTAL$/i.test(description)) continue
    const qty = parseNumber(row?.[2])
    const unitPrice = parseNumber(row?.[3])
    const unit = normalizeWhitespace(row?.[4])
    const amount = parseNumber(row?.[5])
    if (qty === null && unitPrice === null && amount === null) continue

    items.push({
      raw_description: description,
      summary_description: description.split(/\n+/)[0]?.trim() || description,
      declared_qty: qty,
      declared_unit: unit,
      unit_price: unitPrice,
      line_amount: amount
    })
  }
  return items
}

function extractWorkbookContractNo(sheet) {
  if (!sheet?.rows?.length) return null
  for (const row of sheet.rows) {
    const text = normalizeWhitespace(row.join(' '))
    const matched = text.match(/invoice:\s*([A-Z0-9-]+)/i)
    if (matched?.[1]) return matched[1]
  }
  return null
}

function extractWorkbookInco(sheet) {
  const routeLine = find9710RouteLine(sheet)
  if (/by sea/i.test(routeLine)) return 'FOB'
  return null
}

function detectWorkbookCurrency(sheet) {
  return extractWorkbookTotalSayCurrency(sheet) ?? 'USD'
}

function extractWorkbookTotalSayCurrency(sheet) {
  if (!sheet?.rows?.length) return null
  for (const row of sheet.rows) {
    const text = normalizeWhitespace(row.join(' '))
    if (/u\.s\.dollars/i.test(text)) return 'USD'
    if (/人民币/i.test(text)) return 'CNY'
  }
  return null
}

function extract9710DestinationCountry(routeLine = '') {
  const matched = String(routeLine).match(/to\s+(.+?)\s+by sea/i)
  if (!matched?.[1]) return null
  return maybeCountry(matched[1])
}

function extract9710PackingTotals(sheet) {
  const totals = {
    package_count: null,
    gross_weight_kg: null,
    net_weight_kg: null,
    package_type: null
  }
  if (!sheet?.rows?.length) return totals
  const totalRow = sheet.rows.find((row) => /^TOTAL:?$/i.test(normalizeWhitespace(row?.[0])))
  if (totalRow) {
    totals.package_count = parseNumber(totalRow?.[5]) !== null ? Math.round(parseNumber(totalRow?.[5])) : null
    totals.net_weight_kg = parseNumber(totalRow?.[6]) !== null ? round2(parseNumber(totalRow?.[6])) : null
    totals.gross_weight_kg = parseNumber(totalRow?.[8]) !== null ? round2(parseNumber(totalRow?.[8])) : null
  }
  if (sheetHasCartons(sheet)) totals.package_type = '纸箱'
  return totals
}

function extract9710ShippingMarks(sheet) {
  if (!sheet?.rows?.length) return null
  const marks = sheet.rows
    .slice(1)
    .map((row) => normalizeWhitespace(row?.[0]))
    .filter(Boolean)
    .filter((value) => !/^shipping marks$/i.test(value))
    .filter((value) => !/^from:/i.test(value))
    .filter((value) => !/^total:?$/i.test(value))
  const unique = [...new Set(marks)]
  return unique.length ? unique.join('，') : null
}

function inferUmbrellaCategory(value = '') {
  const text = normalizeWhitespace(value).toLowerCase()
  if (!text) return null
  if (text.includes('car umbrella')) {
    return { cn: '车用雨伞', en: 'Car umbrella' }
  }
  if (text.includes('three fold umbrella')) {
    return { cn: '三折雨伞', en: 'Three fold umbrella' }
  }
  if (text.includes('umbrella')) {
    return { cn: '雨伞', en: 'Umbrella' }
  }
  return null
}

function parseWorkbookQuantityUnit(value) {
  const text = normalizeWhitespace(value)
  if (!text) return { qty: null, unit: null }
  const matched = text.match(/([\d.,]+)\s*([A-Za-z\u4e00-\u9fff]+)/)
  if (!matched) return { qty: parseNumber(text), unit: null }
  return {
    qty: parseNumber(matched[1]),
    unit: matched[2]
  }
}

function normalizeWorkbookCurrency(value) {
  const text = normalizeWhitespace(value)
  if (!text) return null
  if (text.includes('美元')) return 'USD'
  if (text.includes('人民币')) return 'CNY'
  if (/^usd$/i.test(text)) return 'USD'
  if (/^cny$/i.test(text)) return 'CNY'
  return text.toUpperCase()
}

function extractWorkbookTotal(sheet) {
  if (!sheet?.rows?.length) return null
  for (const row of sheet.rows) {
    const firstCell = normalizeWhitespace(row?.[0])
    if (!/^TOTAL$/i.test(firstCell)) continue
    const value = parseNumber(row?.[5])
    if (value !== null) return round2(value)
  }
  return null
}

function extractWorkbookSeller(sheet) {
  if (!sheet?.rows?.length) return null
  for (const row of sheet.rows) {
    const firstCell = normalizeWhitespace(row?.[0])
    if (!/^THE SELLER/i.test(firstCell)) continue
    const seller = normalizeWhitespace(firstCell.replace(/^THE SELLER:\s*/i, ''))
    if (!seller) return null
    if (/^[A-Za-z]+$/.test(seller) && seller.length <= 12) return null
    return seller
  }
  return null
}

function cellAt(sheet, rowIndex, columnIndex) {
  return sheet?.rows?.[rowIndex]?.[columnIndex] ?? ''
}

function find9710RouteLine(sheet) {
  if (!sheet?.rows?.length) return ''
  for (const row of sheet.rows) {
    const text = normalizeWhitespace(row.join(' '))
    if (/from .* port .* by sea/i.test(text)) return text
  }
  return ''
}

function sheetHasCartons(sheet) {
  if (!sheet?.rows?.length) return false
  return sheet.rows.some((row) => /CTN/i.test(normalizeWhitespace(row.join(' '))))
}
