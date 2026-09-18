import { createHash } from 'node:crypto';
import { fsrs } from 'ts-fsrs';
import { tx } from './db.js';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const help =
  'Perintah: /latihan 你好 (target foto/suara), /kartu (review kosakata), /lagi /sulit /baik /mudah (nilai kartu), /bantuan. Kirim teks untuk tutor, foto untuk OCR, atau rekaman untuk membaca target. AI bisa keliru; hasil dapat ditinjau laoshi. Balasan hanya dalam jendela pesan masuk WhatsApp.';
export function makeWorker(ctx) {
  const { db, service, chat, submit, learning } = ctx;
  // One worker per SQLite deployment; recover work interrupted by a process restart.
  db.prepare("UPDATE jobs SET status='pending' WHERE status='processing'").run();
  async function answer(job) {
    const m = JSON.parse(job.payload),
      text = String(m.text?.body || '').trim();
    if (/^HUBUNGKAN\s+[A-F0-9]{12}$/i.test(text))
      return tx(db, () => {
        const c = db
          .prepare(
            'SELECT c.*,u.active FROM link_codes c JOIN users u ON u.id=c.user_id WHERE code=?',
          )
          .get(hash(text.split(/\s+/)[1].toUpperCase()));
        if (!c || !c.active || c.expires < Date.now())
          return 'Kode tidak berlaku. Buat kode baru di menu WhatsApp portal.';
        const other = db.prepare('SELECT id FROM users WHERE phone=?').get(job.phone);
        if (other && other.id !== c.user_id)
          return 'Nomor ini sudah terhubung ke akun lain. Putuskan tautan melalui portal akun tersebut terlebih dahulu.';
        db.prepare('UPDATE users SET phone=? WHERE id=?').run(job.phone, c.user_id);
        db.prepare('DELETE FROM link_codes WHERE user_id=?').run(c.user_id);
        return (
          'Akun berhasil terhubung! Pesan, foto, dan suara latihan dapat diproses layanan AI kursus. ' +
          help
        );
      });
    const user = db.prepare('SELECT * FROM users WHERE phone=? AND active=1').get(job.phone);
    if (!user)
      return 'Masuk ke portal kursus → WhatsApp → Buat kode. Kirim HUBUNGKAN diikuti kode tersebut ke nomor ini.';
    try {
      learning(user);
    } catch (e) {
      return e.message;
    }
    if (/^\/bantuan$/i.test(text)) return help;
    if (/^\/latihan\s+/i.test(text)) {
      const target = text
        .replace(/^\/latihan\s+/i, '')
        .trim()
        .slice(0, 200);
      if (!/\p{Script=Han}/u.test(target)) return 'Tulis target Hanzi. Contoh: /latihan 你好';
      db.prepare(
        'INSERT INTO wa_context(phone,target) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET target=excluded.target',
      ).run(job.phone, target);
      return `Target latihan: ${target}\nSekarang kirim foto tulisan atau rekaman membaca kalimat ini. Jika penilai AI belum aktif, laoshi dapat memeriksa tugas melalui portal.`;
    }
    if (/^\/kartu$/i.test(text)) {
      const card = db
        .prepare(
          `SELECT c.* FROM cards c JOIN lessons l ON l.id=c.lesson_id JOIN enrollments e ON e.user_id=c.user_id AND e.course_id=l.course_id
        WHERE c.user_id=? AND l.published=1 AND c.due<=? AND (e.expires IS NULL OR e.expires>?) ORDER BY c.due LIMIT 1`,
        )
        .get(user.id, new Date().toISOString(), new Date().toISOString());
      if (!card)
        return 'Tidak ada kartu jatuh tempo. Tambahkan kosakata dari halaman materi di portal.';
      db.prepare(
        'INSERT INTO wa_context(phone,target,review_id,review_version) VALUES(?,?,?,?) ON CONFLICT(phone) DO UPDATE SET review_id=excluded.review_id,review_version=excluded.review_version',
      ).run(job.phone, '', card.id, card.version);
      return `${card.hanzi}\nIngat pinyin dan artinya, lalu kirim /jawaban.`;
    }
    if (/^\/(jawaban|lagi|sulit|baik|mudah)$/i.test(text)) {
      return tx(db, () => {
        const context = db.prepare('SELECT * FROM wa_context WHERE phone=?').get(job.phone);
        const c =
          context?.review_id &&
          db
            .prepare(
              `SELECT c.* FROM cards c JOIN lessons l ON l.id=c.lesson_id JOIN enrollments e ON e.user_id=c.user_id AND e.course_id=l.course_id
          WHERE c.id=? AND c.user_id=? AND l.published=1 AND (e.expires IS NULL OR e.expires>?)`,
            )
            .get(context.review_id, user.id, new Date().toISOString());
        if (!c || c.version !== context.review_version)
          return 'Kirim /kartu untuk mulai review baru.';
        if (text.toLowerCase() === '/jawaban')
          return `${c.hanzi} · ${c.pinyin}\n${c.meaning}\nNilai ingatanmu: /lagi, /sulit, /baik, atau /mudah.`;
        const rating = { lagi: 1, sulit: 2, baik: 3, mudah: 4 }[text.slice(1).toLowerCase()];
        const next = fsrs({ enable_fuzz: true }).next(JSON.parse(c.state), new Date(), rating);
        db.prepare('UPDATE cards SET state=?,due=?,version=version+1 WHERE id=?').run(
          JSON.stringify(next.card),
          next.card.due.toISOString(),
          c.id,
        );
        db.prepare(
          'INSERT INTO reviews(user_id,card_id,rating,log,created_at) VALUES(?,?,?,?,?)',
        ).run(user.id, c.id, rating, JSON.stringify(next.log), new Date().toISOString());
        db.prepare('UPDATE wa_context SET review_id=NULL,review_version=NULL WHERE phone=?').run(
          job.phone,
        );
        return `Tersimpan. Review berikutnya: ${next.card.due.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB. Kirim /kartu untuk kartu selanjutnya.`;
      });
    }
    if (m.type === 'image' || m.type === 'audio') {
      const target = db
        .prepare('SELECT target FROM wa_context WHERE phone=?')
        .get(job.phone)?.target;
      if (!target)
        return 'Tentukan kalimat yang dilatih dahulu, misalnya /latihan 你好. Setelah itu kirim ulang foto atau rekamannya.';
      const file = await service.media(m[m.type].id);
      const r = await submit(user, file, m.type, target);
      const result = r.result || {};
      return `Tugas #${r.id} tersimpan.\n${result.feedback || result.summary || result.note || 'Hasil penilai tersedia di portal; laoshi dapat meninjau.'}${result.recognized ? '\nTeks terbaca: ' + result.recognized : ''}`;
    }
    if (m.type === 'text') return chat(user, text.slice(0, 2000));
    return 'Kirim teks, foto JPG/PNG, atau pesan suara. ' + help;
  }
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      db.prepare(
        "UPDATE jobs SET status='expired',last_error='Jendela balasan lewat' WHERE status IN ('pending','processing') AND created_at<?",
      ).run(Date.now() - 23 * 3600000);
      const job = tx(db, () => {
        const j = db
          .prepare(
            "SELECT * FROM jobs WHERE status='pending' AND next_at<=? ORDER BY created_at LIMIT 1",
          )
          .get(Date.now());
        if (j)
          db.prepare("UPDATE jobs SET status='processing',attempts=attempts+1 WHERE id=?").run(
            j.id,
          );
        return j;
      });
      if (!job) return;
      try {
        let response = job.response;
        if (!response) {
          try {
            response = await answer(job);
          } catch (e) {
            if (e.status && e.status < 500) response = e.message;
            else if (e.status === 503) response = e.message;
            else throw e;
          }
          db.prepare('UPDATE jobs SET response=? WHERE id=?').run(response, job.id);
        }
        await service.send(job.phone, response);
        db.prepare("UPDATE jobs SET status='sent',last_error=NULL WHERE id=?").run(job.id);
      } catch (e) {
        const attempts = job.attempts + 1;
        db.prepare('UPDATE jobs SET status=?,next_at=?,last_error=? WHERE id=?').run(
          attempts >= 5 ? 'failed' : 'pending',
          Date.now() + Math.min(600000, 15000 * 2 ** attempts),
          'Layanan tidak merespons; periksa koneksi/kredensial.',
          job.id,
        );
      }
    } finally {
      busy = false;
    }
  }
  return {
    tick,
    answer,
    start() {
      const interval = setInterval(() => tick().catch(() => console.error('worker_failed')), 2000);
      interval.unref();
      return () => clearInterval(interval);
    },
  };
}
