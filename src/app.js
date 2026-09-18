import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { z } from 'zod';
import { randomBytes, createHash, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyCard, fsrs } from 'ts-fsrs';
import { pinyin } from 'pinyin-pro';
import { openDB, seed, tx } from './db.js';
import { providers } from './providers.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');
const now = () => new Date().toISOString();
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone,
  active: u.active,
});
const email = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const password = z
  .string()
  .min(12)
  .max(72)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72);
const word = z.object({
  hanzi: z.string().min(1).max(32),
  pinyin: z.string().min(1).max(100),
  meaning: z.string().min(1).max(200),
});
const question = z
  .object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(300)).min(2).max(6),
    answer: z.number().int().min(0).max(5),
  })
  .refine((q) => q.answer < q.options.length);
const lessonSchema = z.object({
  course_id: z.number().int().positive(),
  position: z.number().int().min(0),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(30000),
  words: z.array(word).min(1).max(100),
  quiz: z.array(question).min(1).max(30),
  published: z.boolean(),
});
export function createApp(env = process.env, overrides = {}) {
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.PUBLIC_URL || 'http://localhost:3000').origin;
  if (production && !origin.startsWith('https://'))
    throw new Error('PUBLIC_URL wajib HTTPS pada produksi.');
  const db = overrides.db || openDB(env.DB_PATH || path.join(root, 'data/app.sqlite'));
  seed(db, env);
  const service = overrides.providers || providers(env);
  const uploads = path.resolve(env.UPLOAD_DIR || path.join(root, 'data/uploads'));
  mkdirSync(uploads, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
    }),
  );
  app.get('/health', (_, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.get('/webhooks/whatsapp', (req, res) => {
    if (!env.WA_VERIFY_TOKEN) return res.sendStatus(503);
    if (
      req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === env.WA_VERIFY_TOKEN
    )
      return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(403);
  });
  app.post(
    '/webhooks/whatsapp',
    express.raw({ type: 'application/json', limit: '1mb' }),
    (req, res) => {
      if (!env.WA_APP_SECRET) return res.sendStatus(503);
      if (!Buffer.isBuffer(req.body)) return res.sendStatus(400);
      const sig = req.get('x-hub-signature-256') || '';
      const expected =
        'sha256=' + createHmac('sha256', env.WA_APP_SECRET).update(req.body).digest('hex');
      if (
        sig.length !== expected.length ||
        !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      )
        return res.sendStatus(401);
      let body;
      try {
        body = JSON.parse(req.body);
      } catch {
        return res.sendStatus(400);
      }
      if (body.object !== 'whatsapp_business_account') return res.sendStatus(400);
      tx(db, () => {
        for (const entry of body.entry || [])
          for (const change of entry.changes || []) {
            const v = change.value;
            if (v?.metadata?.phone_number_id !== env.WA_PHONE_ID) continue;
            for (const m of v.messages || []) {
              if (!m.id || !/^\d{6,20}$/.test(m.from) || !m.timestamp) continue;
              const created = Number(m.timestamp) * 1000;
              if (
                !Number.isFinite(created) ||
                Date.now() - created > 23 * 3600000 ||
                created > Date.now() + 300000
              )
                continue;
              db.prepare(
                'INSERT OR IGNORE INTO jobs(id,phone,payload,created_at) VALUES(?,?,?,?)',
              ).run(String(m.id), m.from, JSON.stringify(m), created);
            }
          }
      });
      res.sendStatus(200);
    },
  );
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser());
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const sid = req.cookies.sid;
    if (sid) {
      const row = db
        .prepare(
          'SELECT s.csrf,s.expires,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND u.active=1',
        )
        .get(hash(sid));
      if (row && row.expires > Date.now()) {
        req.user = row;
        req.csrf = row.csrf;
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') !== origin)
        return res.status(403).json({
          error: 'Origin tidak cocok. Buka aplikasi dari alamat PUBLIC_URL.',
        });
      if (req.user && req.get('x-csrf-token') !== req.csrf)
        return res.status(403).json({ error: 'Sesi keamanan berubah. Muat ulang halaman.' });
    }
    next();
  });
  const auth = (req, res, next) =>
    req.user ? next() : res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  const staff = (req, res, next) =>
    ['admin', 'teacher'].includes(req.user?.role)
      ? next()
      : res.status(403).json({ error: 'Khusus laoshi/admin.' });
  const admin = (req, res, next) =>
    req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Khusus admin.' });
  function accessible(user, courseId) {
    return (
      user.role !== 'student' ||
      !!db
        .prepare(
          'SELECT 1 FROM enrollments WHERE user_id=? AND course_id=? AND (expires IS NULL OR expires>?)',
        )
        .get(user.id, courseId, now())
    );
  }
  function learning(user) {
    if (
      user.role === 'student' &&
      !db
        .prepare('SELECT 1 FROM enrollments WHERE user_id=? AND (expires IS NULL OR expires>?)')
        .get(user.id, now())
    )
      fail(403, 'Akses kelas belum aktif. Hubungi admin kursus.');
  }
  function lessonFor(user, id) {
    const l = db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
    if (!l) fail(404, 'Materi tidak ditemukan.');
    if (!accessible(user, l.course_id) || (user.role === 'student' && !l.published))
      fail(403, 'Materi belum dapat diakses.');
    return l;
  }
  function audit(user, action, subject) {
    db.prepare('INSERT INTO audit(actor,action,subject) VALUES(?,?,?)').run(
      user.id,
      action,
      String(subject),
    );
  }
  function charge(user) {
    learning(user);
    const day = now().slice(0, 10);
    tx(db, () => {
      const used =
        db.prepare('SELECT count FROM usage WHERE user_id=? AND day=?').get(user.id, day)?.count ||
        0;
      if (used >= Number(env.AI_DAILY_LIMIT || 40))
        fail(
          429,
          'Batas latihan AI harian tercapai. Silakan lanjut besok atau minta review laoshi.',
        );
      db.prepare(
        'INSERT INTO usage(user_id,day,count) VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1',
      ).run(user.id, day);
    });
  }
  const cookie = {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 86400000,
  };
  app.post(
    '/api/login',
    rateLimit({
      windowMs: 900000,
      limit: 15,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res) => {
      const b = z.object({ email, password: z.string().min(1).max(72) }).parse(req.body);
      const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(b.email);
      // A dummy hash makes unknown-account requests take approximately the same time.
      const match = await bcrypt.compare(
        b.password,
        u?.password || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.ixPoYWFB8BYOjklLf.ZJAI9wNY.OALy',
      );
      if (!u || !match) fail(401, 'Email atau kata sandi salah.');
      const sid = token(),
        csrf = token();
      if (req.cookies.sid)
        db.prepare('DELETE FROM sessions WHERE token=?').run(hash(req.cookies.sid));
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
        hash(sid),
        u.id,
        csrf,
        Date.now() + 7 * 86400000,
      );
      res.cookie('sid', sid, cookie).json({ user: safeUser(u), csrf });
    },
  );
  app.get('/api/me', auth, (req, res) =>
    res.json({
      user: safeUser(req.user),
      csrf: req.csrf,
      capabilities: service.capabilities(),
    }),
  );
  app.post('/api/logout', auth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token=?').run(hash(req.cookies.sid));
    res.clearCookie('sid', { path: '/' }).json({ ok: true });
  });
  app.post('/api/password', auth, async (req, res) => {
    const b = z.object({ current: z.string(), password }).parse(req.body);
    if (!(await bcrypt.compare(b.current, req.user.password))) fail(400, 'Kata sandi lama salah.');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(
      await bcrypt.hash(b.password, 12),
      req.user.id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    res.clearCookie('sid', { path: '/' }).json({ ok: true });
  });
  app.get('/api/dashboard', auth, (req, res) => {
    const courses = db
      .prepare('SELECT * FROM courses')
      .all()
      .map((c) => ({ ...c, enrolled: accessible(req.user, c.id) }));
    const lessons = db
      .prepare('SELECT id,course_id,position,title,published FROM lessons ORDER BY position,id')
      .all()
      .filter(
        (l) => accessible(req.user, l.course_id) && (req.user.role !== 'student' || l.published),
      );
    const progress = db
      .prepare('SELECT lesson_id,score,completed_at FROM progress WHERE user_id=?')
      .all(req.user.id);
    const due = db
      .prepare(
        'SELECT c.id,c.due,l.course_id,l.published FROM cards c JOIN lessons l ON l.id=c.lesson_id WHERE c.user_id=? AND c.due<=?',
      )
      .all(req.user.id, now())
      .filter((c) => accessible(req.user, c.course_id) && c.published).length;
    const practice = db
      .prepare('SELECT count(*) n FROM practice WHERE user_id=?')
      .get(req.user.id).n;
    res.json({ courses, lessons, progress, due, practice });
  });
  app.get('/api/lessons/:id', auth, (req, res) => {
    const l = lessonFor(req.user, Number(req.params.id));
    const quiz = JSON.parse(l.quiz).map(({ answer, ...q }) => q);
    res.json({ ...l, words: JSON.parse(l.words), quiz });
  });
  app.post('/api/lessons/:id/quiz', auth, (req, res) => {
    const l = lessonFor(req.user, Number(req.params.id)),
      quiz = JSON.parse(l.quiz);
    const b = z
      .object({
        answers: z.array(z.number().int().min(0).max(5)).length(quiz.length),
      })
      .parse(req.body);
    const corrections = quiz.map((q, i) => ({
      correct: b.answers[i] === q.answer,
      answer: q.answer,
    }));
    const score = Math.round((100 * corrections.filter((x) => x.correct).length) / quiz.length);
    db.prepare(
      'INSERT INTO progress VALUES(?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET score=max(score,excluded.score),completed_at=excluded.completed_at',
    ).run(req.user.id, l.id, score, now());
    res.json({ score, corrections, passed: score >= 70 });
  });
  app.post('/api/lessons/:id/cards', auth, (req, res) => {
    const l = lessonFor(req.user, Number(req.params.id));
    tx(db, () => {
      for (const w of JSON.parse(l.words)) {
        const c = createEmptyCard(new Date());
        db.prepare(
          'INSERT OR IGNORE INTO cards(user_id,lesson_id,hanzi,pinyin,meaning,state,due) VALUES(?,?,?,?,?,?,?)',
        ).run(
          req.user.id,
          l.id,
          w.hanzi,
          w.pinyin,
          w.meaning,
          JSON.stringify(c),
          c.due.toISOString(),
        );
      }
    });
    res.json({ ok: true });
  });
  app.get('/api/reviews', auth, (req, res) => {
    learning(req.user);
    res.json(
      db
        .prepare(
          'SELECT c.*,l.course_id,l.published FROM cards c JOIN lessons l ON l.id=c.lesson_id WHERE user_id=? AND due<=? ORDER BY due LIMIT 100',
        )
        .all(req.user.id, now())
        .filter((c) => accessible(req.user, c.course_id) && c.published)
        .map(({ state, ...c }) => c),
    );
  });
  app.post('/api/reviews/:id', auth, (req, res) => {
    const b = z
      .object({
        rating: z.number().int().min(1).max(4),
        version: z.number().int().min(0),
      })
      .parse(req.body);
    const result = tx(db, () => {
      const c = db
        .prepare('SELECT * FROM cards WHERE id=? AND user_id=?')
        .get(Number(req.params.id), req.user.id);
      if (!c) fail(404, 'Kartu tidak ditemukan.');
      lessonFor(req.user, c.lesson_id);
      if (c.version !== b.version || c.due > now())
        fail(409, 'Kartu sudah dinilai atau belum waktunya review.');
      const next = fsrs({ enable_fuzz: true }).next(JSON.parse(c.state), new Date(), b.rating);
      db.prepare('UPDATE cards SET state=?,due=?,version=version+1 WHERE id=?').run(
        JSON.stringify(next.card),
        next.card.due.toISOString(),
        c.id,
      );
      db.prepare(
        'INSERT INTO reviews(user_id,card_id,rating,log,created_at) VALUES(?,?,?,?,?)',
      ).run(req.user.id, c.id, b.rating, JSON.stringify(next.log), now());
      return { due: next.card.due, version: c.version + 1 };
    });
    res.json(result);
  });
  app.get('/api/pinyin', auth, (req, res) => {
    const text = z.string().min(1).max(80).parse(req.query.text);
    res.json({ pinyin: pinyin(text) });
  });
  app.post('/api/practice', auth, (req, res) => {
    learning(req.user);
    const b = z
      .object({
        hanzi: z.string().regex(/^\p{Script=Han}$/u),
        mistakes: z.number().int().min(0).max(1000),
      })
      .parse(req.body);
    db.prepare('INSERT INTO practice(user_id,hanzi,mistakes) VALUES(?,?,?)').run(
      req.user.id,
      b.hanzi,
      b.mistakes,
    );
    res.json({ ok: true });
  });
  async function chat(user, text) {
    charge(user);
    const history = db
      .prepare(
        'SELECT role,content FROM (SELECT id,role,content FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 15) ORDER BY id',
      )
      .all(user.id);
    const answer = await service.chat([...history, { role: 'user', content: text }]);
    tx(db, () => {
      db.prepare('INSERT INTO messages(user_id,role,content) VALUES(?,?,?)').run(
        user.id,
        'user',
        text,
      );
      db.prepare('INSERT INTO messages(user_id,role,content) VALUES(?,?,?)').run(
        user.id,
        'assistant',
        answer,
      );
    });
    return answer;
  }
  app.get('/api/chat', auth, (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT role,content,created_at FROM (SELECT * FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 50) ORDER BY id',
        )
        .all(req.user.id),
    ),
  );
  app.post('/api/chat', auth, async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
    res.json({ answer: await chat(req.user, text) });
  });
  app.delete('/api/chat', auth, (req, res) => {
    db.prepare('DELETE FROM messages WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  });
  function validateFile(file, kind) {
    if (!file?.buffer?.length || file.buffer.length > 8 * 1024 * 1024)
      fail(400, 'File kosong atau lebih dari 8 MB.');
    const b = file.buffer;
    const image =
      b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
        ? 'image/jpeg'
        : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? 'image/png'
          : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
            ? 'image/webp'
            : null;
    const audio =
      b.subarray(0, 4).toString() === 'OggS'
        ? 'audio/ogg'
        : b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE'
          ? 'audio/wav'
          : b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
            ? 'audio/webm'
            : b.subarray(4, 8).toString() === 'ftyp'
              ? 'audio/mp4'
              : b.subarray(0, 3).toString() === 'ID3' || (b[0] === 255 && (b[1] & 224) === 224)
                ? 'audio/mpeg'
                : null;
    const mime = kind === 'image' ? image : audio;
    if (!mime) fail(400, 'Format tidak didukung. Foto: JPG/PNG/WebP; suara: WAV/MP3/M4A/OGG/WebM.');
    return mime;
  }
  async function submit(user, file, kind, target) {
    learning(user);
    const mime = validateFile(file, kind);
    const count = db
      .prepare(
        "SELECT count(*) n FROM submissions WHERE user_id=? AND created_at>=datetime('now','-1 day')",
      )
      .get(user.id).n;
    if (count >= 30) fail(429, 'Maksimal 30 tugas per hari.');
    const filename = randomUUID();
    writeFileSync(path.join(uploads, filename), file.buffer, { mode: 0o600 });
    const id = Number(
      db
        .prepare(
          'INSERT INTO submissions(user_id,kind,target,filename,mime,status) VALUES(?,?,?,?,?,?)',
        )
        .run(user.id, kind, target, filename, mime, 'pending').lastInsertRowid,
    );
    let result,
      status = 'pending';
    try {
      charge(user);
      if (kind === 'image') {
        const ocr = await service.ocr(file.buffer, mime);
        const recognized = String(ocr.text || '').slice(0, 8000);
        const clean = (s) => s.replace(/[^\p{Script=Han}\p{Number}]/gu, '');
        result = {
          recognized,
          confidence: ocr.confidence ?? null,
          matchesTarget: clean(recognized) !== '' && clean(recognized) === clean(target),
          note: 'OCR membandingkan teks yang terbaca. Bentuk dan urutan goresan perlu review laoshi atau latihan Hanzi.',
        };
        if (service.capabilities().chat && recognized)
          result.feedback = await service.chat([
            {
              role: 'user',
              content: `Target latihan: ${target}\nHasil OCR (bisa salah): ${recognized}\nBantu koreksi karakter/kata dan artinya. Jangan menilai bentuk goresan atau membuat skor tulisan.`,
            },
          ]);
      } else result = await service.speech(file.buffer, mime, target, user.id);
      status = 'ai_reviewed';
    } catch (e) {
      result = {
        ...(result || {}),
        note: e.status
          ? e.message
          : 'Layanan AI sedang tidak tersedia. Tugas tersimpan untuk laoshi.',
      };
    }
    db.prepare('UPDATE submissions SET result=?,status=? WHERE id=?').run(
      JSON.stringify(result),
      status,
      id,
    );
    return { id, status, result };
  }
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 3 },
  });
  app.post('/api/submissions', auth, upload.single('file'), async (req, res) => {
    const b = z
      .object({
        kind: z.enum(['image', 'audio']),
        target: z.string().trim().min(1).max(200),
        consent: z.literal('yes'),
      })
      .parse(req.body);
    res.status(201).json(await submit(req.user, req.file, b.kind, b.target));
  });
  app.get('/api/submissions', auth, (req, res) => {
    const rows =
      req.user.role === 'student'
        ? db
            .prepare(
              'SELECT s.*,u.name FROM submissions s JOIN users u ON u.id=s.user_id WHERE user_id=? ORDER BY s.id DESC LIMIT 100',
            )
            .all(req.user.id)
        : db
            .prepare(
              'SELECT s.*,u.name FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100',
            )
            .all();
    res.json(
      rows.map(({ filename, ...s }) => ({
        ...s,
        result: JSON.parse(s.result || 'null'),
      })),
    );
  });
  app.get('/api/submissions/:id/file', auth, (req, res) => {
    const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(req.params.id));
    if (!s || (req.user.role === 'student' && s.user_id !== req.user.id))
      fail(404, 'File tidak ditemukan.');
    res.set('Content-Type', s.mime);
    res.set('Content-Disposition', 'inline');
    res.sendFile(path.join(uploads, s.filename));
  });
  app.delete('/api/submissions/:id', auth, (req, res) => {
    const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(req.params.id));
    if (!s || (req.user.role === 'student' && s.user_id !== req.user.id))
      fail(404, 'Tugas tidak ditemukan.');
    if (existsSync(path.join(uploads, s.filename))) unlinkSync(path.join(uploads, s.filename));
    db.prepare('DELETE FROM submissions WHERE id=?').run(s.id);
    res.json({ ok: true });
  });
  app.post('/api/submissions/:id/feedback', auth, staff, (req, res) => {
    const { feedback } = z.object({ feedback: z.string().min(1).max(5000) }).parse(req.body);
    const r = db
      .prepare("UPDATE submissions SET feedback=?,reviewer_id=?,status='reviewed' WHERE id=?")
      .run(feedback, req.user.id, Number(req.params.id));
    if (!r.changes) fail(404, 'Tugas tidak ditemukan.');
    audit(req.user, 'feedback', req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/whatsapp/link', auth, (req, res) => {
    z.object({ consent: z.literal(true) }).parse(req.body);
    learning(req.user);
    const code = randomBytes(6).toString('hex').toUpperCase();
    db.prepare(
      'INSERT INTO link_codes VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code,expires=excluded.expires',
    ).run(hash(code), req.user.id, Date.now() + 10 * 60000);
    res.json({ code, expiresIn: 600, phone: env.WA_PUBLIC_NUMBER || null });
  });
  app.delete('/api/whatsapp/link', auth, (req, res) => {
    db.prepare('UPDATE users SET phone=NULL WHERE id=?').run(req.user.id);
    db.prepare('DELETE FROM link_codes WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  });
  app.get('/api/staff', auth, staff, (req, res) => {
    const users = db.prepare('SELECT id,name,email,role,active,phone FROM users ORDER BY id').all();
    const progress = db
      .prepare('SELECT p.*,l.title FROM progress p JOIN lessons l ON l.id=p.lesson_id')
      .all();
    const enrollments = db.prepare('SELECT * FROM enrollments').all();
    const lessons = db
      .prepare('SELECT * FROM lessons ORDER BY course_id,position')
      .all()
      .map((l) => ({
        ...l,
        words: JSON.parse(l.words),
        quiz: JSON.parse(l.quiz),
      }));
    res.json({
      users,
      progress,
      enrollments,
      lessons,
      courses: db.prepare('SELECT * FROM courses').all(),
      jobs: db
        .prepare(
          'SELECT id,status,attempts,last_error,created_at FROM jobs ORDER BY created_at DESC LIMIT 30',
        )
        .all(),
      capabilities: service.capabilities(),
    });
  });
  app.post('/api/admin/users', auth, admin, async (req, res) => {
    const b = z
      .object({
        name: z.string().min(1).max(100),
        email,
        password,
        role: z.enum(['student', 'teacher']),
      })
      .parse(req.body);
    if (db.prepare('SELECT id FROM users WHERE email=?').get(b.email))
      fail(409, 'Email sudah terdaftar.');
    const r = db
      .prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)')
      .run(b.name, b.email, await bcrypt.hash(b.password, 12), b.role);
    audit(req.user, 'create_user', r.lastInsertRowid);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/admin/users/:id', auth, admin, async (req, res) => {
    const b = z
      .object({ active: z.boolean().optional(), password: password.optional() })
      .parse(req.body);
    const id = Number(req.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) fail(404, 'Akun tidak ditemukan.');
    if (id === req.user.id && b.active === false)
      fail(400, 'Tidak dapat menonaktifkan akun sendiri.');
    if (b.password)
      db.prepare('UPDATE users SET password=? WHERE id=?').run(
        await bcrypt.hash(b.password, 12),
        id,
      );
    if (b.active !== undefined)
      db.prepare('UPDATE users SET active=? WHERE id=?').run(Number(b.active), id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(req.user, 'update_user', id);
    res.json({ ok: true });
  });
  app.post('/api/admin/enrollments', auth, admin, (req, res) => {
    const b = z
      .object({
        user_id: z.number().int().positive(),
        course_id: z.number().int().positive(),
        expires: z.iso.datetime().nullable(),
      })
      .parse(req.body);
    db.prepare(
      'INSERT INTO enrollments VALUES(?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET expires=excluded.expires',
    ).run(b.user_id, b.course_id, b.expires);
    audit(req.user, 'enroll', `${b.user_id}:${b.course_id}`);
    res.json({ ok: true });
  });
  app.delete('/api/admin/enrollments/:user/:course', auth, admin, (req, res) => {
    db.prepare('DELETE FROM enrollments WHERE user_id=? AND course_id=?').run(
      Number(req.params.user),
      Number(req.params.course),
    );
    audit(req.user, 'unenroll', `${req.params.user}:${req.params.course}`);
    res.json({ ok: true });
  });
  app.post('/api/staff/courses', auth, staff, (req, res) => {
    const b = z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000),
        level: z.string().min(1).max(100),
      })
      .parse(req.body);
    const r = db
      .prepare('INSERT INTO courses(title,description,level) VALUES(?,?,?)')
      .run(b.title, b.description, b.level);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  app.post('/api/staff/lessons', auth, staff, (req, res) => {
    const b = lessonSchema.parse(req.body);
    const r = db
      .prepare(
        'INSERT INTO lessons(course_id,position,title,body,words,quiz,published) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        b.course_id,
        b.position,
        b.title,
        b.body,
        JSON.stringify(b.words),
        JSON.stringify(b.quiz),
        Number(b.published),
      );
    audit(req.user, 'create_lesson', r.lastInsertRowid);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  app.put('/api/staff/lessons/:id', auth, staff, (req, res) => {
    const b = lessonSchema.parse(req.body);
    const r = db
      .prepare(
        'UPDATE lessons SET course_id=?,position=?,title=?,body=?,words=?,quiz=?,published=? WHERE id=?',
      )
      .run(
        b.course_id,
        b.position,
        b.title,
        b.body,
        JSON.stringify(b.words),
        JSON.stringify(b.quiz),
        Number(b.published),
        Number(req.params.id),
      );
    if (!r.changes) fail(404, 'Materi tidak ditemukan.');
    audit(req.user, 'update_lesson', req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/admin/jobs/:id/retry', auth, admin, (req, res) => {
    const r = db
      .prepare(
        "UPDATE jobs SET status='pending',attempts=0,next_at=0 WHERE id=? AND status='failed' AND created_at>?",
      )
      .run(req.params.id, Date.now() - 23 * 3600000);
    if (!r.changes) fail(409, 'Pesan tidak bisa diulang atau jendela balasan telah lewat.');
    res.json({ ok: true });
  });
  app.get('/vendor/hanzi-writer.js', (_, res) =>
    res.sendFile(path.join(root, 'node_modules/hanzi-writer/dist/hanzi-writer.min.js')),
  );
  app.get('/data/hanzi/:char', (req, res) => {
    const char = req.params.char;
    if (!/^\p{Script=Han}$/u.test(char)) return res.sendStatus(400);
    res.set('Cache-Control', 'public,max-age=604800');
    res.sendFile(path.join(root, 'node_modules/hanzi-writer-data', `${char}.json`));
  });
  app.use(
    express.static(path.join(root, 'public'), {
      index: 'index.html',
      maxAge: 0,
    }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err instanceof z.ZodError ? 400 : err instanceof multer.MulterError ? 413 : err.status || 500;
    if (status === 500) console.error('request_failed', req.path, err.code || err.name);
    res.status(status).json({
      error:
        err instanceof z.ZodError
          ? 'Isian tidak valid. Periksa semua kolom.'
          : err instanceof multer.MulterError
            ? 'Ukuran file maksimal 8 MB.'
            : status === 500
              ? 'Terjadi kesalahan. Hubungi admin.'
              : err.message,
    });
  });
  return { app, db, env, service, chat, submit, learning };
}
