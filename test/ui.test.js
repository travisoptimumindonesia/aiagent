import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import request from 'supertest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
const origin = 'http://localhost:3000';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await pause(20);
  }
  throw new Error('Timed out waiting for UI state');
}
test('UI flows render, edit curriculum, take quiz, review, chat and retain XSS as text', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mandarin-ui-'));
  const ctx = createApp(
    {
      PUBLIC_URL: origin,
      DB_PATH: path.join(dir, 'db'),
      UPLOAD_DIR: path.join(dir, 'files'),
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'strong-test-password',
    },
    {
      providers: {
        capabilities: () => ({
          chat: true,
          ocr: false,
          speech: false,
          whatsapp: false,
        }),
        chat: async () => '<img src=x onerror=alert(1)> 你好！',
      },
    },
  );
  const agent = request.agent(ctx.app);
  await agent
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: 'admin@example.com', password: 'strong-test-password' })
    .expect(200);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), {
    url: origin,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window,
    d = w.document;
  t.after(() => {
    w.close();
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  w.HanziWriter = {
    create: () => ({
      animateCharacter() {},
      quiz(o) {
        o.onComplete({ totalMistakes: 1 });
      },
    }),
  };
  w.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toLowerCase();
    let r = agent[method](url).set('Origin', origin);
    for (const [k, v] of Object.entries(opts.headers || {})) r = r.set(k, v);
    if (opts.body) r = r.send(opts.body);
    const result = await r;
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
    };
  };
  await w.eval(
    `(async()=>{${readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')}\n})()`,
  );
  assert.match(d.querySelector('h1').textContent, /Administrator/);
  const navigate = async (hash, selector) => {
    w.location.hash = hash;
    await until(() => d.querySelector(selector));
  };
  assert.equal(d.querySelectorAll('.game-chip').length, 3);
  await navigate('#premium', '.plan-grid');
  assert.match(d.querySelector('.premium-hero').textContent, /Mandarin Premium/);
  await navigate('#lessons/1', '#quiz-form');
  d.querySelector('[name=q0][value="1"]').checked = true;
  d.querySelector('[name=q1][value="0"]').checked = true;
  d.querySelector('#quiz-form').dispatchEvent(
    new w.Event('submit', { bubbles: true, cancelable: true }),
  );
  await until(() => d.querySelector('#quiz-result').textContent.includes('100%'));
  assert.match(d.querySelector('#quiz-result').textContent, /\+35 XP/);
  assert.equal(d.querySelector('#chrome-xp').textContent, '35');
  d.querySelector('[data-action=add-cards]').click();
  await until(() => ctx.db.prepare('SELECT count(*) n FROM cards').get().n === 4);
  await navigate('#review', '#review-card');
  d.querySelector('[data-action=reveal]').click();
  assert.equal(d.querySelector('#card-answer').hidden, false);
  d.querySelector('[data-rating="3"]').click();
  await until(() => ctx.db.prepare('SELECT count(*) n FROM reviews').get().n === 1);
  await navigate('#tutor', '#chat-form');
  d.querySelector('#chat-text').value = '你好';
  d.querySelector('#chat-form').dispatchEvent(
    new w.Event('submit', { bubbles: true, cancelable: true }),
  );
  await until(() => d.querySelector('#chat-log').textContent.includes('onerror'));
  assert.equal(d.querySelector('#chat-log img'), null);
  await navigate('#staff', '#user-form');
  d.querySelector('[data-action=new-lesson]').click();
  assert.ok(d.querySelector('#lesson-form'));
  d.querySelector('[data-action=add-word]').click();
  assert.equal(d.querySelectorAll('.editor-word').length, 2);
  await navigate('#practice/你', '#writer');
  await until(() => d.querySelector('#character-pinyin').textContent);
  d.querySelector('[data-action=quiz-hanzi]').click();
  await until(() => ctx.db.prepare('SELECT count(*) n FROM practice').get().n === 1);
  await navigate('#whatsapp', '#wa-consent');
  assert.match(d.querySelector('#content').textContent, /belum diaktifkan/);
  await navigate('#tasks', '#upload-form');
  d.querySelector('#kind').value = 'audio';
  d.querySelector('#kind').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(d.querySelector('#recording-controls').hidden, false);
  await navigate('#account', '#password-form');
  assert.ok(d.querySelector('[autocomplete="new-password"]'));
  assert.deepEqual(errors, []);
});
