const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || (max !== null && value > max)) {
    throw new Error(`${label}: ${min}–${max} 범위의 정수를 입력하세요.`);
  }
  return value;
};

export async function parseApiResponse(response, { prompt } = {}) {
  if (response.ok) return response.json();
  let detail = '';
  if (/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
    try {
      const data = await response.json();
      const message = data?.error;
      if (typeof message === 'string' && message.length <= 240 &&
          !/[<>\u0000-\u001f\u007f]/.test(message) &&
          !(typeof prompt === 'string' && prompt && message.includes(prompt))) {
        detail = message.trim();
      }
    } catch { /* Non-JSON errors must not expose raw gateway responses. */ }
  }
  const error = new Error(`API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  error.status = response.status;
  throw error;
}

export function buildRunRequest(form, models, limits) {
  const repeats = integer(form.inputRepeats, 1, 30, '입력 반복');
  if (typeof form.prompt !== 'string' || !form.prompt.trim()) throw new Error('프롬프트를 입력하세요.');
  const prompt = Array(repeats).fill(form.prompt).join('\n');
  if (prompt.length > limits.inputChars) throw new Error(`반복된 입력은 ${limits.inputChars}자 이하여야 합니다.`);
  if (new TextEncoder().encode(prompt).length > limits.inputChars) {
    throw new Error(`반복된 입력은 UTF-8 ${limits.inputChars}바이트 이하여야 합니다. 한글은 보통 글자당 3바이트입니다.`);
  }
  const allocations = form.allocations;
  if (!Array.isArray(allocations) || allocations.length !== models.length ||
      new Set(allocations.map(x => x.deployment)).size !== models.length ||
      allocations.some(x => !models.some(m => m.deployment === x.deployment))) {
    throw new Error('모든 허용 모델의 할당 비율을 지정하세요.');
  }
  allocations.forEach(x => integer(x.percent, 0, 100, '모델 비율'));
  if (allocations.reduce((sum, x) => sum + x.percent, 0) !== 100) throw new Error('모델 비율 합계는 정확히 100%여야 합니다.');
  return {
    prompt,
    outputTokens: integer(form.outputTokens, 16, limits.outputTokens, '최대 출력 토큰'),
    totalCalls: integer(form.totalCalls, 1, limits.totalCalls, '총 호출'),
    requestsPerSecond: integer(form.requestsPerSecond, 1, limits.requestsPerSecond, '목표 RPS'),
    concurrency: integer(form.concurrency, 1, limits.concurrency, '동시 요청'),
    allocations: allocations.map(({ deployment, percent }) => ({ deployment, percent })),
    fixtures: form.fixtures === true,
  };
}

function delay(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export function createRunner({
  now = () => performance.now(), sleep = delay, call,
  onEvent = () => {}, onState = () => {}, onHalt = () => {},
}) {
  let running = false;
  let stopped = false;
  let reason = null;
  let controller;
  const stop = (why = 'user') => {
    if (stopped) return;
    stopped = true;
    reason = why;
    controller?.abort();
    onHalt(why);
  };
  return {
    stop,
    async run({ totalCalls, requestsPerSecond, concurrency }) {
      if (running) throw new Error('이미 실행 중입니다.');
      integer(totalCalls, 1, 500, '총 호출');
      integer(requestsPerSecond, 1, 50, '목표 RPS');
      integer(concurrency, 1, null, '동시 요청');
      running = true;
      stopped = false;
      reason = null;
      controller = new AbortController();
      let issued = 0;
      let completed = 0;
      let nextAt = now();
      const startedAt = now();
      const pending = new Set();
      const state = () => onState({ issued, completed, inFlight: pending.size, elapsedMs: now() - startedAt });
      try {
        while (!stopped && issued < totalCalls) {
          if (pending.size >= concurrency) { await Promise.race(pending); continue; }
          if (now() < nextAt) { await sleep(nextAt - now(), controller.signal); continue; }
          if (stopped) break;
          const index = issued++;
          // Schedule from the actual issuance time: late timers never create catch-up bursts.
          nextAt = now() + 1000 / requestsPerSecond;
          const task = (async () => call(index))().then(response => {
            const event = response?.event;
            if (!event) throw new Error('잘못된 이벤트 응답');
            if (event.statusCode === 429 || event.outcome === 'throttled') stop('azure-throttled');
            if (event.statusCode === 401 || event.statusCode === 403) stop('authentication');
            onEvent(event, index);
          }).catch(error => {
            const why = error.status === 429 ? 'platform-busy'
              : [401, 403].includes(error.status) ? 'authentication'
              : error.status === 409 ? 'run-conflict' : 'request-error';
            stop(why);
          }).finally(() => { pending.delete(task); completed++; state(); });
          pending.add(task);
          state();
        }
        await Promise.all(pending);
        return { status: stopped ? 'stopped' : 'completed', reason, issued, completed, elapsedMs: now() - startedAt };
      } finally {
        running = false;
      }
    },
  };
}

const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
const outcomes = new Set(['success', 'throttled', 'input_blocked', 'output_blocked', 'error', 'failed', 'cancelled']);

export function createMetrics(models, { liveOnly = false } = {}) {
  const stats = new Map(models.map(({ deployment, model }) => [deployment, {
    deployment, model, calls: 0, successes: 0, throttled: 0, blocked: 0,
    errors: 0, unknownUsage: 0, promptTokens: 0, completionTokens: 0,
    estimatedCostUsd: 0, latencyTotalMs: 0, averageLatencyMs: 0,
  }]));
  const recent = [];
  let total = 0;
  return {
    add(raw) {
      if (liveOnly && raw.mode !== 'live') return;
      const stat = stats.get(raw.deployment);
      if (!stat) return;
      const event = {
        deployment: stat.deployment,
        mode: raw.mode === 'live' ? 'live' : /^(fixture|synthetic)/.test(raw.mode || '') ? 'fixture' : 'unknown',
        outcome: outcomes.has(raw.outcome) ? raw.outcome : 'error',
        statusCode: number(raw.statusCode), latencyMs: number(raw.latencyMs),
        promptTokens: number(raw.promptTokens), completionTokens: number(raw.completionTokens),
        estimatedCostUsd: number(raw.estimatedCostUsd), usageKnown: raw.usageKnown === true,
      };
      total++; stat.calls++;
      if (event.outcome === 'success') stat.successes++;
      else if (event.outcome === 'throttled') stat.throttled++;
      else if (['input_blocked', 'output_blocked'].includes(event.outcome)) stat.blocked++;
      else stat.errors++;
      if (!event.usageKnown) stat.unknownUsage++;
      else { stat.promptTokens += event.promptTokens; stat.completionTokens += event.completionTokens; }
      stat.estimatedCostUsd += event.estimatedCostUsd;
      stat.latencyTotalMs += event.latencyMs;
      stat.averageLatencyMs = stat.latencyTotalMs / stat.calls;
      recent.push(event);
      if (recent.length > 100) recent.shift();
    },
    snapshot(elapsedMs = 0) {
      return { total, observedRps: elapsedMs > 0 ? total / (elapsedMs / 1000) : 0,
        models: Array.from(stats.values(), stat => ({ ...stat })),
        recent: recent.map(event => ({ ...event })) };
    },
  };
}
