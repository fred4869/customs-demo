import { knowledgeSources } from '../data/securityKnowledgeBase.js'

const SHARE_URL = process.env.LANGCORE_SHARE_URL || 'https://demo.langcore.cn/share/chatbot/cmnd3fu7l0d0o94pg9e7ekp80'
const BOT_ID = process.env.LANGCORE_BOT_ID || 'cmnd3fu7l0d0o94pg9e7ekp80'
const SITE_ORIGIN = new URL(SHARE_URL).origin
const RESOLVE_ACTION_ID = '40fae613b6c85970a28c0a715c470af51ea4ff3212'
const DEFAULT_TIMEOUT_MS = Number(process.env.LANGCORE_TIMEOUT_MS || 180000)
const noHitMessage = '检查依据：\n未检索到明确依据。\n请补充隐患发生区域、涉及设施设备名称、异常现象或现场标识信息后再试。'

export function listSecurityKnowledgeSources() {
  return knowledgeSources
}

export async function querySecurityKnowledge(rawQuery = '') {
  const query = String(rawQuery || '').trim()

  if (!query) {
    return {
      query,
      status: 'empty',
      rows: [],
      answer_text: noHitMessage,
      message: '请输入隐患描述后再试。',
      transport: { mode: 'langcore-share' }
    }
  }

  const distribution = await resolveDistribution(BOT_ID)
  const cookie = await createShadowSession(distribution.shadowSignIn)
  const streamResult = await requestChatCompletion({ query, cookie })
  return buildFinalPayload({ query, distribution, events: streamResult.events, error: streamResult.error })
}

export async function createSecurityStream(rawQuery = '') {
  const query = String(rawQuery || '').trim()

  if (!query) {
    return {
      query,
      distribution: { robotName: '技术规范问答智能体' },
      response: null,
      controller: null,
      initialPayload: {
        query,
        status: 'empty',
        rows: [],
        answer_text: noHitMessage,
        message: '请输入隐患描述后再试。',
        transport: { mode: 'langcore-share', robotName: '技术规范问答智能体', eventCount: 0, repoQueries: [] }
      }
    }
  }

  const distribution = await resolveDistribution(BOT_ID)
  const cookie = await createShadowSession(distribution.shadowSignIn)
  const remote = await openChatCompletionStream({ query, cookie })

  return {
    query,
    distribution,
    response: remote.response,
    controller: remote.controller,
    initialPayload: null
  }
}

async function resolveDistribution(botId) {
  const response = await fetch(`${SITE_ORIGIN}/share/chatbot/${botId}`, {
    method: 'POST',
    headers: {
      'Next-Action': RESOLVE_ACTION_ID,
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'text/x-component'
    },
    body: JSON.stringify([botId])
  })

  if (!response.ok) {
    throw new Error(`获取分享页配置失败: ${response.status}`)
  }

  const text = await response.text()
  const match = text.match(/\n1:(\{.+\})/)
  if (!match) {
    throw new Error('未能解析分享页配置')
  }

  const payload = JSON.parse(match[1])
  if (!payload?.shadowSignIn) {
    throw new Error('分享页未返回 shadowSignIn 配置')
  }

  return payload
}

async function createShadowSession(shadowSignIn) {
  const response = await fetch(`${SITE_ORIGIN}/api/auth/sign-in/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...shadowSignIn,
      isShadow: true,
      rememberMe: false
    })
  })

  if (!response.ok) {
    throw new Error(`影子账号登录失败: ${response.status}`)
  }

  const cookies = response.headers.getSetCookie?.() || []
  const sessionCookie = cookies.find((item) => item.startsWith('__Secure-better-auth.session_token='))
  const rememberCookie = cookies.find((item) => item.startsWith('__Secure-better-auth.dont_remember='))

  if (!sessionCookie) {
    throw new Error('未获取到会话 cookie')
  }

  return [sessionCookie, rememberCookie].filter(Boolean).map(toCookiePair).join('; ')
}

async function openChatCompletionStream({ query, cookie }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(`${SITE_ORIGIN}/api/v1/chatCompletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({
        robotId: BOT_ID,
        sessionId: `local-${Date.now()}`,
        messages: [
          {
            id: `msg-${Date.now()}`,
            role: 'user',
            content: query
          }
        ]
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`chatCompletion 请求失败: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('chatCompletion 未返回可读取流')
    }

    return { response, controller, clear: () => clearTimeout(timeout) }
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

async function requestChatCompletion({ query, cookie }) {
  const remote = await openChatCompletionStream({ query, cookie })

  try {
    const reader = remote.response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const events = []
    let error = ''

    while (true) {
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
          if (payload.type === 'error' && payload.data) {
            error = payload.data
          }
        } catch {
          events.push({ type: 'raw', data: raw })
        }
      })
    }

    return {
      events,
      error,
      repoQueries: events.filter((event) => event.type === 'repo').map((event) => event.data?.query).filter(Boolean)
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { events: [], error: '真实服务响应超时，请稍后重试。', repoQueries: [] }
    }

    throw error
  } finally {
    remote.clear()
  }
}

export function buildFinalPayload({ query, distribution, events = [], error = '' }) {
  const answerText = extractAnswerText(events)
  const rows = parseRowsFromAnswer(answerText)
  const repoQueries = events.filter((event) => event.type === 'repo').map((event) => event.data?.query).filter(Boolean)
  const isNoHit = answerText.includes('未检索到明确依据')

  if (!answerText.trim()) {
    return {
      query,
      status: error ? 'error' : 'pending',
      rows: [],
      answer_text: '',
      message: error || '正在检索，请稍后。',
      transport: {
        mode: 'langcore-share',
        robotName: distribution?.robotName,
        eventCount: events.length,
        repoQueries
      }
    }
  }

  return {
    query,
    status: rows.length ? 'matched' : 'no_hit',
    rows,
    answer_text: answerText,
    message: rows.length ? `已整理 ${rows.length} 条检查依据。` : isNoHit ? '未检索到明确依据。' : '已返回结果文本，但未解析出表格行。',
    transport: {
      mode: 'langcore-share',
      robotName: distribution?.robotName,
      eventCount: events.length,
      repoQueries
    }
  }
}

function extractAnswerText(events) {
  const fragments = []

  events.forEach((event) => {
    if (event.type === 'error') return

    const content = event.content
    if (typeof content === 'string' && content.trim()) {
      fragments.push(content)
      return
    }

    if (Array.isArray(content)) {
      content.forEach((part) => {
        if (typeof part === 'string' && part.trim()) fragments.push(part)
        if (typeof part?.text === 'string' && part.text.trim()) fragments.push(part.text)
        if (typeof part?.content === 'string' && part.content.trim()) fragments.push(part.content)
      })
    }

    if (typeof event.data === 'string' && event.data.trim()) {
      fragments.push(event.data)
    }

    if (typeof event.delta === 'string' && event.delta.trim()) {
      fragments.push(event.delta)
    }
  })

  return fragments.join('').trim()
}

function parseRowsFromAnswer(answerText = '') {
  const text = String(answerText || '').trim()
  if (!text || text.includes('未检索到明确依据')) return []

  const normalized = text.replace(/\r/g, '')
  const pattern = /(?:^|\n)(\d+)\.\s*文件名[:：]\s*(.+?)\s*条款号[:：]\s*([^\n]+)\n依据片段[:：]\s*([^\n]+)/g
  const rows = []
  let match

  while ((match = pattern.exec(normalized))) {
    rows.push({
      id: Number(match[1]),
      fileName: match[2].trim(),
      clauseNo: match[3].trim(),
      evidence: match[4].trim()
    })
  }

  if (rows.length) return rows

  const tableRows = parseMarkdownTable(normalized)
  return tableRows.map((row, index) => ({ id: index + 1, ...row }))
}

function parseMarkdownTable(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('|'))

  if (lines.length < 3) return []

  const rows = lines
    .slice(2)
    .map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 4)
    .map((cells) => ({
      fileName: cells[1],
      clauseNo: cells[2],
      evidence: cells[3]
    }))

  return rows
}

function toCookiePair(cookie) {
  return cookie.split(';')[0]
}
