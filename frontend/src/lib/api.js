export async function fetchSamplePackets() {
  const response = await fetch('/api/sample-packets')
  if (!response.ok) throw new Error('加载示例数据包失败')
  return response.json()
}

export async function parseUploadedFiles(files) {
  const form = new FormData()
  files.forEach((file) => form.append('files', file))
  const response = await fetch('/api/parse', {
    method: 'POST',
    body: form
  })
  return handleResponse(response)
}

export async function parseSamplePacket(id) {
  const response = await fetch(`/api/sample-packets/${id}/parse`, {
    method: 'POST'
  })
  return handleResponse(response)
}

export async function resolveIssues(documents, resolutions) {
  const response = await fetch('/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents, resolutions })
  })
  return handleResponse(response)
}

export function getSampleFileUrl(packetId, index) {
  return `/api/sample-packets/${packetId}/files/${index}`
}

async function handleResponse(response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || '请求失败')
  }
  return response.json()
}
