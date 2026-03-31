export async function fetchKnowledgeSources() {
  const response = await fetch('/api/security-check/sources')
  return handleResponse(response)
}

export async function querySecurityCheck(query) {
  const response = await fetch('/api/security-check/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })

  return handleResponse(response)
}

export async function streamSecurityCheck(query, handlers = {}) {
  const response = await fetch('/api/security-check/query-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })

  if (!response.ok || !response.body) {
    await handleResponse(response)
    throw new Error('流式请求失败')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalPayload = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      flushChunk(buffer, handlers, (payload) => {
        finalPayload = payload
      })
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split(/\r?\n\r?\n/)
    buffer = chunks.pop() || ''

    chunks.forEach((chunk) => {
      flushChunk(chunk, handlers, (payload) => {
        finalPayload = payload
      })
    })
  }

  if (!finalPayload) {
    throw new Error('未收到最终结果，请稍后重试。')
  }
}

function flushChunk(chunk, handlers, setFinalPayload) {
  const trimmed = String(chunk || '').trim()
  if (!trimmed) return

  const lines = trimmed.split(/\r?\n/)
  const eventLine = lines.find((line) => line.startsWith('event:'))
  const dataLines = lines.filter((line) => line.startsWith('data:'))
  if (!dataLines.length) return

  const event = eventLine ? eventLine.slice(6).trim() : 'message'
  const raw = dataLines.map((line) => line.slice(5).trim()).join('\n')

  try {
    const payload = JSON.parse(raw)
    if (event === 'message') handlers.onMessage?.(payload)
    if (event === 'raw') handlers.onRaw?.(payload)
    if (event === 'final') {
      setFinalPayload(payload)
      handlers.onFinal?.(payload)
    }
  } catch {
    handlers.onRaw?.({ data: raw })
  }
}

async function handleResponse(response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || '请求失败')
  }

  return response.json()
}
