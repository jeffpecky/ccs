type ResponseHeaders = Headers | Record<string, string> | Array<[string, string]>;

const JSON_TRANSLATION_ERROR_MESSAGE = 'Failed to translate OpenAI-compatible JSON response';
const STREAM_TRANSLATION_ERROR_MESSAGE = 'Failed to translate OpenAI-compatible SSE response';

interface OpenAIResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenAIChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function createAnthropicErrorPayload(type: string, message: string) {
  return { type: 'error', error: { type, message } };
}

export function createAnthropicErrorResponse(
  status: number,
  type: string,
  message: string,
  headers?: ResponseHeaders
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  responseHeaders.delete('Content-Encoding');
  responseHeaders.delete('Content-Length');

  return new Response(JSON.stringify(createAnthropicErrorPayload(type, message)), {
    status,
    headers: responseHeaders,
  });
}

function mapStopReason(finishReason: string | null | undefined): string {
  switch (finishReason) {
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
    default:
      return 'end_turn';
  }
}

function convertOpenAIJsonToAnthropic(openai: OpenAIResponse) {
  const choice = openai.choices?.[0];
  const message = choice?.message;
  const content: Array<Record<string, unknown>> = [];

  if (message?.reasoning_content) {
    content.push({ type: 'thinking', thinking: message.reasoning_content });
  }

  if (message?.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (Array.isArray(message?.tool_calls)) {
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = {};
      }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    type: 'message',
    id: openai.id || `msg_${Date.now()}`,
    model: openai.model || 'unknown',
    role: 'assistant',
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    usage: {
      input_tokens: openai.usage?.prompt_tokens ?? 0,
      output_tokens: openai.usage?.completion_tokens ?? 0,
    },
  };
}

function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function hasTranslatableChoices(value: unknown): value is OpenAIResponse {
  if (typeof value !== 'object' || value === null) return false;
  const { choices } = value as OpenAIResponse;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const firstChoice = choices[0];
  if (typeof firstChoice !== 'object' || firstChoice === null) return false;
  const message = firstChoice.message;
  return typeof message === 'object' && message !== null;
}

async function createAnthropicErrorProxyResponse(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.delete('Content-Type');
  headers.delete('Content-Length');

  let type =
    response.status === 401
      ? 'authentication_error'
      : response.status === 429
        ? 'rate_limit_error'
        : response.status >= 400 && response.status < 500
          ? 'invalid_request_error'
          : 'api_error';
  let message = `Upstream request failed with status ${response.status}`;

  try {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as {
        error?: { type?: string; message?: string };
        message?: string;
      };
      if (typeof payload?.error?.type === 'string' && payload.error.type.trim()) {
        type = payload.error.type;
      }
      if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
        message = payload.error.message;
      } else if (typeof payload?.message === 'string' && payload.message.trim()) {
        message = payload.message;
      }
    } else {
      const text = (await response.text()).trim();
      if (text.length > 0) message = text;
    }
  } catch {
    // Use defaults
  }

  return createAnthropicErrorResponse(response.status, type, message, headers);
}

async function createAnthropicJsonResponse(response: Response): Promise<Response> {
  try {
    const openAIResponse = (await response.json()) as OpenAIResponse;
    if (!hasTranslatableChoices(openAIResponse)) {
      return createAnthropicErrorResponse(502, 'api_error', JSON_TRANSLATION_ERROR_MESSAGE);
    }

    const anthropicResponse = convertOpenAIJsonToAnthropic(openAIResponse);
    return new Response(JSON.stringify(anthropicResponse), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return createAnthropicErrorResponse(502, 'api_error', JSON_TRANSLATION_ERROR_MESSAGE);
  }
}

function createAnthropicStreamingResponse(response: Response): Response {
  const body = response.body;
  if (!body) {
    return createAnthropicErrorResponse(
      502,
      'api_error',
      'Upstream stream ended before a response body was available'
    );
  }

  const encoder = new TextEncoder();
  const model = 'cursor-model';
  const msgId = `msg_${Date.now()}`;
  let blockIndex = 0;
  let hasStarted = false;
  let hasTextBlock = false;
  let hasThinkingBlock = false;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const enqueue = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(formatSseEvent(event, data)));
      };

      const ensureStarted = () => {
        if (hasStarted) return;
        hasStarted = true;
        enqueue('message_start', {
          type: 'message_start',
          message: {
            type: 'message',
            id: msgId,
            model,
            role: 'assistant',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
      };

      const ensureTextBlock = () => {
        ensureStarted();
        if (!hasTextBlock) {
          hasTextBlock = true;
          enqueue('content_block_start', {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text', text: '' },
          });
        }
      };

      const ensureThinkingBlock = () => {
        ensureStarted();
        if (!hasThinkingBlock) {
          hasThinkingBlock = true;
          enqueue('content_block_start', {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking', thinking: '' },
          });
        }
      };

      const closeCurrentBlock = () => {
        if (hasTextBlock || hasThinkingBlock) {
          enqueue('content_block_stop', {
            type: 'content_block_stop',
            index: blockIndex,
          });
          blockIndex++;
          hasTextBlock = false;
          hasThinkingBlock = false;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data) as OpenAIChunk;
              const choice = chunk.choices?.[0];
              if (!choice) continue;

              if (choice.delta?.reasoning_content) {
                ensureThinkingBlock();
                enqueue('content_block_delta', {
                  type: 'content_block_delta',
                  index: blockIndex,
                  delta: { type: 'thinking_delta', thinking: choice.delta.reasoning_content },
                });
              }

              if (choice.delta?.content) {
                if (hasThinkingBlock) closeCurrentBlock();
                ensureTextBlock();
                enqueue('content_block_delta', {
                  type: 'content_block_delta',
                  index: blockIndex,
                  delta: { type: 'text_delta', text: choice.delta.content },
                });
              }

              if (choice.finish_reason) {
                closeCurrentBlock();
                ensureStarted();
                enqueue('message_delta', {
                  type: 'message_delta',
                  delta: {
                    stop_reason: mapStopReason(choice.finish_reason),
                    stop_sequence: null,
                  },
                  usage: { output_tokens: chunk.usage?.completion_tokens ?? 0 },
                });
                enqueue('message_stop', { type: 'message_stop' });
              }
            } catch {
              enqueue('error', createAnthropicErrorPayload('api_error', STREAM_TRANSLATION_ERROR_MESSAGE));
              controller.close();
              return;
            }
          }
        }

        if (!hasStarted) {
          ensureStarted();
          ensureTextBlock();
          closeCurrentBlock();
          enqueue('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 0 },
          });
          enqueue('message_stop', { type: 'message_stop' });
        }
      } catch {
        if (!hasStarted) {
          enqueue('error', createAnthropicErrorPayload('api_error', STREAM_TRANSLATION_ERROR_MESSAGE));
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(readable, {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function createAnthropicProxyResponse(response: Response): Promise<Response> {
  if (!response.ok) {
    return createAnthropicErrorProxyResponse(response);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isEventStream =
    contentType === 'text/event-stream' || contentType.startsWith('text/event-stream;');

  return isEventStream
    ? createAnthropicStreamingResponse(response)
    : createAnthropicJsonResponse(response);
}
