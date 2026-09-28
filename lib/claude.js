// Claude API 호출 공통부. 모든 생성 결과는 JSON 스키마로 받는다.
import Anthropic from '@anthropic-ai/sdk';
import { mockResponse } from './mock.js';
import { runClaudeCode, cliVersion, authStatus } from './claudeCode.js';

export const MODEL = process.env.STUDIO_MODEL || 'claude-opus-5';
export const EFFORT = process.env.STUDIO_EFFORT || 'high';
export const MOCK = process.env.MOCK_CLAUDE === '1';
// subscription: 맥에 로그인된 Claude Code(Max 구독)로 호출 (기본) / api: API 키로 호출
export const BACKEND = process.env.STUDIO_BACKEND === 'api' ? 'api' : 'subscription';
const CLI_MODEL = process.env.STUDIO_CLI_MODEL || 'opus';
let cliInfo = null;
let loggedIn = false;
export async function initBackend() {
  if (BACKEND === 'subscription' && !MOCK) cliInfo = await cliVersion();
}
/** 로그인 상태를 새로 확인 (상태 요청 때마다 호출, 10초 캐시) */
export async function refreshAuth(force) {
  if (BACKEND === 'subscription' && !MOCK && cliInfo) loggedIn = (await authStatus(force)).loggedIn;
}

// 서버 측 자동 재시도(fallbacks)는 Opus 5 계열·Fable 에서만 켠다.
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-fable-5']);
const USE_FALLBACKS = (process.env.STUDIO_FALLBACKS || 'on') !== 'off' && FALLBACK_MODELS.has(MODEL);

let client;
function getClient() {
  if (!client) client = new Anthropic({ timeout: 20 * 60 * 1000 });
  return client;
}

export function apiStatus() {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return {
    mock: MOCK,
    backend: BACKEND,
    model: BACKEND === 'api' ? MODEL : CLI_MODEL,
    effort: EFFORT,
    hasKey,
    cli: cliInfo,
    loggedIn,
    // 생성 가능한 상태인가
    ready: MOCK || (BACKEND === 'api' ? hasKey : Boolean(cliInfo) && loggedIn),
  };
}

export class ClaudeError extends Error {}

/**
 * @param {object} o
 * @param {string} o.kind     작업 종류 (연습 모드 가짜 응답 선택용)
 * @param {string} o.system   시스템 프롬프트 (프로젝트 내 모든 호출이 같은 값 → 캐시 재사용)
 * @param {string} [o.context] 작품·필기·자료 묶음. 캐시 지점으로 표시된다.
 * @param {Array}  [o.attachments] 이미지/PDF 콘텐츠 블록
 * @param {string} o.task     이번 호출의 지시
 * @param {object} o.schema   응답 JSON 스키마
 */
export async function callJSON({ kind, system, context, attachments = [], task, schema, effort = EFFORT, input }) {
  if (MOCK) return mockResponse(kind, input);
  if (BACKEND === 'subscription') {
    const content = [];
    if (context) content.push({ type: 'text', text: context });
    content.push(...attachments);
    content.push({ type: 'text', text: task });
    try {
      return await runClaudeCode({ system, content, schema, model: CLI_MODEL, effort });
    } catch (err) {
      throw new ClaudeError(err.message);
    }
  }
  if (!apiStatus().hasKey) {
    throw new ClaudeError('API 키가 아직 없습니다. 프로그램 폴더의 .env 파일에 ANTHROPIC_API_KEY 를 넣고, 검은 창을 닫은 뒤 start.command 를 다시 실행하세요. (학생용 교안은 키 없이 출력됩니다)');
  }

  const content = [];
  if (context) content.push({ type: 'text', text: context, cache_control: { type: 'ephemeral' } });
  content.push(...attachments);
  content.push({ type: 'text', text: task });

  const params = {
    model: MODEL,
    max_tokens: 64000,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  };

  const stream = USE_FALLBACKS
    ? getClient().beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : getClient().messages.stream(params);

  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ClaudeError('API 키가 올바르지 않습니다. .env 의 ANTHROPIC_API_KEY 를 확인하세요.');
    if (err instanceof Anthropic.RateLimitError) throw new ClaudeError('요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.');
    if (err instanceof Anthropic.APIError) throw new ClaudeError(`Claude API 오류 (${err.status ?? '연결'}): ${err.message}`);
    throw err;
  }

  if (msg.stop_reason === 'refusal') {
    throw new ClaudeError('Claude가 이 요청을 처리하지 않았습니다(refusal). 자료 내용을 조금 바꿔 다시 시도해 주세요.');
  }
  if (msg.stop_reason === 'max_tokens') {
    throw new ClaudeError('응답이 너무 길어 잘렸습니다. 한 번에 만드는 문항 수를 줄여 다시 시도하세요.');
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError('Claude 응답을 JSON으로 읽지 못했습니다. 다시 시도해 주세요.');
  }
}

export function imageBlock(buffer, mediaType) {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } };
}

export function pdfBlock(buffer) {
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
}
