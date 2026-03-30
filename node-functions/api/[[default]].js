import { samplePackets } from '../../server/data/samplePackets.js'
import { extractDocuments, loadFilesFromSampleWithOrigin } from '../../server/services/extractionService.js'
import {
  buildDeclarationDraft,
  buildNormalizedRecord,
  buildSubmissionPreview
} from '../../server/services/normalizationService.js'
import { buildWorkflowView } from '../../server/services/workflowService.js'

const dashscopeConfig = {
  apiKey: process.env.DASHSCOPE_API_KEY || '',
  baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: process.env.DASHSCOPE_MODEL || 'qwen-plus'
}

export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  const pathname = url.pathname

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  try {
    if (pathname === '/api/health' && request.method === 'GET') {
      return json({ ok: true, dashscope_configured: Boolean(dashscopeConfig.apiKey) })
    }

    if (pathname === '/api/sample-packets' && request.method === 'GET') {
      return json(
        samplePackets.map((packet) => ({
          ...packet,
          files: packet.files.map((filePath) => ({ path: filePath }))
        }))
      )
    }

    const sampleFileMatch = pathname.match(/^\/api\/sample-packets\/([^/]+)\/files\/(\d+)$/)
    if (sampleFileMatch && request.method === 'GET') {
      const [, packetId, rawIndex] = sampleFileMatch
      const packet = samplePackets.find((item) => item.id === packetId)
      if (!packet) return json({ error: 'Sample packet not found' }, 404)

      const index = Number(rawIndex)
      if (!Number.isInteger(index) || index < 0 || index >= packet.files.length) {
        return json({ error: 'Sample file not found' }, 404)
      }

      return Response.redirect(new URL(toPublicSamplePath(packet.files[index]), url.origin), 302)
    }

    if (pathname === '/api/parse' && request.method === 'POST') {
      const formData = await request.formData()
      const files = await Promise.all(
        formData.getAll('files').map(async (file) => ({
          buffer: Buffer.from(await file.arrayBuffer()),
          originalname: file.name,
          mimetype: file.type || getMimeFromName(file.name)
        }))
      )
      const payload = await buildDemoPayload(files)
      return json(payload)
    }

    const sampleParseMatch = pathname.match(/^\/api\/sample-packets\/([^/]+)\/parse$/)
    if (sampleParseMatch && request.method === 'POST') {
      const [, packetId] = sampleParseMatch
      const packet = samplePackets.find((item) => item.id === packetId)
      if (!packet) return json({ error: 'Sample packet not found' }, 404)

      const files = await loadFilesFromSampleWithOrigin(packet, url.origin, headersToObject(request.headers))
      const payload = await buildDemoPayload(files)
      const documents = (payload.documents || []).map((document, index) => ({
        ...document,
        source_index: Number.isInteger(document.source_index) ? document.source_index : index,
        preview_url: `/api/sample-packets/${packet.id}/files/${Number.isInteger(document.source_index) ? document.source_index : index}`
      }))

      return json({ ...payload, documents, loaded_packet_id: packet.id, loaded_packet_label: packet.label })
    }

    if (pathname === '/api/resolve' && request.method === 'POST') {
      const body = await request.json()
      const documents = body?.documents
      const resolutions = body?.resolutions ?? []

      if (!Array.isArray(documents)) {
        return json({ error: 'documents is required' }, 400)
      }

      const normalizedRecord = buildNormalizedRecord(documents, resolutions)
      const declarationDraft = buildDeclarationDraft(normalizedRecord)
      const submissionPreview = buildSubmissionPreview(declarationDraft)
      const workflow = buildWorkflowView(documents, normalizedRecord, declarationDraft)

      return json({
        documents,
        normalized_record: normalizedRecord,
        declaration_draft: declarationDraft,
        submission_preview: submissionPreview,
        workflow,
        resolutions
      })
    }

    return json({ error: 'Not Found' }, 404)
  } catch (error) {
    return json({ error: error?.message || 'Internal server error' }, 500)
  }
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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders()
    }
  })
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  }
}

function toPublicSamplePath(filePath = '') {
  return `/${String(filePath)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

function getMimeFromName(filename = '') {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  return 'application/octet-stream'
}

function headersToObject(headers) {
  const result = {}
  for (const [key, value] of headers.entries()) {
    result[key] = value
  }
  return result
}
