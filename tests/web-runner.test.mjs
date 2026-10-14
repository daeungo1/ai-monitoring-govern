import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../apps/load-demo/web/runner.js', import.meta.url), 'utf8').catch(() => '');
const runner = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const limits = { totalCalls: 500, requestsPerSecond: 50, concurrency: 64, inputChars: 3500, outputTokens: 512 };
const models = [{ deployment: 'one', model: 'Model One' }, { deployment: 'two', model: 'Model Two' }];
const form = { prompt: 'Hello', inputRepeats: 2, outputTokens: 32, totalCalls: 5, requestsPerSecond: 10, concurrency: 2, allocations: [{ deployment: 'one', percent: 70 }, { deployment: 'two', percent: 30 }], fixtures: false };
const success = { deployment: 'one', outcome: 'success', statusCode: 200, latencyMs: 12, promptTokens: 10, completionTokens: 5, estimatedCostUsd: 0.001, usageKnown: true };

test('repeats input within character limits without persisting content', () => {
  assert.equal(runner.buildRunRequest(form, models, limits).prompt, 'Hello\nHello');
  assert.throws(() => runner.buildRunRequest({ ...form, prompt: 'x'.repeat(1800) }, models, limits), /3500/);
  assert.throws(() => runner.buildRunRequest({ ...form, inputRepeats: 31 }, models, limits));
});

test('caps repeated Korean and emoji input at 3500 UTF-8 bytes including separators', () => {
  assert.throws(() => runner.buildRunRequest({ ...form, prompt: '가'.repeat(600) }, models, limits), /UTF-8/);
  assert.throws(() => runner.buildRunRequest({ ...form, inputRepeats: 1, prompt: '😀'.repeat(876) }, models, limits), /UTF-8/);
  const accepted = runner.buildRunRequest({ ...form, prompt: '가'.repeat(583) }, models, limits);
  assert.equal(new TextEncoder().encode(accepted.prompt).length, 3499);
  assert.equal(runner.buildRunRequest({ ...form, inputRepeats: 1, prompt: 'a'.repeat(3500) }, models, limits).prompt.length, 3500);
});

test('validates integer bounds and exact deployment allocations', () => {
  for (const [key, value] of [['outputTokens', 15], ['totalCalls', 501], ['requestsPerSecond', 0], ['concurrency', 1.5]]) {
    assert.throws(() => runner.buildRunRequest({ ...form, [key]: value }, models, limits));
  }
  assert.throws(() => runner.buildRunRequest({ ...form, allocations: [{ deployment: 'one', percent: 100 }] }, models, limits));
  assert.throws(() => runner.buildRunRequest({ ...form, allocations: [{ deployment: 'one', percent: 60 }, { deployment: 'two', percent: 30 }] }, models, limits));
  assert.throws(() => runner.buildRunRequest({ ...form, prompt: ' ' }, models, limits));
  assert.equal(runner.buildRunRequest(form, models, limits).totalCalls, 5);
});

test('accepts concurrency above 64 when the API declares no upper bound', async () => {
  const request = runner.buildRunRequest({ ...form, concurrency: 1000 }, models, { ...limits, concurrency: null });
  assert.equal(request.concurrency, 1000);
  let time = 0;
  const job = runner.createRunner({
    now: () => time, sleep: async ms => { time += ms; }, call: async () => ({ event: success }),
  });
  assert.equal((await job.run(request)).status, 'completed');
});

test('issues finite load at target spacing without late catch-up bursts', async () => {
  let time = 0;
  const issued = [];
  const job = runner.createRunner({
    now: () => time,
    sleep: async ms => { time += ms + 250; },
    call: async index => { issued.push({ index, time }); return { event: success }; },
  });
  const result = await job.run({ totalCalls: 4, requestsPerSecond: 10, concurrency: 3 });
  assert.equal(result.issued, 4);
  assert.deepEqual(issued.map(x => x.index), [0, 1, 2, 3]);
  assert.ok(issued.slice(1).every((x, i) => x.time - issued[i].time >= 100));
  assert.equal(result.status, 'completed');
});

test('limits in-flight calls and stop waits existing calls without issuing new ones', async () => {
  let time = 0;
  const pending = [];
  let active = 0;
  let peak = 0;
  const job = runner.createRunner({
    now: () => time,
    sleep: async ms => { time += ms; },
    call: index => new Promise(resolve => {
      active++; peak = Math.max(peak, active);
      pending.push(() => { active--; resolve({ event: success }); });
    }),
  });
  const running = job.run({ totalCalls: 8, requestsPerSecond: 10, concurrency: 2 });
  for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(pending.length, 2);
  job.stop();
  assert.equal(active, 2);
  pending.forEach(resolve => resolve());
  const result = await running;
  assert.equal(result.issued, 2);
  assert.equal(result.status, 'stopped');
  assert.equal(peak, 2);
});

test('stops on Azure throttling separately from platform HTTP429 and authentication', async () => {
  for (const [response, expected] of [
    [{ event: { ...success, statusCode: 429, outcome: 'throttled' } }, 'azure-throttled'],
    [Object.assign(new Error('busy'), { status: 429 }), 'platform-busy'],
    [Object.assign(new Error('login'), { status: 401 }), 'authentication'],
    [Object.assign(new Error('owner'), { status: 403 }), 'authentication'],
  ]) {
    let time = 0;
    let count = 0;
    const job = runner.createRunner({
      now: () => time, sleep: async ms => { time += ms; },
      call: async () => { count++; if (response instanceof Error) throw response; return response; },
    });
    const result = await job.run({ totalCalls: 5, requestsPerSecond: 1, concurrency: 1 });
    assert.equal(count, 1);
    assert.equal(result.reason, expected);
    assert.equal(result.status, 'stopped');
  }
});

test('rejects duplicate runner invocation', async () => {
  let resolve;
  const job = runner.createRunner({ call: () => new Promise(done => { resolve = done; }) });
  const running = job.run({ totalCalls: 1, requestsPerSecond: 1, concurrency: 1 });
  await assert.rejects(job.run({ totalCalls: 1, requestsPerSecond: 1, concurrency: 1 }));
  job.stop(); resolve({ event: success }); await running;
});

test('stop wakes a pending pacing timer without aborting an issued request', async () => {
  let signal;
  let finishSleep;
  let calls = 0;
  const job = runner.createRunner({
    now: () => 0,
    sleep: (_ms, pacingSignal) => new Promise(resolve => {
      signal = pacingSignal;
      finishSleep = resolve;
      pacingSignal.addEventListener('abort', resolve, { once: true });
    }),
    call: async () => { calls++; return { event: success }; },
  });
  const running = job.run({ totalCalls: 5, requestsPerSecond: 10, concurrency: 2 });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(calls, 1);
  job.stop();
  assert.equal(signal.aborted, true);
  finishSleep();
  const result = await running;
  assert.equal(result.issued, 1);
  assert.equal(result.completed, 1);
});

test('stops on duplicate HTTP409 and network errors without retrying calls', async () => {
  for (const error of [Object.assign(new Error('duplicate'), { status: 409 }), new Error('network')]) {
    const job = runner.createRunner({ call: async () => { throw error; } });
    const result = await job.run({ totalCalls: 3, requestsPerSecond: 50, concurrency: 1 });
    assert.equal(result.issued, 1);
    assert.equal(result.reason, error.status === 409 ? 'run-conflict' : 'request-error');
  }
});

test('redacts telemetry, retains only 100 events, and aggregates all model metrics', () => {
  const metrics = runner.createMetrics(models);
  for (let i = 0; i < 105; i++) {
    metrics.add({ ...success, prompt: 'PRIVATE', output: 'PRIVATE', arbitrary: 'PRIVATE' });
  }
  const snapshot = metrics.snapshot(10000);
  assert.equal(snapshot.recent.length, 100);
  assert.equal(snapshot.total, 105);
  assert.equal(snapshot.observedRps, 10.5);
  assert.equal(snapshot.models[0].successes, 105);
  assert.equal(snapshot.models[0].promptTokens, 1050);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});

test('distinguishes unknown usage and synthetic replay from live telemetry', () => {
  const metrics = runner.createMetrics(models);
  metrics.add({ ...success, mode: 'fixture', usageKnown: false, outcome: 'input_blocked' });
  metrics.add({ ...success, mode: 'live', outcome: 'throttled', statusCode: 429 });
  const snapshot = metrics.snapshot(2000);
  assert.equal(snapshot.models[0].blocked, 1);
  assert.equal(snapshot.models[0].throttled, 1);
  assert.equal(snapshot.models[0].unknownUsage, 1);
  assert.equal(snapshot.recent[0].mode, 'fixture');
  assert.equal(snapshot.models[0].promptTokens, 10);
  assert.equal(snapshot.models[0].completionTokens, 5);
});

test('recognizes prefixed synthetic replay modes without copying raw event fields', () => {
  const metrics = runner.createMetrics(models);
  metrics.add({ ...success, mode: 'fixture-input', filters: { prompt: 'PRIVATE' } });
  metrics.add({ ...success, mode: 'synthetic-output' });
  const snapshot = metrics.snapshot(1000);
  assert.deepEqual(snapshot.recent.map(event => event.mode), ['fixture', 'fixture']);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});

test('static hosting allows anonymous API and self-only external resources', async () => {
  const base = new URL('../apps/load-demo/web/', import.meta.url);
  const config = JSON.parse(await readFile(new URL('staticwebapp.config.json', base), 'utf8'));
  assert.deepEqual(config.routes.find(x => x.route === '/api/*').allowedRoles, ['anonymous']);
  assert.match(config.globalHeaders['Content-Security-Policy'], /connect-src 'self'/);
  const html = await readFile(new URL('index.html', base), 'utf8');
  assert.match(html, /lang="ko"/);
  assert.match(html, /id="start-button"/);
  assert.match(html, /id="stop-button"/);
  assert.doesNotMatch(html, /\.auth\/|id="(?:identity|login-link|logout-link)"/);
  assert.match(html, /고객 데모/);
  assert.doesNotMatch(html, /\$20|max="64"/);
  assert.match(html, /비용.*상한.*없/);
  assert.match(html, /UTC/);
  assert.match(html, /누구나.*시작.*중지/);
  assert.ok(!/<script(?![^>]*src=)[^>]*>/i.test(html));
});

test('API failures expose bounded JSON error and HTTP status, never HTML or reflected prompts', async () => {
  const message = 'Daily USD budget cannot reserve this run. Reduce calls/output or wait for the next UTC day.';
  await assert.rejects(runner.parseApiResponse(new Response(JSON.stringify({ error: message, prompt: 'PRIVATE' }), {
    status: 402, headers: { 'Content-Type': 'application/json' },
  })), error => error.status === 402 && error.message === `API HTTP 402: ${message}`);
  for (const [body, contentType] of [
    ['<html>PRIVATE</html>', 'text/html'],
    ['{"error":"<script>PRIVATE</script>"}', 'application/json'],
    ['{"error":"Rejected PRIVATE prompt"}', 'application/json'],
    ['{"error":{"prompt":"PRIVATE"}}', 'application/json'],
    ['not json PRIVATE', 'application/json'],
    [JSON.stringify({ error: 'x'.repeat(1000) }), 'application/json'],
  ]) {
    await assert.rejects(runner.parseApiResponse(new Response(body, {
      status: 503, headers: { 'Content-Type': contentType },
    }), { prompt: 'PRIVATE' }), error => error.status === 503 && error.message === 'API HTTP 503');
  }
});

async function demoPage(startResponse, configuration = {}) {
  const app = await readFile(new URL('../apps/load-demo/web/app.js', import.meta.url), 'utf8');
  const elements = new Map();
  const makeElement = () => ({
    value: '', textContent: '', hidden: false, disabled: false, dataset: {}, children: [], listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setCustomValidity() {},
  });
  const get = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  for (const [id, value] of Object.entries({
    prompt: 'PRIVATE', 'input-repeats': '1', 'output-tokens': '32',
    'total-calls': '5', 'requests-per-second': '10', concurrency: '2',
  })) get(id).value = value;
  const requests = [];
  runInNewContext(app.replace(/^import .*;\r?\n/, ''), {
    ...runner, TextEncoder, performance, encodeURIComponent, console,
    document: {
      getElementById: get,
      createElement: makeElement,
      querySelectorAll: () => get('allocations').children.flatMap(row => row.children.filter(child => child.dataset.deployment)),
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/config') return new Response(JSON.stringify({ models, limits, ...configuration }), { status: 200 });
      if (path === '/api/runs') return startResponse();
      throw new Error('Unexpected endpoint');
    },
  });
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  return { get, requests };
}

test('unlimited web config does not cap concurrency or adopt another visitor run', async () => {
  const page = await demoPage(() => { throw new Error('No start expected'); }, {
    limits: { ...limits, concurrency: null, dailyBudgetUsd: null },
    budget: { accountedUsd: 25, limitUsd: null },
    activeRun: { runId: '12345678-1234-4234-8234-123456789abc' },
  });
  assert.equal(page.get('concurrency').max, '');
  assert.equal(page.get('concurrency').value, '2');
  assert.equal(page.get('start-button').disabled, false);
  assert.match(page.get('budget-metric').textContent, /25.0000.*상한 없음/);
  assert.deepEqual(page.requests.map(request => request.path), ['/api/config']);
});

test('anonymous customer can configure and attempt a run without an identity request', async () => {
  const page = await demoPage(() => new Response(JSON.stringify({
    error: 'Daily USD budget cannot reserve this run. Reduce calls/output or wait for the next UTC day.',
  }), { status: 402, headers: { 'Content-Type': 'application/json' } }));
  assert.deepEqual(page.requests.map(request => request.path), ['/api/config']);
  assert.equal(page.get('settings').disabled, false);
  assert.equal(page.get('start-button').disabled, false);
  await page.get('run-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(page.requests.map(request => request.path), ['/api/config', '/api/runs']);
  assert.match(page.get('error').textContent, /HTTP 402.*Daily USD budget/);
  assert.doesNotMatch(page.get('error').textContent, /PRIVATE|로그인/);
  assert.equal(page.get('start-button').disabled, false);
});

test('HTML start failures stay generic and never introduce account gating', async () => {
  const page = await demoPage(() => new Response('<html>PRIVATE</html>', {
    status: 403, headers: { 'Content-Type': 'text/html' },
  }));
  await page.get('run-form').listeners.submit({ preventDefault() {} });
  assert.match(page.get('error').textContent, /HTTP 403/);
  assert.doesNotMatch(page.get('error').textContent, /PRIVATE|html|로그인/);
  assert.equal(page.get('settings').disabled, false);
  assert.equal(page.get('start-button').disabled, false);
});

test('simple dashboard emphasizes traffic counts with reduced-motion running feedback', async () => {
  const base = new URL('../apps/load-demo/web/', import.meta.url);
  const html = await readFile(new URL('index.html', base), 'utf8');
  const css = await readFile(new URL('styles.css', base), 'utf8');
  const app = await readFile(new URL('app.js', base), 'utf8');
  for (const id of ['running-indicator', 'success-count', 'throttled-count', 'blocked-count']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(!html.includes('평균 ms'));
  assert.ok(!html.includes('관측 추정 비용'));
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.ok(app.includes('label.textContent = model.deployment'));
  assert.ok(html.includes('id="live-traffic"'));
});

test('live traffic counters never include synthetic or unverified events', () => {
  const metrics = runner.createMetrics(models, { liveOnly: true });
  metrics.add({ ...success, mode: 'fixture-input' });
  metrics.add({ ...success, mode: 'unknown' });
  metrics.add({ ...success, mode: 'live' });
  metrics.add({ ...success, mode: 'live', outcome: 'throttled', statusCode: 429 });
  assert.equal(metrics.snapshot(1000).total, 2);
  assert.equal(metrics.snapshot(1000).models[0].successes, 1);
  assert.equal(metrics.snapshot(1000).models[0].throttled, 1);
});
