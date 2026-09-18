import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import bcrypt from 'bcryptjs';

export function openDB(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')), active INTEGER NOT NULL DEFAULT 1,
      phone TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, level TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS enrollments(user_id INTEGER REFERENCES users, course_id INTEGER REFERENCES courses, expires TEXT,
      PRIMARY KEY(user_id,course_id));
    CREATE TABLE IF NOT EXISTS lessons(id INTEGER PRIMARY KEY, course_id INTEGER REFERENCES courses, position INTEGER NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, words TEXT NOT NULL, quiz TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS progress(user_id INTEGER REFERENCES users, lesson_id INTEGER REFERENCES lessons, score REAL NOT NULL,
      completed_at TEXT NOT NULL, PRIMARY KEY(user_id,lesson_id));
    CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users, lesson_id INTEGER REFERENCES lessons,
      hanzi TEXT NOT NULL, pinyin TEXT NOT NULL, meaning TEXT NOT NULL, state TEXT NOT NULL, due TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,lesson_id,hanzi));
    CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users, card_id INTEGER REFERENCES cards,
      rating INTEGER NOT NULL, log TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS practice(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users,hanzi TEXT NOT NULL,
      mistakes INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users,role TEXT NOT NULL,
      content TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users,kind TEXT NOT NULL,
      target TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,result TEXT,feedback TEXT,reviewer_id INTEGER REFERENCES users,
      status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS link_codes(code TEXT PRIMARY KEY,user_id INTEGER UNIQUE REFERENCES users,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_context(phone TEXT PRIMARY KEY,target TEXT NOT NULL DEFAULT '',review_id INTEGER,review_version INTEGER);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,phone TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,response TEXT,last_error TEXT,
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS usage(user_id INTEGER REFERENCES users,day TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,day));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor INTEGER,action TEXT NOT NULL,subject TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    PRAGMA user_version=1;`);
  return db;
}
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function seed(db, env) {
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
    if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12)
      throw new Error('Set ADMIN_EMAIL dan ADMIN_PASSWORD minimal 12 karakter.');
    db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(
      'Administrator',
      env.ADMIN_EMAIL.toLowerCase(),
      bcrypt.hashSync(env.ADMIN_PASSWORD, 12),
      'admin',
    );
  }
  if (db.prepare('SELECT id FROM courses LIMIT 1').get()) return;
  tx(db, () => {
    db.prepare('INSERT INTO courses(id,title,description,level) VALUES(1,?,?,?)').run(
      'Mandarin dari awal',
      'Materi contoh untuk diuji dan disesuaikan laoshi. Mulai dari sapaan, angka, dan perkenalan.',
      'Pemula',
    );
    const lessons = [
      {
        title: '你好 · Menyapa dengan percaya diri',
        body: '你好 (nǐ hǎo) berarti halo. Saat dua suku kata nada ketiga berurutan, yang pertama biasanya diucapkan mendekati nada kedua: ní hǎo. Pinyin dalam materi tetap ditulis dengan nada dasar.\n\nGunakan 您好 (nín hǎo) sebagai sapaan sopan. 谢谢 (xièxie) berarti terima kasih; suku kata kedua bernada netral. 再见 (zàijiàn) berarti sampai jumpa.\n\nLatihan: ucapkan 你好, tulis 你 dan 好, lalu gunakan 谢谢 dalam percakapan singkat.',
        words: [
          ['你好', 'nǐ hǎo', 'halo'],
          ['您好', 'nín hǎo', 'halo (sopan)'],
          ['谢谢', 'xièxie', 'terima kasih'],
          ['再见', 'zàijiàn', 'sampai jumpa'],
        ],
        quiz: [
          {
            question: 'Apa arti 谢谢?',
            options: ['Halo', 'Terima kasih', 'Selamat malam'],
            answer: 1,
          },
          {
            question: 'Sapaan yang lebih sopan adalah…',
            options: ['您好', '再见', '谢谢'],
            answer: 0,
          },
        ],
      },
      {
        title: '一二三 · Angka pertama',
        body: '一 yī, 二 èr, 三 sān, 四 sì, 五 wǔ. Nada pertama tinggi dan rata; nada keempat turun. Dengarkan contoh lalu ucapkan perlahan.\n\n一 dapat berubah nada dalam konteks tertentu. Bentuk yang ditampilkan di sini adalah bentuk lepas.\n\nLatihan: tulis 一, 二, 三 dan sebutkan jumlah benda di sekitarmu.',
        words: [
          ['一', 'yī', 'satu'],
          ['二', 'èr', 'dua'],
          ['三', 'sān', 'tiga'],
          ['四', 'sì', 'empat'],
          ['五', 'wǔ', 'lima'],
        ],
        quiz: [
          {
            question: 'Angka tiga ditulis…',
            options: ['二', '五', '三'],
            answer: 2,
          },
          {
            question: '四 berarti…',
            options: ['Empat', 'Satu', 'Lima'],
            answer: 0,
          },
        ],
      },
      {
        title: '我叫… · Berkenalan',
        body: '我叫… (wǒ jiào…) berarti nama saya…. 你叫什么名字？ (Nǐ jiào shénme míngzi?) berarti siapa namamu?\n\n我是学生。 (Wǒ shì xuésheng.) berarti saya seorang siswa. 很高兴认识你。 (Hěn gāoxìng rènshi nǐ.) berarti senang berkenalan denganmu.\n\nLatihan: kirim perkenalan dua kalimat kepada tutor, lalu rekam satu kalimat untuk ditinjau laoshi.',
        words: [
          ['我', 'wǒ', 'saya'],
          ['你', 'nǐ', 'kamu'],
          ['名字', 'míngzi', 'nama'],
          ['学生', 'xuésheng', 'siswa'],
        ],
        quiz: [
          {
            question: '我叫… digunakan untuk…',
            options: ['Berpamitan', 'Menyebut nama', 'Berterima kasih'],
            answer: 1,
          },
          {
            question: '学生 berarti…',
            options: ['Guru', 'Nama', 'Siswa'],
            answer: 2,
          },
        ],
      },
    ];
    lessons.forEach((l, i) =>
      db
        .prepare(
          'INSERT INTO lessons(course_id,position,title,body,words,quiz,published) VALUES(1,?,?,?,?,?,1)',
        )
        .run(
          i + 1,
          l.title,
          l.body,
          JSON.stringify(
            l.words.map(([hanzi, pinyin, meaning]) => ({
              hanzi,
              pinyin,
              meaning,
            })),
          ),
          JSON.stringify(l.quiz),
        ),
    );
  });
}
