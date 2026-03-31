import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFinalPayload, createSecurityStream, listSecurityKnowledgeSources, querySecurityKnowledge } from './services/securitySearchService.js'
import { samplePackets } from './data/samplePackets.js'
import { loadFilesFromSampleWithOrigin, extractDocuments } from './services/extractionService.js'
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
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDistDir = path.resolve(serverDir, '../frontend/dist')
const frontendIndexFile = path.join(frontendDistDir, 'index.html')

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

app.get('/api/security-check/sources', (_req, res) => {
  res.json({ sources: listSecurityKnowledgeSources() })
})

app.post('/api/security-check/query', async (req, res, next) => {
  const query = req.body?.query || ''
  try {
    const payload = await querySecurityKnowledge(query)
    res.json(payload)
  } catch (error) {
    next(error)
  }
})

app.post('/api/security-check/query-stream', async (req, res, next) => {
  const query = req.body?.query || ''

  try {
    const remote = await createSecurityStream(query)

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const sendEvent = (event, payload) => {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    if (remote.initialPayload) {
      sendEvent('final', remote.initialPayload)
      res.end()
      return
    }

    const reader = remote.response.body.getReader()
    const decoder = new TextDecoder()
    const events = []
    let buffer = ''
    let aborted = false

    req.on('close', () => {
      aborted = true
      remote.controller?.abort()
    })

    while (!aborted) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''

      chunks.forEach((chunk) => {
        const trimmed = chunk.trim()
        if (!trimmed || trimmed.startsWith(':')) return
        if (!trimmed.startsWith('data:')) return

        const raw = trimmed.slice(5).trim()
        try {
          const payload = JSON.parse(raw)
          events.push(payload)
          sendEvent('message', payload)
        } catch {
          sendEvent('raw', { data: raw })
        }
      })
    }

    if (!aborted) {
      sendEvent('final', buildFinalPayload({ query: remote.query, distribution: remote.distribution, events }))
      res.end()
    }
  } catch (error) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()
    }

    res.write(`event: final\n`)
    res.write(
      `data: ${JSON.stringify({
        query,
        status: 'error',
        rows: [],
        answer_text: '',
        message: error.name === 'AbortError' ? '检索超时，请稍后重试。' : error.message || '检索失败，请稍后重试。',
        transport: { mode: 'langcore-share', eventCount: 0, repoQueries: [] }
      })}\n\n`
    )
    res.end()
  }
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
    const files = await loadFilesFromSampleWithOrigin(packet, getRequestOrigin(req))
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

app.use(express.static(frontendDistDir, { index: false }))

app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
  res.sendFile(frontendIndexFile)
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
