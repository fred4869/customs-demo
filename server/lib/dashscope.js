import { normalizeWhitespace } from './utils.js'

const SYSTEM_PROMPT = `You are a customs document extraction assistant.
Return compact JSON only. Never invent values. Use null for unknown fields.
Preserve evidence snippets from the source text when possible.`

export async function enrichWithDashScope({ apiKey, model, baseUrl, text, documentType }) {
  if (!apiKey || !text) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Document type: ${documentType}
Extract high-value customs fields from the following text.
Return JSON with keys header, line_items, notes.
Text:
${text.slice(0, 12000)}`
          }
        ]
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DashScope request failed: ${response.status} ${normalizeWhitespace(errorText).slice(0, 200)}`)
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (!content) return null

    return JSON.parse(content)
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('DashScope request timed out after 8s')
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}
