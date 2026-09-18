import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { makeWorker } from '../src/worker.js';
const origin = 'http://localhost:3000',
  pwd = 'testing-password-strong';
async function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mandarin-test-'));
  const sent = [];
  const provider = {
    capabilities: () => ({
      chat: true,
      ocr: true,
      speech: false,
      whatsapp: true,
    }),
    chat: async () => '你好！nǐ hǎo — Halo!',
    ocr: async () => ({ text: '你好', confidence: 0.99 }),
    speech: async () => {
      const e = new Error('Penilai suara belum aktif.');
      e.status = 503;
      throw e;
    },
    send: async (phone, text) => {
      sent.push({ phone, text });
      return { id: 'sent' };
    },
    media: async () => ({
      buffer: Buffer.from([255, 216, 255, 1]),
      mimetype: 'image/jpeg',
    }),
  };
  const env = {
    PUBLIC_URL: origin,
    DB_PATH: path.join(dir, 'test.sqlite'),
    UPLOAD_DIR: path.join(dir, 'uploads'),
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: pwd,
    WA_APP_SECRET: 'test-app-secret',
    WA_PHONE_ID: '12345',
    WA_VERIFY_TOKEN: 'verify-me',
    AI_DAILY_LIMIT: '40',
  };
  const ctx = createApp(env, { providers: provider });
  const agent = request.agent(ctx.app);
  t.after(() => {
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const login = await agent
    .post('/api/login')
    .set('Origin', origin)
    .send({ email: env.ADMIN_EMAIL, password: pwd })
    .expect(200);
  const admin = { agent, csrf: login.body.csrf, user: login.body.user };
  function mutate(actor, method, url, body) {
    return actor.agent[method](url)
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .send(body);
  }
  async function account(name, role = 'student', enroll = true) {
    const r = await mutate(admin, 'post', '/api/admin/users', {
      name,
      email: name + '@example.com',
      password: pwd,
      role,
    }).expect(201);
    if (enroll)
      await mutate(admin, 'post', '/api/admin/enrollments', {
        user_id: r.body.id,
        course_id: 1,
        expires: null,
      }).expect(200);
    const a = request.agent(ctx.app);
    const l = await a
      .post('/api/login')
      .set('Origin', origin)
      .send({ email: name + '@example.com', password: pwd })
      .expect(200);
    return { agent: a, csrf: l.body.csrf, user: l.body.user };
  }
  function webhook(id, text, phone = '628123456789', timestamp = Math.floor(Date.now() / 1000)) {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: env.WA_PHONE_ID },
                messages: [
                  {
                    id,
                    from: phone,
                    timestamp: String(timestamp),
                    type: 'text',
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(body);
    const sig = 'sha256=' + createHmac('sha256', env.WA_APP_SECRET).update(raw).digest('hex');
    return request(ctx.app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .send(raw);
  }
  return { ctx, admin, account, mutate, provider, sent, webhook };
}
test('authentication, cookies, CSRF and role boundaries', async (t) => {
  const { ctx, admin, account, mutate } = await fixture(t);
  const student = await account('siswa');
  await request(ctx.app).get('/api/dashboard').expect(401);
  await student.agent.post('/api/chat').set('Origin', origin).send({ text: 'hello' }).expect(403);
  await student.agent
    .post('/api/chat')
    .set('Origin', 'https://attacker.example')
    .set('X-CSRF-Token', student.csrf)
    .send({ text: 'hello' })
    .expect(403);
  await mutate(student, 'post', '/api/admin/users', { name: 'x' }).expect(403);
  await student.agent.get('/api/staff').expect(403);
  const me = await student.agent.get('/api/me').expect(200);
  assert.equal(me.body.user.password, undefined);
  await mutate(admin, 'patch', '/api/admin/users/' + student.user.id, {
    active: false,
  }).expect(200);
  await student.agent.get('/api/me').expect(401);
});
test('enrollment and expiry gate lessons, reviews and tutor; quiz answers stay server-side', async (t) => {
  const { admin, account, mutate } = await fixture(t);
  const student = await account('noaccess', 'student', false);
  await student.agent.get('/api/lessons/1').expect(403);
  await mutate(student, 'post', '/api/chat', { text: '你好' }).expect(403);
  await mutate(admin, 'post', '/api/admin/enrollments', {
    user_id: student.user.id,
    course_id: 1,
    expires: new Date(Date.now() - 60000).toISOString(),
  }).expect(200);
  await student.agent.get('/api/reviews').expect(403);
  await mutate(admin, 'post', '/api/admin/enrollments', {
    user_id: student.user.id,
    course_id: 1,
    expires: null,
  }).expect(200);
  const l = await student.agent.get('/api/lessons/1').expect(200);
  assert.equal(l.body.quiz[0].answer, undefined);
  const quiz = await mutate(student, 'post', '/api/lessons/1/quiz', {
    answers: [1, 0],
    score: 0,
  }).expect(200);
  assert.equal(quiz.body.score, 100);
  await mutate(student, 'post', '/api/lessons/1/quiz', {
    answers: [0, 1],
  }).expect(200);
  const d = await student.agent.get('/api/dashboard');
  assert.equal(d.body.progress[0].score, 100);
});
test('freemium gamification awards idempotent XP, consumes hearts and activates premium', async (t) => {
  const { admin, account, mutate } = await fixture(t);
  const student = await account('gamified');
  const initial = await student.agent.get('/api/gamification').expect(200);
  assert.equal(initial.body.xp, 0);
  assert.equal(initial.body.hearts, 5);
  assert.equal(initial.body.plan, 'free');

  const failed = await mutate(student, 'post', '/api/lessons/1/quiz', {
    answers: [0, 1],
  }).expect(200);
  assert.equal(failed.body.passed, false);
  assert.equal(failed.body.gamification.hearts, 4);
  assert.equal(failed.body.earnedXp, 0);

  const passed = await mutate(student, 'post', '/api/lessons/1/quiz', {
    answers: [1, 0],
  }).expect(200);
  assert.equal(passed.body.earnedXp, 35);
  assert.equal(passed.body.gamification.xp, 35);
  assert.equal(passed.body.gamification.streak, 1);
  assert.equal(passed.body.gamification.goalComplete, true);

  const repeated = await mutate(student, 'post', '/api/lessons/1/quiz', {
    answers: [1, 0],
  }).expect(200);
  assert.equal(repeated.body.earnedXp, 0);
  assert.equal(repeated.body.gamification.xp, 35);

  const writing = await mutate(student, 'post', '/api/practice', {
    hanzi: '你',
    mistakes: 1,
  }).expect(200);
  assert.equal(writing.body.earnedXp, 5);
  assert.equal(writing.body.gamification.xp, 40);

  const until = new Date(Date.now() + 30 * 86400000).toISOString();
  const upgraded = await mutate(admin, 'post', `/api/admin/users/${student.user.id}/plan`, {
    plan: 'premium',
    premium_until: until,
  }).expect(200);
  assert.equal(upgraded.body.gamification.plan, 'premium');
  assert.equal(upgraded.body.gamification.hearts, null);
  const plans = await student.agent.get('/api/plans').expect(200);
  assert.equal(plans.body.current, 'premium');
});
test('FSRS cards are per-user, durable, deduplicated and reject stale/double reviews', async (t) => {
  const { ctx, account, mutate } = await fixture(t);
  const a = await account('a'),
    b = await account('b');
  await mutate(a, 'post', '/api/lessons/1/cards', {}).expect(200);
  await mutate(a, 'post', '/api/lessons/1/cards', {}).expect(200);
  const r = await a.agent.get('/api/reviews').expect(200);
  assert.equal(r.body.length, 4);
  assert.equal((await b.agent.get('/api/reviews')).body.length, 0);
  const c = r.body[0];
  await mutate(b, 'post', '/api/reviews/' + c.id, {
    rating: 3,
    version: 0,
  }).expect(404);
  await mutate(a, 'post', '/api/reviews/' + c.id, {
    rating: 9,
    version: 0,
  }).expect(400);
  const rated = await mutate(a, 'post', '/api/reviews/' + c.id, {
    rating: 3,
    version: 0,
  }).expect(200);
  assert.ok(new Date(rated.body.due) > new Date());
  await mutate(a, 'post', '/api/reviews/' + c.id, {
    rating: 3,
    version: 0,
  }).expect(409);
  assert.equal(ctx.db.prepare('SELECT count(*) n FROM reviews').get().n, 1);
  const saved = JSON.parse(ctx.db.prepare('SELECT state FROM cards WHERE id=?').get(c.id).state);
  assert.equal(saved.reps, 1);
});
test('uploads require consent and file signature; files/results are private; teacher can review', async (t) => {
  const { account, mutate } = await fixture(t);
  const a = await account('a'),
    b = await account('b'),
    teacher = await account('laoshi', 'teacher');
  const upload = (actor, buffer = Buffer.from([255, 216, 255, 1]), consent = 'yes') =>
    actor.agent
      .post('/api/submissions')
      .set('Origin', origin)
      .set('X-CSRF-Token', actor.csrf)
      .field('kind', 'image')
      .field('target', '你好')
      .field('consent', consent)
      .attach('file', buffer, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });
  await upload(a, Buffer.from('<script>alert(1)</script>')).expect(400);
  await upload(a, Buffer.from([255, 216, 255]), 'no').expect(400);
  const s = await upload(a).expect(201);
  assert.equal(s.body.result.matchesTarget, true);
  await b.agent.get(`/api/submissions/${s.body.id}/file`).expect(404);
  assert.equal((await b.agent.get('/api/submissions')).body.length, 0);
  await a.agent.get(`/api/submissions/${s.body.id}/file`).expect(200);
  await mutate(a, 'post', `/api/submissions/${s.body.id}/feedback`, {
    feedback: 'Fake score',
  }).expect(403);
  await mutate(teacher, 'post', `/api/submissions/${s.body.id}/feedback`, {
    feedback: 'Perhatikan goresan terakhir 好.',
  }).expect(200);
  const list = await a.agent.get('/api/submissions');
  assert.equal(list.body[0].status, 'reviewed');
  assert.match(list.body[0].feedback, /好/);
  await mutate(a, 'delete', `/api/submissions/${s.body.id}`, null).expect(200);
  await a.agent.get(`/api/submissions/${s.body.id}/file`).expect(404);
});
test('AI outage retains submissions for teacher without inventing scores', async (t) => {
  const { account, provider, ctx } = await fixture(t);
  const a = await account('a');
  provider.ocr = async () => {
    throw new Error('private provider key must not leak');
  };
  const s = await a.agent
    .post('/api/submissions')
    .set('Origin', origin)
    .set('X-CSRF-Token', a.csrf)
    .field('kind', 'image')
    .field('target', '你好')
    .field('consent', 'yes')
    .attach('file', Buffer.from([255, 216, 255, 1]), 'test.jpg')
    .expect(201);
  assert.equal(s.body.status, 'pending');
  assert.equal(s.body.result.score, undefined);
  assert.doesNotMatch(JSON.stringify(s.body), /private provider/);
  assert.equal(ctx.db.prepare('SELECT count(*) n FROM submissions').get().n, 1);
});
test('chat history isolated; quota enforced even across failed attempts', async (t) => {
  const { account, mutate, ctx } = await fixture(t);
  const a = await account('a'),
    b = await account('b');
  ctx.env.AI_DAILY_LIMIT = '1';
  await mutate(a, 'post', '/api/chat', { text: '你好' }).expect(200);
  assert.equal((await b.agent.get('/api/chat')).body.length, 0);
  assert.equal((await a.agent.get('/api/chat')).body.length, 2);
  await mutate(a, 'post', '/api/chat', { text: 'again' }).expect(429);
  await mutate(a, 'delete', '/api/chat', null).expect(200);
  assert.equal((await a.agent.get('/api/chat')).body.length, 0);
});
test('webhook rejects forged signatures, deduplicates, links with expiring one-time code, and uses shared history', async (t) => {
  const { ctx, account, mutate, webhook, sent } = await fixture(t);
  const a = await account('a');
  const worker = makeWorker(ctx);
  await request(ctx.app)
    .get('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc')
    .expect(200, 'abc');
  await request(ctx.app)
    .post('/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', 'sha256=fake')
    .send('{}')
    .expect(401);
  const link = await mutate(a, 'post', '/api/whatsapp/link', {
    consent: true,
  }).expect(200);
  await webhook('one', 'HUBUNGKAN ' + link.body.code).expect(200);
  await webhook('one', 'HUBUNGKAN ' + link.body.code).expect(200);
  await worker.tick();
  assert.equal(sent.length, 1);
  assert.equal(
    ctx.db.prepare('SELECT phone FROM users WHERE id=?').get(a.user.id).phone,
    '628123456789',
  );
  await webhook('two', 'HUBUNGKAN ' + link.body.code, '628111111111').expect(200);
  await worker.tick();
  assert.match(sent[1].text, /tidak berlaku/);
  await webhook('three', '你好').expect(200);
  await worker.tick();
  assert.equal((await a.agent.get('/api/chat')).body.length, 2);
  await webhook('stale', 'old', '628123456789', Math.floor(Date.now() / 1000) - 86400).expect(200);
  assert.equal(ctx.db.prepare('SELECT 1 FROM jobs WHERE id=?').get('stale'), undefined);
});
test('WhatsApp outbound retry reuses stored response rather than repeating AI work', async (t) => {
  const { ctx, account, webhook, provider } = await fixture(t);
  const a = await account('a');
  ctx.db.prepare('UPDATE users SET phone=? WHERE id=?').run('628123456789', a.user.id);
  let calls = 0;
  provider.chat = async () => {
    calls++;
    return 'Halo';
  };
  provider.send = async () => {
    throw new Error('network');
  };
  const worker = makeWorker(ctx);
  await webhook('retry', '你好').expect(200);
  await worker.tick();
  assert.equal(calls, 1);
  assert.equal(ctx.db.prepare('SELECT status FROM jobs').get().status, 'pending');
  ctx.db.prepare('UPDATE jobs SET next_at=0').run();
  provider.send = async () => ({ ok: true });
  await worker.tick();
  assert.equal(calls, 1);
  assert.equal(ctx.db.prepare('SELECT status FROM jobs').get().status, 'sent');
});
test('WhatsApp FSRS respects enrollment and clears stale review state', async (t) => {
  const { ctx, account, mutate, webhook, sent, admin } = await fixture(t);
  const a = await account('a');
  ctx.db.prepare('UPDATE users SET phone=? WHERE id=?').run('628123456789', a.user.id);
  await mutate(a, 'post', '/api/lessons/1/cards', {});
  const worker = makeWorker(ctx);
  await webhook('card', '/kartu');
  await worker.tick();
  assert.match(sent[0].text, /jawaban/);
  await webhook('answer', '/jawaban');
  await worker.tick();
  assert.match(sent[1].text, /halo/);
  await webhook('good', '/baik');
  await worker.tick();
  assert.equal(ctx.db.prepare('SELECT count(*) n FROM reviews').get().n, 1);
  await mutate(admin, 'delete', `/api/admin/enrollments/${a.user.id}/1`, null);
  await webhook('revoked', '/kartu');
  await worker.tick();
  assert.match(sent.at(-1).text, /belum aktif/);
});
test('teacher edits validated lessons; drafts unavailable to students; password change revokes sessions', async (t) => {
  const { account, mutate } = await fixture(t);
  const teacher = await account('laoshi', 'teacher'),
    a = await account('a');
  const lesson = {
    course_id: 1,
    position: 4,
    title: 'Draf',
    body: 'Isi',
    words: [{ hanzi: '人', pinyin: 'rén', meaning: 'orang' }],
    quiz: [{ question: 'Arti 人?', options: ['orang', 'air'], answer: 0 }],
    published: false,
  };
  const r = await mutate(teacher, 'post', '/api/staff/lessons', lesson).expect(201);
  await a.agent.get('/api/lessons/' + r.body.id).expect(403);
  await mutate(teacher, 'put', '/api/staff/lessons/' + r.body.id, {
    ...lesson,
    published: true,
  }).expect(200);
  await a.agent.get('/api/lessons/' + r.body.id).expect(200);
  await mutate(teacher, 'put', '/api/staff/lessons/' + r.body.id, {
    ...lesson,
    quiz: [{ ...lesson.quiz[0], answer: 5 }],
  }).expect(400);
  await mutate(a, 'post', '/api/password', {
    current: pwd,
    password: 'new-password-test-strong',
  }).expect(200);
  await a.agent.get('/api/me').expect(401);
});
test('browser assets are locally served and character paths reject traversal', async (t) => {
  const { ctx } = await fixture(t);
  await request(ctx.app).get('/').expect(200).expect('Content-Type', /html/);
  await request(ctx.app).get('/vendor/hanzi-writer.js').expect(200);
  const h = await request(ctx.app)
    .get('/data/hanzi/' + encodeURIComponent('你'))
    .expect(200);
  assert.ok(h.body.strokes.length > 0);
  await request(ctx.app).get('/data/hanzi/abc').expect(400);
  await request(ctx.app).get('/data/app.sqlite').expect(404);
});
