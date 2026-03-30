import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { samplePackets } from './data/samplePackets.js'
import { loadFilesFromSample, loadFilesFromSampleWithOrigin, extractDocuments, resolveSampleFilePath } from './services/extractionService.js'
import {
  buildDeclarationDraft,
  buildNormalizedRecord,
  buildSubmissionPreview
} from './services/normalizationService.js'
import { buildWorkflowView } from './services/workflowService.js'

dotenv.config({ path: new URL('../.env', import.meta.url) })

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const port = Number(process.env.PORT || 8787)

const dashscopeConfig = {
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: process.env.DASHSCOPE_MODEL || 'qwen-plus'
}

app.use(cors())
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dashscope_configured: Boolean(dashscopeConfig.apiKey) })
})

app.get('/api/sample-packets', (_req, res) => {
  res.json(
    samplePackets.map((packet) => ({
      ...packet,
      files: packet.files.map((filePath) => ({ path: filePath }))
    }))
  )
})

app.get('/api/sample-packets/:id/files/:index', async (req, res, next) => {
  try {
    const packet = samplePackets.find((item) => item.id === req.params.id)
    if (!packet) {
      res.status(404).json({ error: 'Sample packet not found' })
      return
    }

    const index = Number(req.params.index)
    if (!Number.isInteger(index) || index < 0 || index >= packet.files.length) {
      res.status(404).json({ error: 'Sample file not found' })
      return
    }

    const staticPath = toPublicSamplePath(packet.files[index])
    res.redirect(staticPath)
  } catch (error) {
    next(error)
  }
})

app.post('/api/parse', upload.array('files'), async (req, res, next) => {
  try {
    const files = req.files || []
    const payload = await buildDemoPayload(files)
    res.json(payload)
  } catch (error) {
    next(error)
  }
})

app.post('/api/sample-packets/:id/parse', async (req, res, next) => {
  try {
    const packet = samplePackets.find((item) => item.id === req.params.id)
    if (!packet) {
      res.status(404).json({ error: 'Sample packet not found' })
      return
    }
    const files = await loadFilesFromSampleWithOrigin(packet, getRequestOrigin(req), req.headers)
    const payload = await buildDemoPayload(files)
    const documents = (payload.documents || []).map((document, index) => ({
      ...document,
      source_index: Number.isInteger(document.source_index) ? document.source_index : index,
      preview_url: `/api/sample-packets/${packet.id}/files/${Number.isInteger(document.source_index) ? document.source_index : index}`
    }))
    res.json({ ...payload, documents, loaded_packet_id: packet.id, loaded_packet_label: packet.label })
  } catch (error) {
    next(error)
  }
})

app.post('/api/resolve', async (req, res, next) => {
  try {
    const documents = req.body?.documents
    const resolutions = req.body?.resolutions ?? []
    if (!Array.isArray(documents)) {
      res.status(400).json({ error: 'documents is required' })
      return
    }

    const normalizedRecord = buildNormalizedRecord(documents, resolutions)
    const declarationDraft = buildDeclarationDraft(normalizedRecord)
    const submissionPreview = buildSubmissionPreview(declarationDraft)
    const workflow = buildWorkflowView(documents, normalizedRecord, declarationDraft)

    res.json({
      documents,
      normalized_record: normalizedRecord,
      declaration_draft: declarationDraft,
      submission_preview: submissionPreview,
      workflow,
      resolutions
    })
  } catch (error) {
    next(error)
  }
})

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message || 'Internal server error' })
})

export default app

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (isDirectRun && process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`customs-demo server listening on http://localhost:${port}`)
  })
}

async function buildDemoPayload(files) {
  const documents = await extractDocuments(files, dashscopeConfig)
  const normalizedRecord = buildNormalizedRecord(documents)
  const declarationDraft = buildDeclarationDraft(normalizedRecord)
  const submissionPreview = buildSubmissionPreview(declarationDraft)
  const workflow = buildWorkflowView(documents, normalizedRecord, declarationDraft)

  return {
    packet_id: `pkt_${Date.now()}`,
    documents,
    normalized_record: normalizedRecord,
    declaration_draft: declarationDraft,
    submission_preview: submissionPreview,
    workflow,
    dashscope_configured: Boolean(dashscopeConfig.apiKey)
  }
}

function getMimeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (extension === '.xls') return 'application/vnd.ms-excel'
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (extension === '.doc') return 'application/msword'
  return 'application/octet-stream'
}

function toPublicSamplePath(filePath = '') {
  return `/${String(filePath)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

function getRequestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}
