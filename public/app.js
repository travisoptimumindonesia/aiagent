const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const icons = {
  home: 'M3 10 12 3 21 10v10H3z M9 20v-7h6v7',
  book: 'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 6v15',
  pen: 'm4 16 12-12 4 4L8 20H4z M14 6l4 4',
  cards: 'M6 3h15v15 M3 6h15v15H3z',
  chat: 'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5',
  mic: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0z M6 10v2a6 6 0 0 0 12 0v-2 M12 18v4 M8 22h8',
  phone: 'M6 3h12v18H6z M10 18h4',
  crown: 'M3 7l4 4 5-7 5 7 4-4-2 12H5z M6 22h12',
  users:
    'M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 21v-3a7 7 0 0 1 14 0v3 M17 4a3 3 0 0 1 0 6 M18 13a5 5 0 0 1 4 5v3',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[n]}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
let user,
  csrf,
  capabilities = {},
  game = {},
  current = 'home',
  writer,
  reviewCards = [],
  reviewIndex = 0,
  staffData,
  recorder,
  recordTimer,
  recordedBlob,
  stream,
  routeVersion = 0;
let publicConfig = { registrationOpen: true };
const nav = [
  ['home', 'Beranda', 'home'],
  ['lessons', 'Materi kelas', 'book'],
  ['practice', 'Menulis Hanzi', 'pen'],
  ['review', 'Review kosakata', 'cards'],
  ['tutor', 'Tutor Mandarin', 'chat'],
  ['tasks', 'Foto & pelafalan', 'mic'],
  ['whatsapp', 'WhatsApp', 'phone'],
  ['premium', 'Premium', 'crown'],
  ['account', 'Akun saya', 'settings'],
];
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t.timer);
  t.timer = setTimeout(() => t.classList.remove('show'), 5000);
}
async function api(url, body, method) {
  const opts = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (csrf) opts.headers['X-CSRF-Token'] = csrf;
  const r = await fetch('/api' + url, opts);
  const d = await r.json().catch(() => ({ error: 'Layanan tidak merespons.' }));
  if (!r.ok) {
    if (r.status === 401 && url !== '/login') {
      user = null;
      login();
    }
    throw new Error(d.error || 'Permintaan gagal.');
  }
  return d;
}
const date = (s) =>
  new Date(s).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const brand = `<div class="brand"><img class="brand-logo" src="/assets/mandarin-pare-logo.png" alt="Logo Beijing Institute Pare"><span>LaoshiKu<small>MANDARIN UNTUK SEMUA</small></span></div>`;
const head = (title, subtitle, tag = '一起学习 · Belajar bersama') =>
  `<div class="page-head"><div><div class="eyebrow">Ruang belajar Mandarin</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><span class="pill">${esc(tag)}</span></div>`;
function login() {
  csrf = null;
  const register = publicConfig.registrationOpen
    ? `<button class="auth-tab" type="button" data-action="show-register">Daftar gratis</button>`
    : '';
  $('#app').innerHTML =
    `<main class="login"><section class="login-art">${brand}<div class="login-promise"><span class="seal">师</span><div><p class="eyebrow">老师库 · LAOSHI BERARTI GURU</p><h1>Mandarin membuka lebih banyak jalan.</h1><p>Dari goresan pertama, nada bicara, sampai kesiapan HSK dan dunia kerja—belajar dengan jalur yang jelas dan pendampingan manusia.</p></div></div><div class="trust-line"><span>✓ Belajar lewat HP</span><span>✓ Latihan suara & Hanzi</span><span>✓ Didampingi laoshi</span></div></section><section class="login-form"><div class="login-card"><img class="institution-logo" src="/assets/mandarin-pare-logo.png" alt="Beijing Institute Pare"><div class="auth-tabs"><button class="auth-tab active" type="button" data-action="show-login">Masuk</button>${register}</div><div id="login-panel"><div class="eyebrow">欢迎回来 · Selamat datang</div><h2>Masuk ke ruang belajarmu</h2><p>Lanjutkan progres Mandarin yang sudah kamu bangun.</p><form id="login-form"><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required placeholder="nama@email.com"></div><div class="field"><label for="password">Kata sandi</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><p class="error" id="login-error" role="alert"></p><button class="btn full">Masuk ke LaoshiKu →</button></form></div>${publicConfig.registrationOpen ? `<div id="register-panel" hidden><div class="eyebrow">从这里开始 · Mulai dari sini</div><h2>Buat akun gratis</h2><p>Terbuka untuk siapa pun yang ingin mulai belajar Mandarin.</p><form id="register-form"><div class="field"><label for="register-name">Nama lengkap</label><input id="register-name" name="name" autocomplete="name" minlength="2" maxlength="100" required></div><div class="field"><label for="register-email">Email</label><input id="register-email" name="email" type="email" autocomplete="email" required placeholder="nama@email.com"></div><div class="field"><label for="register-password">Kata sandi</label><input id="register-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required><small>Minimal 12 karakter.</small></div><label class="check consent"><input name="consent" type="checkbox" required><span>Saya setuju data akun dan progres belajar diproses untuk menyediakan layanan LaoshiKu.</span></label><p class="error" id="register-error" role="alert"></p><button class="btn full">Mulai belajar gratis →</button></form></div>` : ''}<div class="auth-foot"><strong>LaoshiKu</strong> by Beijing Institute Pare<br><span>Platform belajar mandiri dan pendamping kelas.</span></div></div></section></main>`;
}
function shell() {
  const links = [...nav];
  if (user.role !== 'student') links.push(['staff', 'Ruang laoshi', 'users']);
  $('#app').innerHTML =
    `<div class="shell"><aside class="sidebar">${brand}<nav class="nav" aria-label="Menu utama">${links.map(([id, label, i]) => `<a href="#${id}" data-nav="${id}">${icon(i)}${label}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="user"><div class="avatar">${esc(user.name.slice(0, 1).toUpperCase())}</div><div><strong>${esc(user.name)}</strong><span class="small muted">${user.role === 'student' ? 'Siswa' : user.role === 'teacher' ? 'Laoshi' : 'Administrator'}</span></div></div><button class="link" data-action="logout">Keluar dari akun ↗</button></div></aside><main><header class="topbar"><span>我的课堂 <span class="muted">/ Ruang kelasku</span></span><div class="game-strip"><a href="#premium" class="game-chip fire" title="Rangkaian belajar"><span>火</span><strong id="chrome-streak">${game.streak || 0}</strong></a><a href="#home" class="game-chip xp" title="Poin belajar"><span>分</span><strong id="chrome-xp">${game.xp || 0}</strong></a><a href="#premium" class="game-chip hearts" title="Energi belajar"><span>气</span><strong id="chrome-hearts">${game.hearts === null ? '∞' : (game.hearts ?? 5)}</strong></a><span class="date">${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div></header><div id="content" class="content"></div></main></div>`;
}
function syncGame(next) {
  if (!next) return;
  game = next;
  if ($('#chrome-streak')) $('#chrome-streak').textContent = game.streak || 0;
  if ($('#chrome-xp')) $('#chrome-xp').textContent = game.xp || 0;
  if ($('#chrome-hearts'))
    $('#chrome-hearts').textContent = game.hearts === null ? '∞' : game.hearts;
}
function stopRecording() {
  clearTimeout(recordTimer);
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null;
    recorder.stop();
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  recordedBlob = null;
}
async function route() {
  if (!user) return;
  const version = ++routeVersion;
  stopRecording();
  const parts = location.hash.slice(1).split('/');
  current = parts[0] || 'home';
  $$('[data-nav]').forEach((x) => x.classList.toggle('active', x.dataset.nav === current));
  $('#content').innerHTML = '<div class="loading">Memuat…</div>';
  try {
    const html = await (
      {
        home: home,
        lessons: () => lessons(parts[1]),
        practice,
        review,
        tutor,
        tasks,
        whatsapp,
        premium,
        staff,
        account,
      }[current] || home
    )();
    if (version !== routeVersion || !user) return;
    $('#content').innerHTML = html;
    if (current === 'practice') loadWriter(parts[1] || '你');
    if (current === 'review') renderCard();
    if (current === 'tutor') $('#chat-log').scrollTop = 1e6;
  } catch (e) {
    if (version === routeVersion && $('#content'))
      $('#content').innerHTML =
        `<div class="panel empty">${esc(e.message)}<br><a href="#home" class="btn secondary mt">Kembali ke beranda</a></div>`;
  }
}
async function home() {
  const d = await api('/dashboard'),
    passed = d.progress.filter((p) => p.score >= 70).length;
  syncGame(d.gamification);
  const next =
    d.lessons.find((l) => !d.progress.some((p) => p.lesson_id === l.id && p.score >= 70)) ||
    d.lessons[0];
  const goal = Math.min(100, Math.round((game.todayXp / game.dailyGoalXp) * 100));
  const unlockedBadges = game.achievements.filter((a) => a.unlocked).length;
  return (
    head(
      `你好, ${user.name.split(' ')[0]}!`,
      game.goalComplete
        ? 'Target harian selesai. Hebat—pertahankan ritmenya!'
        : `${Math.max(0, game.dailyGoalXp - game.todayXp)} XP lagi untuk menuntaskan target hari ini.`,
      game.plan === 'premium' ? 'PREMIUM · 全力学习' : 'FREE · 每天进步',
    ) +
    `<section class="hero game-hero"><div class="hero-copy"><div class="eyebrow">TINGKAT ${game.level} · ${game.xp} POIN BELAJAR</div><h2>${next ? 'Satu sesi hari ini, satu langkah lebih dekat.' : 'Perjalanan Mandarin dimulai dari sini.'}</h2><p>${next ? `Rangkaianmu ${game.streak} hari. Lanjutkan lewat kuis, Hanzi, percakapan, atau review.` : 'Kelas pertamamu akan tampil setelah akses diaktifkan.'}</p><a class="btn lime" href="#${next ? 'lessons/' + next.id : 'lessons'}">${next ? 'Buka sesi berikutnya' : 'Lihat kelas'} <span>→</span></a></div><div class="hero-hanzi" aria-hidden="true">学<small>XUÉ · BELAJAR</small></div></section><section class="mission-card"><div class="mission-copy"><span class="mission-icon">今日</span><div><strong>Target hari ini</strong><p>${game.todayXp} / ${game.dailyGoalXp} poin ${game.goalComplete ? '· 完成!' : ''}</p></div></div><div class="progress-track"><span style="width:${goal}%"></span></div><strong class="mission-percent">${goal}%</strong></section><div class="stats game-stats"><div class="stat"><span class="label">Rangkaian</span><div class="number">${game.streak} hari</div><span class="kicker">Rekor ${game.longestStreak} hari</span></div><div class="stat"><span class="label">Energi belajar</span><div class="number hearts-value">${game.hearts === null ? 'Tanpa batas' : `${game.hearts} / ${game.maxHearts}`}</div><a class="link small" href="#premium">${game.plan === 'premium' ? 'Premium aktif' : 'Pulih setiap hari'}</a></div><div class="stat"><span class="label">Pencapaian</span><div class="number">${unlockedBadges}<span class="small muted"> / ${game.achievements.length}</span></div><span class="kicker">Lencana terbuka</span></div></div><div class="dashboard-grid"><section class="panel path-panel"><div class="panel-head"><div><span class="eyebrow">PETA BELAJAR</span><h2>Rute belajarmu</h2></div><a class="link" href="#lessons">Lihat semua →</a></div>${
      d.lessons.length
        ? d.lessons
            .slice(0, 5)
            .map((l, i) => pathNode(l, i, d.progress))
            .join('')
        : '<div class="empty">Belum ada kelas aktif. Hubungi admin kursus.</div>'
    }</section><aside class="stack"><section class="panel"><div class="panel-head"><h2>Aktivitas 7 hari</h2><span class="pill">${game.xp} XP</span></div><div class="week-chart">${game.week.map((w) => `<div title="${esc(w.day)} · ${w.xp} XP"><span style="height:${Math.max(8, Math.min(100, w.xp * 3))}%"></span><small>${new Date(w.day + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'narrow' })}</small></div>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>Badge</h2><span class="pill">${unlockedBadges}/${game.achievements.length}</span></div><div class="badge-grid">${game.achievements.map((a) => `<div class="achievement ${a.unlocked ? 'unlocked' : ''}"><span>${a.unlocked ? '★' : '☆'}</span><small>${esc(a.label)}</small></div>`).join('')}</div></section><section class="panel daily-character"><div class="panel-head"><h2>Karakter hari ini</h2><span class="pill">写字</span></div><div class="day-character"><div class="hanzi">好</div><div class="pinyin">hǎo</div><p class="small muted">baik · bagus</p></div><a href="#practice/好" class="btn outline full">+5 XP · Latih sekarang</a></section></aside></div><p class="footer-note">每天进步一点点 · Kemajuan kecil tetap berarti.</p>`
  );
}
function lessonRow(l, i, progress = []) {
  const p = progress.find((x) => x.lesson_id === l.id);
  return `<div class="lesson-row"><div class="lesson-no">${['一', '二', '三', '四', '五', '六'][i % 6]}</div><div class="body"><h3>${esc(l.title)}</h3><p>${p ? `Kuis terbaik: ${p.score}%${p.score >= 70 ? ' · Selesai' : ' · Yuk coba lagi'}` : 'Baca · Tulis · Dengarkan · Latihan'}</p></div><a href="#lessons/${l.id}" class="btn secondary small">${p?.score >= 70 ? 'Ulangi' : 'Mulai'} →</a></div>`;
}
function pathNode(l, i, progress = []) {
  const p = progress.find((x) => x.lesson_id === l.id);
  const completed = p?.score >= 70;
  const previousDone =
    i === 0 || progress.some((x) => x.lesson_id === Number(l.id) - 1 && x.score >= 70);
  const state = completed ? 'done' : previousDone ? 'current' : 'upcoming';
  return `<a class="path-node ${state}" href="#lessons/${l.id}"><span class="path-dot">${completed ? '✓' : i + 1}</span><span class="path-copy"><strong>${esc(l.title)}</strong><small>${completed ? `${p.score}% · Selesai` : state === 'current' ? '+25 XP · Mulai sekarang' : 'Bisa dipelajari setelah materi sebelumnya'}</small></span><span class="path-arrow">${state === 'upcoming' ? '○' : '›'}</span></a>`;
}
async function lessons(id) {
  if (!id) {
    const d = await api('/dashboard');
    return (
      head('Kelas Mandarin', 'Materi terstruktur, latihan singkat, dan ruang untuk mengulang.') +
      d.courses
        .map(
          (c) =>
            `<section class="panel mb"><div class="panel-head"><div><div class="eyebrow">${esc(c.level)}</div><h2>${esc(c.title)}</h2></div><span class="pill ${c.enrolled ? '' : 'warn'}">${c.enrolled ? 'Akses aktif' : 'Belum terdaftar'}</span></div><p class="muted small">${esc(c.description)}</p>${
              c.enrolled
                ? d.lessons
                    .filter((l) => l.course_id === c.id)
                    .map((l, i) => lessonRow(l, i, d.progress))
                    .join('')
                : '<div class="notice">Hubungi admin kursus untuk mengaktifkan kelas ini.</div>'
            }</section>`,
        )
        .join('')
    );
  }
  const l = await api('/lessons/' + id);
  return `<a href="#lessons" class="link">← Kembali ke kelas</a><div class="mt">${head(l.title, 'Pahami maknanya, praktikkan, lalu cek pemahamanmu.')}</div><div class="panel"><div class="text-body">${esc(l.body)}</div><div class="panel-head"><h2>Kosakata inti</h2><button class="btn secondary small" data-action="add-cards" data-id="${l.id}">+ Simpan untuk review</button></div><div class="word-grid">${l.words.map((w) => `<div class="word"><strong>${esc(w.hanzi)}</strong><p class="pinyin">${esc(w.pinyin)}</p><p>${esc(w.meaning)}</p><div class="row mt"><button class="link" data-action="speak" data-text="${esc(w.hanzi)}" aria-label="Dengarkan ${esc(w.hanzi)}">◖ Dengarkan</button><a class="link" href="#practice/${encodeURIComponent([...w.hanzi][0])}">Tulis ↗</a></div></div>`).join('')}</div><div class="divider"></div><h2>Cek pemahamanmu</h2><p class="muted small mt">Minimal 70% untuk menyelesaikan materi. Kamu boleh mengulang.</p><form id="quiz-form" class="quiz" data-id="${l.id}">${l.quiz.map((q, i) => `<fieldset><legend>${i + 1}. ${esc(q.question)}</legend>${q.options.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}" required>${esc(o)}</label>`).join('')}</fieldset>`).join('')}<button class="btn">Periksa jawaban →</button><div id="quiz-result" class="mt" role="status"></div></form></div>`;
}
function practice() {
  return (
    head(
      'Goresan demi goresan',
      'Lihat urutannya. Coba tulis sendiri. Ulangi sampai terasa alami.',
    ) +
    `<div class="practice-grid"><section class="panel"><form id="character-form" class="row"><label for="character">Karakter</label><input id="character" name="character" value="你" maxlength="2" required style="width:90px;text-align:center;font-size:25px"><button class="btn secondary">Tampilkan</button><span id="character-pinyin" class="muted"></span></form><div id="writer" class="writer" aria-label="Kanvas latihan menulis Hanzi"></div><p id="practice-feedback" class="practice-feedback" role="status">Perhatikan urutan goresan terlebih dahulu.</p><div class="row spread mt"><button class="btn secondary" data-action="animate">▶ Lihat contoh</button><button class="btn" data-action="quiz-hanzi">Coba menulis →</button></div></section><aside class="panel"><div class="eyebrow">写字 · Menulis Hanzi</div><h2>Pelan itu tidak apa-apa.</h2><ol class="steps"><li>Pilih satu karakter Hanzi. Karakter sederhana maupun tradisional dapat digunakan.</li><li>Tekan Lihat contoh untuk mempelajari arah dan urutan goresan.</li><li>Tekan Coba menulis. Ikuti garis bantu dengan jari atau pena digital.</li></ol><div class="note">Catatan latihan ini untuk belajar mandiri. Untuk koreksi tulisan di kertas, kirim foto melalui menu Foto & pelafalan.</div><div class="chips">${['你', '好', '我', '是', '学', '生', '中', '国', '人', '一', '二', '三'].map((c) => `<a class="chip" href="#practice/${c}">${c}</a>`).join('')}</div></aside></div>`
  );
}
async function loadWriter(c) {
  c = decodeURIComponent(c);
  if (!/^\p{Script=Han}$/u.test(c)) {
    toast('Pilih satu karakter Hanzi.');
    c = '你';
  }
  $('#character').value = c;
  $('#writer').replaceChildren();
  try {
    await fetch(`/data/hanzi/${encodeURIComponent(c)}`).then((r) => {
      if (!r.ok) throw new Error('Data karakter belum tersedia. Coba karakter lain.');
      return r.json();
    });
    if (!$('#writer')) return;
    writer = window.HanziWriter.create('writer', c, {
      width: 278,
      height: 278,
      padding: 20,
      strokeColor: '#9f1f2f',
      radicalColor: '#d39a37',
      outlineColor: '#eadfd8',
      drawingColor: '#9f1f2f',
      showOutline: true,
      charDataLoader: (char, onLoad, onError) =>
        fetch(`/data/hanzi/${encodeURIComponent(char)}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Data tidak tersedia'))))
          .then(onLoad)
          .catch(onError),
    });
    const r = await api('/pinyin?text=' + encodeURIComponent(c));
    if ($('#character-pinyin')) $('#character-pinyin').textContent = r.pinyin;
  } catch (e) {
    writer = null;
    if ($('#practice-feedback')) $('#practice-feedback').textContent = e.message;
  }
}
async function review() {
  reviewCards = await api('/reviews');
  reviewIndex = 0;
  return (
    head(
      'Sedikit diulang, lama diingat',
      'Jadwal review menyesuaikan seberapa mudah kamu mengingatnya.',
    ) +
    `<section class="panel" style="max-width:760px;margin:auto"><div class="panel-head"><h2>Review hari ini</h2><span id="review-count" class="pill"></span></div><div id="review-card"></div></section>`
  );
}
function renderCard() {
  const c = reviewCards[reviewIndex];
  $('#review-count').textContent =
    `${Math.min(reviewIndex, reviewCards.length)} / ${reviewCards.length}`;
  if (!c) {
    $('#review-card').innerHTML =
      '<div class="empty">✓ Review selesai untuk saat ini.<br>Kartu yang perlu diulang akan muncul sesuai jadwal.<br><a href="#lessons" class="btn secondary mt">Tambah kosakata dari materi →</a></div>';
    return;
  }
  $('#review-card').innerHTML =
    `<div class="flashcard"><p class="eyebrow">Ingat pinyin dan artinya</p><div class="hanzi">${esc(c.hanzi)}</div><div id="card-answer" hidden><p class="pinyin">${esc(c.pinyin)}</p><p class="meaning">${esc(c.meaning)}</p><button class="link" data-action="speak" data-text="${esc(c.hanzi)}">◖ Dengarkan</button></div><button id="reveal" class="btn secondary mt" data-action="reveal">Tampilkan jawaban</button></div><div class="ratings" id="ratings" hidden>${['Lagi', 'Sulit', 'Baik', 'Mudah'].map((label, i) => `<button class="btn ${i === 2 ? '' : 'secondary'}" data-action="rate" data-rating="${i + 1}">${label}</button>`).join('')}</div><p class="small muted mt">Nilai berdasarkan ingatanmu sebelum melihat jawaban.</p>`;
  $('#ratings').style.display = 'none';
}
async function tutor() {
  const messages = await api('/chat');
  return (
    head(
      'Ngobrol dengan tutor',
      'Latih percakapan dan perbaiki kalimat, satu balasan setiap kali.',
    ) +
    `<section class="panel" style="max-width:900px;margin:auto"><div class="panel-head"><div><h2>小文 · Teman belajar Mandarin</h2><p class="muted small">Penjelasan dalam bahasa Indonesia</p></div><span class="pill ${capabilities.chat ? '' : 'warn'}">${capabilities.chat ? 'Tutor aktif' : 'Menunggu aktivasi'}</span></div>${!capabilities.chat ? '<div class="notice">Admin perlu mengaktifkan layanan tutor AI. Materi dan latihan Hanzi tetap bisa dipakai.</div>' : ''}<div id="chat-log" class="chat-log">${messages.length ? messages.map(bubble).join('') : bubble({ role: 'assistant', content: '你好！Saat tutor aktif, kamu bisa berlatih perkenalan, bertanya kosakata, atau meminta koreksi kalimat. Mau mulai dari mana?' })}</div><div class="chips">${['Bantu aku berkenalan dalam Mandarin', 'Jelaskan perbedaan 是 dan 很', 'Koreksi: 我是很高兴'].map((t) => `<button class="chip" data-action="prompt" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div><form id="chat-form" class="chat-input"><label class="sr-only" for="chat-text" hidden>Pesan</label><textarea id="chat-text" name="text" maxlength="2000" required placeholder="Tulis kalimat atau pertanyaanmu…" ${capabilities.chat ? '' : 'disabled'}></textarea><button class="btn" ${capabilities.chat ? '' : 'disabled'}>Kirim ↗</button></form><div class="row spread mt"><p class="small muted">AI dapat keliru. Konfirmasikan materi penting kepada laoshi.</p><button class="link" data-action="clear-chat">Hapus percakapan</button></div></section>`
  );
}
function bubble(m) {
  return `<div class="bubble ${m.role === 'user' ? 'user' : ''}"><small>${m.role === 'user' ? 'Kamu' : 'Tutor Mandarin'}</small>${esc(m.content)}</div>`;
}
async function tasks() {
  const list = await api('/submissions');
  return (
    head(
      'Tulis. Ucapkan. Bertumbuh.',
      'Kirim latihan untuk mendapatkan umpan balik AI dan laoshi.',
    ) +
    `<div class="grid equal"><section class="panel"><h2>Kirim latihan baru</h2><form id="upload-form"><div class="field"><label for="kind">Jenis latihan</label><select id="kind" name="kind"><option value="image">Foto tulisan tangan</option><option value="audio">Rekaman pelafalan</option></select></div><div class="field"><label for="target">Hanzi yang sedang dilatih</label><input id="target" name="target" maxlength="200" value="你好" required><small>Gunakan kalimat yang sama pada foto atau rekaman.</small></div><div class="field"><label for="file">Pilih foto atau rekaman</label><input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,audio/*"><small>Maksimal 8 MB. Rekaman maksimal 60 detik.</small></div><div id="recording-controls" hidden><button type="button" class="btn secondary" data-action="record" id="record-button">● Rekam suara</button><p id="record-status" class="small muted mt"></p><audio id="record-preview" controls hidden></audio></div><div class="field"><label class="check"><input name="consent" type="checkbox" value="yes" required><span>Saya setuju latihan ini diproses layanan AI kursus dan dilihat laoshi untuk memberikan koreksi.</span></label></div><button class="btn full">Kirim latihan →</button><div id="upload-result" class="mt" role="status"></div></form></section><aside class="panel"><div class="eyebrow">小提示 · Panduan kecil</div><h2>Buat latihanmu mudah diperiksa.</h2><p class="muted small mt">Foto dari atas, gunakan cahaya yang cukup, dan pastikan tulisan memenuhi bingkai. Untuk pelafalan, cari tempat tenang dan baca target dengan jelas.</p><div class="tone-guide"><div><strong>mā</strong>Rata →</div><div><strong>má</strong>Naik ↗</div><div><strong>mǎ</strong>Turun-naik ↘↗</div><div><strong>mà</strong>Turun ↘</div></div><div class="note">OCR membaca karakter pada foto; urutan dan bentuk goresan tetap perlu ditinjau laoshi. Skor nada hanya ditampilkan jika mesin penilai memang mengembalikannya.</div><p class="small muted">OCR: ${capabilities.ocr ? 'terkonfigurasi' : 'belum aktif'} · Penilai suara: ${capabilities.speech ? 'terkonfigurasi' : 'belum aktif'}. Jika layanan belum aktif, tugas tetap tersimpan untuk laoshi.</p></aside></div><section class="panel mt"><div class="panel-head"><h2>${user.role === 'student' ? 'Riwayat latihanku' : 'Latihan siswa'}</h2><span class="pill">${list.length} tugas terbaru</span></div>${list.length ? list.map(submission).join('') : '<div class="empty">Belum ada latihan. Foto tulisan pertamamu bisa jadi awal yang bagus.</div>'}</section>`
  );
}
function submission(s) {
  return `<article class="submission"><div class="row spread"><h3>${esc(s.target)} <span class="small muted">· ${esc(s.name)} · ${s.kind === 'image' ? 'Tulisan' : 'Pelafalan'}</span></h3><span class="pill">${{ pending: 'Menunggu laoshi', ai_reviewed: 'Umpan balik AI', reviewed: 'Sudah ditinjau' }[s.status] || esc(s.status)}</span></div><p class="small muted mt">${date(s.created_at + 'Z')}</p>${s.kind === 'image' ? `<a href="/api/submissions/${s.id}/file" target="_blank" rel="noopener"><img loading="lazy" src="/api/submissions/${s.id}/file" alt="Latihan tulisan ${esc(s.target)}"></a>` : `<audio controls preload="none" src="/api/submissions/${s.id}/file"></audio>`}${resultHTML(s.result)}${s.feedback ? `<div class="feedback"><strong>Catatan laoshi</strong><br>${esc(s.feedback)}</div>` : ''}${user.role !== 'student' ? `<form class="feedback-form mt" data-id="${s.id}"><label for="feedback-${s.id}">Koreksi laoshi</label><textarea id="feedback-${s.id}" name="feedback" required maxlength="5000" placeholder="Tulis koreksi dan saran latihan…">${esc(s.feedback || '')}</textarea><button class="btn small mt">Simpan koreksi</button></form>` : ''}<button class="link mt" data-action="delete-submission" data-id="${s.id}">Hapus tugas</button></article>`;
}
function resultHTML(r) {
  if (!r) return '';
  return `<div class="feedback">${r.recognized ? `<strong>Teks terbaca:</strong> ${esc(r.recognized)}<br>` : ''}${r.matchesTarget !== undefined ? `Kecocokan teks target: ${r.matchesTarget ? 'sesuai' : 'perlu diperiksa'}<br>` : ''}${esc(r.feedback || r.summary || '')}${r.note ? `<p class="small mt">${esc(r.note)}</p>` : ''}${r.metrics?.length ? `<div class="row mt">${r.metrics.map((m) => `<span class="pill">${esc(m.label)}: ${esc(m.value)}</span>`).join('')}</div>` : ''}${r.words?.length ? `<p class="mt small">${r.words.map((w) => `${esc(w.text)}: ${esc(w.feedback)}`).join('<br>')}</p>` : ''}</div>`;
}
function whatsapp() {
  return (
    head('Belajar lewat WhatsApp', 'Satu akun, percakapan dan latihan yang tetap terhubung.') +
    `<div class="grid equal"><section class="panel"><div class="panel-head"><h2>Hubungkan akunmu</h2><span class="pill ${user.phone ? '' : 'warn'}">${user.phone ? 'Terhubung' : 'Belum terhubung'}</span></div>${user.phone ? `<p class="muted">Nomor aktif: +${esc(user.phone)}</p><button class="btn outline mt" data-action="unlink">Putuskan tautan</button>` : `<p class="muted small">Buat kode pribadi, lalu kirim dari nomor WhatsApp yang ingin dipakai belajar. Kode berlaku 10 menit dan hanya sekali pakai.</p><label class="check mt"><input id="wa-consent" type="checkbox"><span>Saya setuju pesan dan latihan WhatsApp saya diproses layanan AI kursus dan dapat ditinjau laoshi.</span></label><button class="btn mt" data-action="link-wa">Buat kode penghubung →</button><div id="wa-code" class="mt"></div>`}${!capabilities.whatsapp ? '<div class="notice">Nomor WhatsApp kursus belum diaktifkan oleh admin. Kamu tetap bisa belajar melalui portal.</div>' : ''}</section><aside class="panel"><h2>Latihan yang bisa kamu kirim</h2><ol class="steps"><li>Teks Mandarin untuk latihan percakapan dan koreksi kalimat.</li><li>Kirim <strong>/latihan 你好</strong>, lalu foto tulisan atau rekaman membaca target.</li><li>Kirim <strong>/kartu</strong> untuk review kosakata yang sudah kamu simpan.</li></ol><div class="note">Kirim /bantuan untuk melihat perintah. Hasil tugas foto/suara dan koreksi laoshi tersimpan di menu Foto & pelafalan.</div></aside></div>`
  );
}
async function premium() {
  const p = await api('/plans');
  const money = new Intl.NumberFormat('id-ID').format(p.price);
  const premiumActive = p.current === 'premium';
  return (
    head(
      premiumActive ? 'Premium aktif' : 'Belajar lebih bebas',
      premiumActive
        ? 'Semua benefit Premium sudah aktif di akunmu.'
        : 'Mulai gratis. Upgrade hanya saat ritme belajarmu membutuhkan lebih banyak.',
      premiumActive ? '会员 · PREMIUM' : 'FREEMIUM · 无压力',
    ) +
    `<section class="premium-hero"><div><span class="premium-crown">冠</span><div class="eyebrow">LaoshiKu Premium</div><h2>Lebih leluasa berlatih.<br>Lebih dekat ke tujuanmu.</h2><p>Energi tanpa batas, tutor AI lebih banyak, dan prioritas koreksi pelafalan.</p></div><div class="premium-price"><span>Mulai dari</span><strong>Rp${money}</strong><small>/ bulan</small></div></section><div class="plan-grid"><section class="plan-card ${!premiumActive ? 'current' : ''}"><div class="plan-title"><div><span class="eyebrow">Mulai belajar</span><h2>Gratis</h2></div>${!premiumActive ? '<span class="pill">Paketmu</span>' : ''}</div><div class="plan-price"><strong>Rp0</strong><span>selamanya</span></div><ul class="feature-list">${p.free.map((x) => `<li><span>✓</span>${esc(x)}</li>`).join('')}</ul><a class="btn secondary full" href="#home">Lanjutkan belajar</a></section><section class="plan-card featured ${premiumActive ? 'current' : ''}"><div class="best-value">AKSES LEBIH LUAS</div><div class="plan-title"><div><span class="eyebrow">Belajar intensif</span><h2>Premium</h2></div>${premiumActive ? '<span class="pill">Aktif</span>' : ''}</div><div class="plan-price"><strong>Rp${money}</strong><span>per bulan</span></div><ul class="feature-list">${p.premium.map((x) => `<li><span>✓</span>${esc(x)}</li>`).join('')}</ul>${premiumActive ? '<a class="btn lime full" href="#home">Premium sudah aktif ✓</a>' : p.checkoutUrl ? `<a class="btn lime full" target="_blank" rel="noopener" href="${esc(p.checkoutUrl)}">Upgrade via WhatsApp →</a>` : '<button class="btn lime full" disabled>Hubungi admin untuk upgrade</button>'}<p class="plan-note">Aktivasi dilakukan admin setelah pembayaran terkonfirmasi. Tidak ada perpanjangan otomatis tersembunyi.</p></section></div><section class="panel mt"><div class="panel-head"><h2>Dibuat untuk kebiasaan yang sehat</h2><span class="pill">Transparan</span></div><div class="benefit-grid"><div><strong>Ritme konsisten</strong><p>Rangkaian dan target harian menjaga kebiasaan tanpa harus belajar lama.</p></div><div><strong>Progres terukur</strong><p>Poin diberikan dari aktivitas nyata dan tidak dapat digandakan dengan refresh.</p></div><div><strong>Tetap manusiawi</strong><p>Paket gratis tetap berguna. Premium mengurangi batas, bukan menyembunyikan dasar belajar.</p></div></div></section>`
  );
}
function account() {
  return (
    head('Akun saya', 'Atur akses pribadi dan keamanan akunmu.') +
    `<div class="grid equal"><section class="panel profile-card"><div class="avatar large">${esc(user.name.slice(0, 1).toUpperCase())}</div><h2>${esc(user.name)}</h2><p class="muted mt">${esc(user.email)}</p><div class="row mt"><span class="pill">Level ${game.level || 1}</span><span class="pill">${game.plan === 'premium' ? 'Premium' : 'Free'}</span><span class="pill">${game.xp || 0} XP</span></div><a class="btn outline mt" href="#premium">Kelola paket</a><button class="link mt" data-action="logout">Keluar dari akun</button></section><section class="panel"><h2>Ganti kata sandi</h2><form id="password-form"><div class="field"><label for="old-password">Kata sandi saat ini</label><input id="old-password" name="current" type="password" autocomplete="current-password" required></div><div class="field"><label for="new-password">Kata sandi baru</label><input id="new-password" name="password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required><small>Minimal 12 karakter. Setelah diganti, masuk kembali.</small></div><button class="btn">Simpan kata sandi</button></form></section></div>`
  );
}
async function staff() {
  if (user.role === 'student') throw new Error('Khusus laoshi dan admin.');
  staffData = await api('/staff');
  const d = staffData;
  return (
    head('Ruang laoshi', 'Kelola kelas, pantau siswa, dan berikan arahan berikutnya.') +
    `<div class="stats"><div class="stat"><div class="label">Siswa</div><div class="number">${d.users.filter((u) => u.role === 'student').length}</div></div><div class="stat"><div class="label">Materi terbit</div><div class="number">${d.lessons.filter((l) => l.published).length}</div></div><div class="stat"><div class="label">Member Premium</div><div class="number">${d.users.filter((u) => u.plan === 'premium').length}</div></div></div><section class="panel mb"><div class="panel-head"><h2>Siswa & perkembangan</h2><a class="btn secondary small" href="#tasks">Periksa tugas →</a></div><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Paket & XP</th><th>Kelas</th><th>Materi lulus</th>${user.role === 'admin' ? '<th>Kelola</th>' : ''}</tr></thead><tbody>${d.users
      .map(
        (u) =>
          `<tr><td>${esc(u.name)}<small>${esc(u.email)} · ${u.active ? 'Aktif' : 'Nonaktif'} · ${esc(u.role)}</small></td><td><span class="pill ${u.plan === 'premium' ? '' : 'warn'}">${u.plan === 'premium' ? 'Premium' : 'Free'}</span><small>${u.xp} XP · 🔥 ${u.streak}</small></td><td>${
            d.enrollments
              .filter((e) => e.user_id === u.id)
              .map(
                (e) =>
                  `${esc(d.courses.find((c) => c.id === e.course_id)?.title)}<small>${e.expires ? 'Sampai ' + date(e.expires) : 'Tanpa batas waktu'} ${user.role === 'admin' ? `<button class="link" data-action="unenroll" data-user="${u.id}" data-course="${e.course_id}">Cabut</button>` : ''}</small>`,
              )
              .join('') || '—'
          }</td><td>${d.progress.filter((p) => p.user_id === u.id && p.score >= 70).length}</td>${user.role === 'admin' ? `<td>${u.id !== user.id ? `<button class="link" data-action="set-plan" data-id="${u.id}" data-plan="${u.plan === 'premium' ? 'free' : 'premium'}">${u.plan === 'premium' ? 'Jadikan Free' : 'Aktifkan Premium'}</button><button class="link" data-action="toggle-user" data-id="${u.id}" data-active="${u.active ? 'false' : 'true'}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button><button class="link" data-action="reset-password" data-id="${u.id}">Reset sandi</button>` : '—'}</td>` : ''}</tr>`,
      )
      .join('')}</tbody></table></div><div id="reset-password-panel"></div></section>${
      user.role === 'admin'
        ? `<div class="grid equal mb"><section class="panel"><h2>Tambah akun</h2><form id="user-form"><div class="field"><label>Nama<input name="name" required maxlength="100"></label></div><div class="field"><label>Email<input name="email" type="email" required></label></div><div class="field"><label>Kata sandi awal<input name="password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required></label></div><div class="field"><label>Peran<select name="role"><option value="student">Siswa</option><option value="teacher">Laoshi</option></select></label></div><button class="btn">Buat akun</button></form></section><section class="panel"><h2>Aktifkan akses kelas</h2><form id="enroll-form"><div class="field"><label>Siswa<select name="user_id">${d.users
            .filter((u) => u.role === 'student')
            .map((u) => `<option value="${u.id}">${esc(u.name)} · ${esc(u.email)}</option>`)
            .join(
              '',
            )}</select></label></div><div class="field"><label>Kelas<select name="course_id">${d.courses.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select></label></div><div class="field"><label>Berakhir pada (opsional)<input name="expires" type="date"></label><small>Akses diaktifkan admin setelah pendaftaran/pembayaran dikonfirmasi di luar aplikasi.</small></div><button class="btn">Simpan akses kelas</button></form></section></div>`
        : ''
    }<section class="panel mb"><div class="panel-head"><h2>Materi kelas</h2><button class="btn secondary small" data-action="new-lesson">+ Materi baru</button></div>${d.lessons.map((l) => `<div class="lesson-row"><div class="body"><h3>${esc(l.title)}</h3><p>${esc(d.courses.find((c) => c.id === l.course_id)?.title)} · ${l.published ? 'Terbit' : 'Draf'}</p></div><button class="btn outline small" data-action="edit-lesson" data-id="${l.id}">Edit</button></div>`).join('')}<div id="lesson-editor"></div></section><section class="panel mb"><details><summary>+ Buat kelas baru</summary><form id="course-form"><div class="field"><label>Nama kelas<input name="title" required></label></div><div class="field"><label>Tingkat<input name="level" value="Pemula" required></label></div><div class="field"><label>Deskripsi<textarea name="description"></textarea></label></div><button class="btn">Simpan kelas</button></form></details></section><section class="panel"><h2>Koneksi layanan</h2><div class="chips">${Object.entries(
      d.capabilities,
    )
      .map(
        ([k, v]) =>
          `<span class="pill ${v ? '' : 'warn'}">${{ chat: 'Tutor AI', ocr: 'OCR', speech: 'Penilai suara', whatsapp: 'WhatsApp' }[k]}: ${v ? 'terkonfigurasi' : 'belum aktif'}</span>`,
      )
      .join(
        '',
      )}</div><p class="small muted">Status ini memeriksa konfigurasi. Uji kirim satu pesan, foto, dan rekaman setelah kredensial diisi.</p>${d.jobs
      .filter((j) => j.status === 'failed')
      .map(
        (j) =>
          `<p class="small mt">Pesan gagal: ${esc(j.id)} · ${esc(j.last_error)} ${user.role === 'admin' ? `<button class="link" data-action="retry-job" data-id="${esc(j.id)}">Coba ulang</button>` : ''}</p>`,
      )
      .join('')}</section>`
  );
}
function wordEditor(w = {}) {
  return `<div class="editor-word"><input aria-label="Hanzi" class="w-hanzi" value="${esc(w.hanzi || '')}" placeholder="你好" required><input aria-label="Pinyin" class="w-pinyin" value="${esc(w.pinyin || '')}" placeholder="nǐ hǎo" required><input aria-label="Arti" class="w-meaning" value="${esc(w.meaning || '')}" placeholder="halo" required><button type="button" class="link remove-word" data-action="remove-word" aria-label="Hapus kosakata">×</button></div>`;
}
function questionEditor(q = { question: '', options: ['', ''], answer: 0 }) {
  return `<div class="editor-question"><label>Pertanyaan<input class="q-question" value="${esc(q.question)}" required></label><label>Pilihan jawaban (satu per baris)<textarea class="q-options" required>${esc(q.options.join('\n'))}</textarea></label><label>Nomor jawaban benar<input class="q-answer" type="number" min="1" max="6" value="${q.answer + 1}" required></label><button type="button" class="link" data-action="remove-question">Hapus pertanyaan</button></div>`;
}
function editor(l) {
  const isNew = !l;
  l = l || {
    title: '',
    body: '',
    course_id: staffData.courses[0]?.id,
    position: staffData.lessons.length + 1,
    words: [{}],
    quiz: [{ question: '', options: ['', ''], answer: 0 }],
    published: false,
  };
  $('#lesson-editor').innerHTML =
    `<div class="divider"></div><h2>${isNew ? 'Materi baru' : 'Edit materi'}</h2><form id="lesson-form" data-id="${l.id || ''}"><div class="field"><label>Kelas<select name="course_id">${staffData.courses.map((c) => `<option value="${c.id}" ${c.id === l.course_id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label></div><div class="field"><label>Judul<input name="title" value="${esc(l.title)}" required maxlength="200"></label></div><div class="field"><label>Urutan<input name="position" type="number" min="0" value="${l.position}" required></label></div><div class="field"><label>Isi materi<textarea name="body" rows="9" required>${esc(l.body)}</textarea></label></div><h3 class="mb">Kosakata</h3><div id="word-editors">${l.words.map(wordEditor).join('')}</div><button type="button" class="link" data-action="add-word">+ Kosakata</button><h3 class="mt">Kuis</h3><div id="question-editors">${l.quiz.map(questionEditor).join('')}</div><button type="button" class="link" data-action="add-question">+ Pertanyaan</button><div class="field"><label class="check"><input name="published" type="checkbox" ${l.published ? 'checked' : ''}>Terbitkan untuk siswa</label></div><button class="btn">Simpan materi</button></form>`;
  $('#lesson-editor').scrollIntoView({ behavior: 'smooth' });
}
function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Browser belum mendukung pembaca suara.');
  const voices = speechSynthesis.getVoices().filter((v) => /^zh[-_]?(CN|TW|HK)?/i.test(v.lang));
  if (!voices.length)
    return toast(
      'Suara Mandarin belum tersedia di perangkat ini. Tambahkan suara Mandarin pada pengaturan perangkat.',
    );
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.voice = voices.find((v) => /CN/i.test(v.lang)) || voices[0];
  u.rate = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target,
    submit = f.querySelector('button:not([type="button"])');
  if (submit?.disabled) return;
  if (submit) submit.disabled = true;
  const b = Object.fromEntries(new FormData(f));
  try {
    if (f.id === 'login-form') {
      const d = await api('/login', b);
      user = d.user;
      csrf = d.csrf;
      const me = await api('/me');
      capabilities = me.capabilities;
      game = me.gamification;
      shell();
      await route();
    } else if (f.id === 'register-form') {
      const d = await api('/register', {
        name: b.name,
        email: b.email,
        password: b.password,
        consent: b.consent === 'on',
      });
      user = d.user;
      csrf = d.csrf;
      const me = await api('/me');
      capabilities = me.capabilities;
      game = me.gamification;
      shell();
      await route();
      toast('Akun LaoshiKu berhasil dibuat. Selamat belajar!');
    } else if (f.id === 'quiz-form') {
      const answers = [...f.querySelectorAll('fieldset')].map((_, i) => Number(b['q' + i]));
      const r = await api(`/lessons/${f.dataset.id}/quiz`, { answers });
      syncGame(r.gamification);
      $('#quiz-result').innerHTML =
        `<div class="feedback"><strong>Hasil: ${r.score}% · ${r.passed ? 'Materi selesai!' : 'Coba lagi, kamu bisa.'}</strong>${r.earnedXp ? `<div class="xp-earned">+${r.earnedXp} XP</div>` : ''}<p>${r.corrections.map((q, i) => `Nomor ${i + 1}: ${q.correct ? '✓ Benar' : `jawaban ${q.answer + 1}`}`).join(' · ')}</p></div>`;
    } else if (f.id === 'character-form') loadWriter(b.character.trim());
    else if (f.id === 'chat-form') {
      const text = b.text.trim();
      if (!text) return;
      const d = await api('/chat', { text });
      $('#chat-log').insertAdjacentHTML(
        'beforeend',
        bubble({ role: 'user', content: text }) + bubble({ role: 'assistant', content: d.answer }),
      );
      $('#chat-text').value = '';
      $('#chat-log').scrollTop = 1e6;
    } else if (f.id === 'upload-form') {
      const data = new FormData(f);
      if (b.kind === 'audio' && recordedBlob) data.set('file', recordedBlob, 'recording.webm');
      if (!data.get('file')?.size) throw new Error('Pilih file atau rekam suara terlebih dahulu.');
      $('#upload-result').textContent = 'Menyimpan dan memeriksa latihan…';
      const saved = await api('/submissions', data);
      syncGame(saved.gamification);
      stopRecording();
      toast(`Latihan tersimpan. +${saved.earnedXp || 0} XP`);
      await route();
    } else if (f.classList.contains('feedback-form')) {
      await api(`/submissions/${f.dataset.id}/feedback`, {
        feedback: b.feedback,
      });
      toast('Koreksi tersimpan.');
      await route();
    } else if (f.id === 'password-form') {
      await api('/password', b);
      user = null;
      login();
      toast('Kata sandi diganti. Silakan masuk kembali.');
    } else if (f.id === 'user-form') {
      await api('/admin/users', b);
      toast('Akun dibuat. Aktifkan akses kelasnya.');
      await route();
    } else if (f.id === 'reset-password-form') {
      await api('/admin/users/' + f.dataset.id, { password: b.password }, 'PATCH');
      toast('Kata sandi direset dan sesi lama dihentikan.');
      await route();
    } else if (f.id === 'enroll-form') {
      await api('/admin/enrollments', {
        user_id: Number(b.user_id),
        course_id: Number(b.course_id),
        expires: b.expires ? new Date(b.expires + 'T23:59:59+07:00').toISOString() : null,
      });
      toast('Akses kelas tersimpan.');
      await route();
    } else if (f.id === 'course-form') {
      await api('/staff/courses', b);
      toast('Kelas dibuat.');
      await route();
    } else if (f.id === 'lesson-form') {
      const words = $$('.editor-word').map((row) => ({
        hanzi: row.querySelector('.w-hanzi').value,
        pinyin: row.querySelector('.w-pinyin').value,
        meaning: row.querySelector('.w-meaning').value,
      }));
      const quiz = $$('.editor-question').map((row) => ({
        question: row.querySelector('.q-question').value,
        options: row
          .querySelector('.q-options')
          .value.split('\n')
          .map((v) => v.trim())
          .filter(Boolean),
        answer: Number(row.querySelector('.q-answer').value) - 1,
      }));
      await api(
        '/staff/lessons' + (f.dataset.id ? '/' + f.dataset.id : ''),
        {
          course_id: Number(b.course_id),
          position: Number(b.position),
          title: b.title,
          body: b.body,
          words,
          quiz,
          published: b.published === 'on',
        },
        f.dataset.id ? 'PUT' : 'POST',
      );
      toast('Materi tersimpan.');
      await route();
    }
  } catch (err) {
    toast(err.message);
    if (f.id === 'login-form' && $('#login-error')) $('#login-error').textContent = err.message;
    if (f.id === 'register-form' && $('#register-error'))
      $('#register-error').textContent = err.message;
    if (f.id === 'upload-form' && $('#upload-result'))
      $('#upload-result').textContent = err.message;
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (el.disabled) return;
  el.disabled = true;
  try {
    if (a === 'show-register' || a === 'show-login') {
      const registerMode = a === 'show-register';
      if ($('#register-panel')) $('#register-panel').hidden = !registerMode;
      if ($('#login-panel')) $('#login-panel').hidden = registerMode;
      $$('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.action === a));
      (registerMode ? $('#register-name') : $('#email'))?.focus();
    }
    if (a === 'logout') {
      await api('/logout', {});
      user = null;
      login();
    }
    if (a === 'speak') speak(el.dataset.text);
    if (a === 'add-cards') {
      await api(`/lessons/${el.dataset.id}/cards`, {});
      toast('Kosakata masuk jadwal review.');
    }
    if (a === 'animate' && writer) writer.animateCharacter();
    if (a === 'quiz-hanzi' && writer) {
      const c = $('#character').value;
      $('#practice-feedback').textContent = 'Ikuti urutan goresan. Kamu bisa!';
      writer.quiz({
        onMistake: (d) => {
          if ($('#practice-feedback'))
            $('#practice-feedback').textContent =
              `Coba arah goresan lagi. Kesalahan: ${d.totalMistakes}`;
        },
        onComplete: async (d) => {
          if ($('#practice-feedback'))
            $('#practice-feedback').textContent =
              `完成！Selesai dengan ${d.totalMistakes} kesalahan.`;
          try {
            const saved = await api('/practice', { hanzi: c, mistakes: d.totalMistakes });
            syncGame(saved.gamification);
            toast(`Latihan tersimpan! +${saved.earnedXp} XP`);
          } catch (err) {
            toast(err.message);
          }
        },
      });
    }
    if (a === 'reveal') {
      $('#card-answer').hidden = false;
      $('#reveal').hidden = true;
      $('#ratings').hidden = false;
      $('#ratings').style.display = 'grid';
    }
    if (a === 'rate') {
      const c = reviewCards[reviewIndex];
      $$('#ratings button').forEach((b) => (b.disabled = true));
      try {
        const rated = await api('/reviews/' + c.id, {
          rating: Number(el.dataset.rating),
          version: c.version,
        });
        syncGame(rated.gamification);
        reviewIndex++;
        renderCard();
      } catch (err) {
        $$('#ratings button').forEach((b) => (b.disabled = false));
        throw err;
      }
    }
    if (a === 'prompt') {
      $('#chat-text').value = el.dataset.text;
      $('#chat-text').focus();
    }
    if (a === 'clear-chat' && confirm('Hapus riwayat percakapan web dan WhatsApp akun ini?')) {
      await api('/chat', null, 'DELETE');
      await route();
    }
    if (a === 'delete-submission' && confirm('Hapus tugas dan file ini?')) {
      await api('/submissions/' + el.dataset.id, null, 'DELETE');
      await route();
    }
    if (a === 'link-wa') {
      if (!$('#wa-consent').checked)
        throw new Error('Centang persetujuan pemrosesan latihan terlebih dahulu.');
      const d = await api('/whatsapp/link', { consent: true });
      $('#wa-code').innerHTML =
        `<div class="code">${esc(d.code)}</div><p class="small muted mt">Kirim: <strong>HUBUNGKAN ${esc(d.code)}</strong>. Berlaku 10 menit. Setelah mengirim, muat ulang halaman ini.</p>${d.phone ? `<a class="btn mt" href="https://wa.me/${encodeURIComponent(d.phone.replace(/\D/g, ''))}?text=${encodeURIComponent('HUBUNGKAN ' + d.code)}" target="_blank" rel="noopener">Buka WhatsApp ↗</a>` : '<p class="notice">Minta nomor WhatsApp resmi kepada admin kursus.</p>'}`;
    }
    if (a === 'unlink' && confirm('Putuskan WhatsApp dari akun ini?')) {
      await api('/whatsapp/link', null, 'DELETE');
      user.phone = null;
      await route();
    }
    if (a === 'record') await record();
    if (a === 'new-lesson') editor();
    if (a === 'edit-lesson') editor(staffData.lessons.find((l) => l.id === Number(el.dataset.id)));
    if (a === 'add-word') $('#word-editors').insertAdjacentHTML('beforeend', wordEditor());
    if (a === 'remove-word') el.closest('.editor-word').remove();
    if (a === 'add-question')
      $('#question-editors').insertAdjacentHTML('beforeend', questionEditor());
    if (a === 'remove-question') el.closest('.editor-question').remove();
    if (a === 'toggle-user' && confirm('Ubah status akses akun ini?')) {
      await api('/admin/users/' + el.dataset.id, { active: el.dataset.active === 'true' }, 'PATCH');
      await route();
    }
    if (
      a === 'set-plan' &&
      confirm(
        el.dataset.plan === 'premium'
          ? 'Aktifkan Premium untuk 30 hari? Pastikan pembayaran sudah terkonfirmasi.'
          : 'Kembalikan akun ini ke paket Free?',
      )
    ) {
      await api(`/admin/users/${el.dataset.id}/plan`, {
        plan: el.dataset.plan,
        premium_until:
          el.dataset.plan === 'premium' ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
      });
      toast(el.dataset.plan === 'premium' ? 'Premium aktif selama 30 hari.' : 'Paket Free aktif.');
      await route();
    }
    if (a === 'reset-password') {
      $('#reset-password-panel').innerHTML =
        `<div class="divider"></div><h3>Reset kata sandi akun #${Number(el.dataset.id)}</h3><form id="reset-password-form" data-id="${Number(el.dataset.id)}"><div class="field"><label>Kata sandi baru<input type="password" name="password" minlength="12" maxlength="72" autocomplete="new-password" required></label></div><button class="btn">Simpan kata sandi baru</button></form>`;
      $('#reset-password-panel').scrollIntoView({ behavior: 'smooth' });
    }
    if (a === 'unenroll' && confirm('Cabut akses kelas ini?')) {
      await api(`/admin/enrollments/${el.dataset.user}/${el.dataset.course}`, null, 'DELETE');
      await route();
    }
    if (a === 'retry-job') {
      await api('/admin/jobs/' + encodeURIComponent(el.dataset.id) + '/retry', {});
      toast('Pesan masuk antrean ulang.');
      await route();
    }
  } catch (err) {
    toast(err.message);
  } finally {
    if (el.isConnected) el.disabled = false;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'kind') {
    $('#recording-controls').hidden = e.target.value !== 'audio';
    if (e.target.value !== 'audio') stopRecording();
  }
  if (e.target.id === 'file') recordedBlob = null;
});
async function record() {
  if (recorder?.state === 'recording') {
    recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      'Perekam membutuhkan HTTPS dan browser yang mendukung. Kamu dapat mengunggah rekaman dari HP.',
    );
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = () => {
    clearTimeout(recordTimer);
    recordedBlob = new Blob(chunks, { type: recorder.mimeType });
    stream.getTracks().forEach((t) => t.stop());
    if ($('#record-button')) {
      $('#record-button').textContent = '● Rekam ulang';
      $('#record-status').textContent = 'Rekaman siap dikirim.';
      const audio = $('#record-preview');
      if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
      audio.src = URL.createObjectURL(recordedBlob);
      audio.hidden = false;
    }
  };
  recorder.start();
  $('#record-button').textContent = '■ Selesai merekam';
  $('#record-status').textContent = 'Merekam… berhenti otomatis setelah 60 detik.';
  recordTimer = setTimeout(() => {
    if (recorder?.state === 'recording') recorder.stop();
  }, 60000);
}
window.addEventListener('hashchange', route);
try {
  const d = await api('/me');
  user = d.user;
  csrf = d.csrf;
  capabilities = d.capabilities;
  game = d.gamification;
  shell();
  await route();
} catch {
  try {
    publicConfig = await api('/public');
  } catch {}
  login();
}
