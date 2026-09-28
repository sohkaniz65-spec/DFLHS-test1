// Claude Code(맥에 설치된 `claude` 명령)를 통해 Claude 를 부른다.
// API 키 대신 Claude Code 에 로그인한 구독(Pro/Max)으로 동작한다.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { UPLOAD_TMP_DIR } from './store.js';

const IS_WIN = process.platform === 'win32';
// 프로그램에 함께 설치된 Claude Code 를 먼저 쓰고, 없으면 컴퓨터에 설치된 claude 를 쓴다
const LOCAL_CLI = path.resolve('node_modules', '.bin', IS_WIN ? 'claude.cmd' : 'claude');
const CLI = process.env.CLAUDE_CLI_PATH || (existsSync(LOCAL_CLI) ? LOCAL_CLI : 'claude');
const TIMEOUT_MS = 25 * 60 * 1000;

let versionCache;
export function cliVersion() {
  if (versionCache !== undefined) return Promise.resolve(versionCache);
  return new Promise((resolve) => {
    execFile(CLI, ['--version'], { shell: IS_WIN, timeout: 20000 }, (err, stdout) => {
      versionCache = err ? null : String(stdout).trim();
      resolve(versionCache);
    });
  });
}

/**
 * content: Messages API 형식의 콘텐츠 블록 배열 (text / image / document)
 * 반환: 스키마에 맞춘 JSON 객체
 */
export async function runClaudeCode({ system, content, schema, model, effort }) {
  // 빈 작업 폴더에서 실행해 개인 설정·CLAUDE.md 가 섞이지 않게 한다
  const cwd = path.join(UPLOAD_TMP_DIR, 'claude-run');
  await fs.mkdir(cwd, { recursive: true });
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', JSON.stringify(schema),
    '--system-prompt', system,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model', model,
  ];
  if (effort) args.push('--effort', effort);

  const env = { ...process.env };
  // 구독 로그인을 쓰도록: 혹시 남아 있는 API 키 환경변수는 넘기지 않는다
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  return new Promise((resolve, reject) => {
    const child = spawn(CLI, args, { cwd, env, shell: IS_WIN });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude 응답이 너무 오래 걸려 중단했습니다. 다시 시도해 주세요.'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === 'ENOENT'
        ? 'Claude Code 를 찾지 못했습니다. 검은 창을 닫고 start.command 를 다시 실행해 주세요.'
        : 'Claude Code 실행 실패: ' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = out.split('\n').filter((l) => l.trim());
      let result = null;
      for (const l of lines) {
        try {
          const j = JSON.parse(l);
          if (j.type === 'result') result = j;
        } catch { /* 진행 메시지 */ }
      }
      if (!result) {
        const msg = (err || out).trim().split('\n').slice(-3).join(' ');
        return reject(new Error(/login|auth|log in|로그인/i.test(msg)
          ? 'Claude Code 에 로그인되어 있지 않습니다. 프로그램 폴더의 login.command 를 더블클릭해 Max 계정으로 로그인하세요.'
          : `Claude Code 오류 (종료 코드 ${code}): ${msg.slice(0, 400)}`));
      }
      if (result.is_error) {
        const msg = String(result.result || result.subtype || '');
        return reject(new Error(/limit|한도|usage/i.test(msg)
          ? 'Max 구독 사용 한도에 걸렸습니다. 한도가 풀린 뒤 다시 시도하세요. ' + msg.slice(0, 200)
          : 'Claude Code 오류: ' + msg.slice(0, 400)));
      }
      if (result.structured_output && typeof result.structured_output === 'object') return resolve(result.structured_output);
      try {
        resolve(JSON.parse(result.result));
      } catch {
        reject(new Error('Claude 응답을 JSON으로 읽지 못했습니다. 다시 시도해 주세요.'));
      }
    });
    const msg = { type: 'user', message: { role: 'user', content } };
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(msg) + '\n');
  });
}
