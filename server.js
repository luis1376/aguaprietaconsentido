const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const db = require('./db');
const SqliteSessionStore = require('./sqliteSessionStore');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CATEGORIES = ['politica', 'frontera', 'comunidad', 'economia', 'seguridad'];

const sessionSecret = db.prepare("SELECT value FROM site_settings WHERE key = 'session_secret'").get().value;

if (IS_PRODUCTION) app.set('trust proxy', 1);

app.use(express.json());
app.use(session({
  store: new SqliteSessionStore(db),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiados intentos, espera unos minutos' }
});

const postLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'estás publicando muy seguido, espera unos minutos' }
});

// ---------- Antispam: CAPTCHA sencillo (sin servicio externo) ----------
const captchaStore = new Map(); // token -> { answer, expires }
const CAPTCHA_TTL_MS = 10 * 60 * 1000;

function cleanupCaptchas() {
  const now = Date.now();
  for (const [token, entry] of captchaStore) {
    if (entry.expires < now) captchaStore.delete(token);
  }
}

function checkHoneypot(req, res) {
  const value = (req.body && req.body.website) || '';
  if (value.trim() !== '') {
    res.status(400).json({ error: 'solicitud inválida' });
    return false;
  }
  return true;
}

app.get('/api/captcha', (req, res) => {
  cleanupCaptchas();
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const token = crypto.randomBytes(16).toString('hex');
  captchaStore.set(token, { answer: a + b, expires: Date.now() + CAPTCHA_TTL_MS });
  res.json({ token, question: `${a} + ${b}` });
});

function checkCaptcha(req, res) {
  const { captchaToken, captchaAnswer } = req.body || {};
  const entry = captchaToken ? captchaStore.get(captchaToken) : null;
  if (entry) captchaStore.delete(captchaToken);
  if (!entry || entry.expires < Date.now() || Number(captchaAnswer) !== entry.answer) {
    res.status(400).json({ error: 'la respuesta de seguridad no es correcta, intenta de nuevo' });
    return false;
  }
  return true;
}

// ---------- Helpers ----------
function getVisitorId(req) {
  const id = req.header('x-visitor-id');
  if (!id || typeof id !== 'string' || id.length > 100) return null;
  return id;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function logActivity(text) {
  db.prepare("INSERT INTO activity (text, created_at) VALUES (?, datetime('now'))").run(text);
}

function extractYoutubeId(input) {
  const s = (input || '').toString().trim();
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
}

function timeAgo(sqliteDatetime) {
  const then = new Date(sqliteDatetime.replace(' ', 'T') + 'Z').getTime();
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function publicUser(id) {
  return db.prepare('SELECT id, email, display_name AS displayName, colonia, bio, role, status FROM users WHERE id = ?').get(id) || null;
}

// ---------- Sesión: cargar usuario actual ----------
app.use((req, res, next) => {
  if (req.session.userId) {
    const user = publicUser(req.session.userId);
    if (user) {
      req.currentUser = user;
    } else {
      req.currentUser = null;
      req.session.userId = null;
    }
  } else {
    req.currentUser = null;
  }
  next();
});

function requireVerified(req, res, next) {
  if (!req.currentUser) return res.status(401).json({ error: 'inicia sesión para publicar' });
  if (req.currentUser.status !== 'verified') return res.status(403).json({ error: 'tu cuenta todavía no está verificada' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') return res.status(403).json({ error: 'no autorizado' });
  next();
}

// ---------- Serializadores ----------
function serializeArticleSummary(row) {
  const commentCount = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE article_id = ?').get(row.id).n;
  return {
    id: row.id,
    title: row.title,
    dek: row.dek,
    category: row.category,
    authorName: row.author_name,
    authorVerified: !!row.author_verified,
    votes: row.votes,
    commentCount,
    timeAgo: timeAgo(row.created_at)
  };
}

function serializeArticleFull(row, visitorId) {
  const upvoted = visitorId
    ? !!db.prepare('SELECT 1 FROM article_upvotes WHERE article_id = ? AND visitor_id = ?').get(row.id, visitorId)
    : false;
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    dek: row.dek,
    body: row.body,
    category: row.category,
    authorName: row.author_name,
    authorVerified: !!row.author_verified,
    votes: row.votes,
    upvoted,
    timeAgo: timeAgo(row.created_at)
  };
}

function serializeCommentsFor(articleId) {
  const rows = db.prepare('SELECT * FROM comments WHERE article_id = ? ORDER BY created_at ASC').all(articleId);
  return rows.map(r => ({
    id: r.id,
    parentId: r.parent_id,
    author: r.author,
    colonia: r.colonia,
    badge: r.badge,
    text: r.text,
    votes: r.votes,
    timeAgo: timeAgo(r.created_at)
  }));
}

function serializePoll() {
  const options = db.prepare('SELECT * FROM poll_options ORDER BY sort_order ASC').all();
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  return {
    options: options.map(o => ({
      key: o.key,
      label: o.label,
      votes: o.votes,
      pct: total > 0 ? Math.round((o.votes / total) * 100) : 0
    })),
    total
  };
}

function serializeThreads() {
  const rows = db.prepare('SELECT * FROM threads ORDER BY created_at DESC').all();
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    category: r.category,
    author: r.author,
    body: r.body,
    votes: r.votes,
    timeAgo: timeAgo(r.created_at)
  }));
}

function serializeVoices() {
  return db.prepare(`
    SELECT author, COUNT(*) AS n
    FROM comments
    GROUP BY author
    ORDER BY n DESC
    LIMIT 5
  `).all();
}

function serializeActivity() {
  const rows = db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT 8').all();
  return rows.map(r => ({ text: r.text, timeAgo: timeAgo(r.created_at) }));
}

function serializePodcasts() {
  const rows = db.prepare('SELECT * FROM podcasts ORDER BY created_at DESC').all();
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    youtubeId: r.youtube_id,
    description: r.description,
    timeAgo: timeAgo(r.created_at)
  }));
}

function collectCommentIds(rootId) {
  const ids = [rootId];
  const children = db.prepare('SELECT id FROM comments WHERE parent_id = ?').all(rootId);
  for (const child of children) {
    ids.push(...collectCommentIds(child.id));
  }
  return ids;
}

function deleteCommentsByIds(ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM comment_votes WHERE comment_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM comment_reports WHERE comment_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM comments WHERE id IN (${placeholders})`).run(...ids);
}

// =====================================================================
// AUTENTICACIÓN
// =====================================================================
app.post('/api/auth/register', authLimiter, (req, res) => {
  if (!checkHoneypot(req, res)) return;
  if (!checkCaptcha(req, res)) return;
  const { email, password, displayName, colonia, bio } = req.body || {};
  const cleanEmail = (email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'correo inválido' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'la contraseña debe tener al menos 8 caracteres' });
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'falta tu nombre' });
  if (displayName.length > 60) return res.status(400).json({ error: 'nombre demasiado largo' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'ese correo ya está registrado' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (email, password_hash, display_name, colonia, bio)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleanEmail, hash, displayName.trim(), (colonia && colonia.trim()) || null, (bio && bio.trim()) || null);

  req.session.userId = info.lastInsertRowid;
  logActivity(`<b>${escapeHtml(displayName.trim())}</b> se registró como vecino`);
  res.status(201).json({ user: publicUser(info.lastInsertRowid) });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = (email || '').toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: 'correo o contraseña incorrectos' });
  }
  req.session.userId = row.id;
  res.json({ user: publicUser(row.id) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.currentUser });
});

// =====================================================================
// PANEL ADMIN
// =====================================================================
app.get('/api/admin/pending-users', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, email, display_name AS displayName, colonia, bio, created_at AS createdAt
    FROM users WHERE status = 'pending' ORDER BY created_at ASC
  `).all();
  res.json({ users: rows.map(r => ({ ...r, timeAgo: timeAgo(r.createdAt) })) });
});

app.post('/api/admin/users/:id/verify', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'no encontrado' });
  db.prepare("UPDATE users SET status = 'verified' WHERE id = ?").run(id);
  logActivity(`<b>${escapeHtml(user.display_name)}</b> fue verificado como vecino`);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reject', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'no encontrado' });
  if (user.role === 'admin') return res.status(400).json({ error: 'no puedes suspender al administrador' });
  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get('/api/admin/verified-users', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, email, display_name AS displayName, colonia, created_at AS createdAt
    FROM users WHERE status = 'verified' AND role != 'admin' ORDER BY display_name ASC
  `).all();
  res.json({ users: rows.map(r => ({ ...r, timeAgo: timeAgo(r.createdAt) })) });
});

app.put('/api/admin/about', requireAdmin, (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'contenido inválido' });
  if (content.length > 20000) return res.status(400).json({ error: 'el texto es demasiado largo' });
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'about_content'").run(content.trim());
  res.json({ ok: true, content: content.trim() });
});

app.put('/api/admin/goals', requireAdmin, (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'contenido inválido' });
  if (content.length > 20000) return res.status(400).json({ error: 'el texto es demasiado largo' });
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'goals_content'").run(content.trim());
  res.json({ ok: true, content: content.trim() });
});

app.put('/api/admin/youtube-channel', requireAdmin, (req, res) => {
  const { url } = req.body || {};
  const clean = (url || '').toString().trim();
  if (clean && !/^https?:\/\//i.test(clean)) return res.status(400).json({ error: 'la liga debe empezar con http:// o https://' });
  if (clean.length > 300) return res.status(400).json({ error: 'liga demasiado larga' });
  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'youtube_channel_url'").run(clean);
  res.json({ ok: true, url: clean });
});

app.post('/api/admin/podcasts', requireAdmin, (req, res) => {
  const { title, youtubeUrl, description } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'falta título' });
  if (title.length > 200) return res.status(400).json({ error: 'título demasiado largo' });
  const youtubeId = extractYoutubeId(youtubeUrl);
  if (!youtubeId) return res.status(400).json({ error: 'no pudimos leer la liga de YouTube — copia la liga completa del video' });

  db.prepare(`
    INSERT INTO podcasts (title, youtube_id, description)
    VALUES (?, ?, ?)
  `).run(title.trim(), youtubeId, (description && description.trim()) || null);

  logActivity(`<b>Administrador</b> publicó un nuevo episodio: ${escapeHtml(title.trim())}`);
  res.status(201).json({ podcasts: serializePodcasts() });
});

app.delete('/api/admin/podcasts/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM podcasts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'no encontrado' });
  db.prepare('DELETE FROM podcasts WHERE id = ?').run(id);
  res.json({ podcasts: serializePodcasts() });
});

app.get('/api/admin/reported-comments', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, COUNT(cr.visitor_id) AS reportCount, c.article_id AS articleId
    FROM comments c
    JOIN comment_reports cr ON cr.comment_id = c.id
    GROUP BY c.id
    ORDER BY reportCount DESC, c.created_at DESC
  `).all();
  res.json({
    comments: rows.map(r => ({
      id: r.id,
      articleId: r.articleId,
      author: r.author,
      text: r.text,
      reportCount: r.reportCount,
      timeAgo: timeAgo(r.created_at)
    }))
  });
});

app.delete('/api/comments/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(id);
  if (!comment) return res.status(404).json({ error: 'no encontrado' });
  deleteCommentsByIds(collectCommentIds(id));
  res.json({ ok: true });
});

app.delete('/api/threads/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const thread = db.prepare('SELECT id FROM threads WHERE id = ?').get(id);
  if (!thread) return res.status(404).json({ error: 'no encontrado' });
  db.prepare('DELETE FROM thread_votes WHERE thread_id = ?').run(id);
  db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.post('/api/admin/poll', requireAdmin, (req, res) => {
  const { question, options } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: 'falta la pregunta' });
  if (question.length > 300) return res.status(400).json({ error: 'pregunta demasiado larga' });
  const cleanOptions = (Array.isArray(options) ? options : [])
    .map(o => (o || '').trim())
    .filter(o => o.length > 0);
  if (cleanOptions.length < 2 || cleanOptions.length > 5) {
    return res.status(400).json({ error: 'la encuesta necesita entre 2 y 5 opciones' });
  }

  db.prepare("UPDATE site_settings SET value = ? WHERE key = 'poll_question'").run(question.trim());
  db.prepare('DELETE FROM poll_votes').run();
  db.prepare('DELETE FROM poll_options').run();
  const insert = db.prepare('INSERT INTO poll_options (key, label, votes, sort_order) VALUES (?, ?, 0, ?)');
  cleanOptions.forEach((label, i) => {
    insert.run(`opt${i + 1}_${Date.now()}`, label, i + 1);
  });

  logActivity('Se publicó una nueva encuesta de la semana');
  res.status(201).json({ poll: serializePoll(), pollQuestion: question.trim() });
});

// =====================================================================
// PORTADA / ARTÍCULOS
// =====================================================================
app.get('/api/home', (req, res) => {
  const visitorId = getVisitorId(req);
  const articleRows = db.prepare('SELECT * FROM articles ORDER BY created_at DESC').all();
  const heroRow = articleRows[0] || null;
  const aboutContent = db.prepare("SELECT value FROM site_settings WHERE key = 'about_content'").get().value;
  const goalsContent = db.prepare("SELECT value FROM site_settings WHERE key = 'goals_content'").get().value;
  const youtubeChannelUrl = db.prepare("SELECT value FROM site_settings WHERE key = 'youtube_channel_url'").get().value;
  const pollQuestion = db.prepare("SELECT value FROM site_settings WHERE key = 'poll_question'").get().value;

  if (visitorId) {
    db.prepare("INSERT OR IGNORE INTO visits (visitor_id, day) VALUES (?, date('now'))").run(visitorId);
  }
  const activeVisitorsToday = db.prepare("SELECT COUNT(DISTINCT visitor_id) AS n FROM visits WHERE day = date('now')").get().n;
  const pendingCount = (req.currentUser && req.currentUser.role === 'admin')
    ? db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").get().n
    : 0;

  res.json({
    me: req.currentUser,
    articles: articleRows.map(serializeArticleSummary),
    heroId: heroRow ? heroRow.id : null,
    hero: heroRow ? serializeArticleFull(heroRow, visitorId) : null,
    comments: heroRow ? serializeCommentsFor(heroRow.id) : [],
    poll: serializePoll(),
    pollQuestion,
    pollVotedOption: visitorId
      ? ((db.prepare('SELECT option_key FROM poll_votes WHERE visitor_id = ?').get(visitorId) || {}).option_key || null)
      : null,
    threads: serializeThreads(),
    voices: serializeVoices(),
    activity: serializeActivity(),
    aboutContent,
    goalsContent,
    youtubeChannelUrl,
    podcasts: serializePodcasts(),
    activeVisitorsToday,
    pendingCount
  });
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ articles: [] });
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT * FROM articles
    WHERE title LIKE ? OR dek LIKE ? OR body LIKE ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(like, like, like);
  res.json({ articles: rows.map(serializeArticleSummary) });
});

app.get('/api/articles/:id', (req, res) => {
  const visitorId = getVisitorId(req);
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'no encontrado' });
  res.json({ article: serializeArticleFull(row, visitorId), comments: serializeCommentsFor(row.id) });
});

app.post('/api/articles', postLimiter, requireVerified, (req, res) => {
  const { title, dek, body, category } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'falta título' });
  if (title.length > 200) return res.status(400).json({ error: 'título demasiado largo' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'falta el cuerpo de la noticia' });
  if (body.length > 8000) return res.status(400).json({ error: 'la noticia es demasiado larga' });

  const cleanCategory = CATEGORIES.includes(category) ? category : 'comunidad';

  const info = db.prepare(`
    INSERT INTO articles (author_id, author_name, author_verified, category, title, dek, body)
    VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(req.currentUser.id, req.currentUser.displayName, cleanCategory, title.trim(), (dek && dek.trim()) || null, body.trim());

  logActivity(`<b>${escapeHtml(req.currentUser.displayName)}</b> publicó una noticia`);
  res.status(201).json({ articleId: info.lastInsertRowid });
});

app.put('/api/articles/:id', (req, res) => {
  if (!req.currentUser) return res.status(401).json({ error: 'inicia sesión' });
  const id = Number(req.params.id);
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!article) return res.status(404).json({ error: 'no encontrado' });
  if (article.author_id !== req.currentUser.id && req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'no puedes editar esta noticia' });
  }

  const { title, dek, body, category } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'falta título' });
  if (title.length > 200) return res.status(400).json({ error: 'título demasiado largo' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'falta el cuerpo de la noticia' });
  if (body.length > 8000) return res.status(400).json({ error: 'la noticia es demasiado larga' });
  const cleanCategory = CATEGORIES.includes(category) ? category : article.category;

  db.prepare(`
    UPDATE articles SET title = ?, dek = ?, body = ?, category = ? WHERE id = ?
  `).run(title.trim(), (dek && dek.trim()) || null, body.trim(), cleanCategory, id);

  res.json({ ok: true });
});

app.delete('/api/articles/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(id);
  if (!article) return res.status(404).json({ error: 'no encontrado' });

  const commentIds = db.prepare('SELECT id FROM comments WHERE article_id = ?').all(id).map(r => r.id);
  deleteCommentsByIds(commentIds);
  db.prepare('DELETE FROM article_upvotes WHERE article_id = ?').run(id);
  db.prepare('DELETE FROM articles WHERE id = ?').run(id);

  res.json({ ok: true });
});

app.post('/api/articles/:id/upvote', (req, res) => {
  const visitorId = getVisitorId(req);
  if (!visitorId) return res.status(400).json({ error: 'falta visitor id' });
  const articleId = Number(req.params.id);
  const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(articleId);
  if (!article) return res.status(404).json({ error: 'no encontrado' });

  const existing = db.prepare('SELECT 1 FROM article_upvotes WHERE article_id = ? AND visitor_id = ?').get(articleId, visitorId);
  if (existing) {
    db.prepare('DELETE FROM article_upvotes WHERE article_id = ? AND visitor_id = ?').run(articleId, visitorId);
    db.prepare('UPDATE articles SET votes = votes - 1 WHERE id = ?').run(articleId);
  } else {
    db.prepare('INSERT INTO article_upvotes (article_id, visitor_id) VALUES (?, ?)').run(articleId, visitorId);
    db.prepare('UPDATE articles SET votes = votes + 1 WHERE id = ?').run(articleId);
  }
  const updated = db.prepare('SELECT votes FROM articles WHERE id = ?').get(articleId);
  res.json({ votes: updated.votes, upvoted: !existing });
});

// =====================================================================
// COMENTARIOS
// =====================================================================
app.post('/api/comments', postLimiter, (req, res) => {
  if (!checkHoneypot(req, res)) return;
  const { articleId, author, colonia, text, parentId } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'el comentario está vacío' });
  if (text.length > 2000) return res.status(400).json({ error: 'comentario demasiado largo' });

  const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(Number(articleId));
  if (!article) return res.status(400).json({ error: 'artículo inválido' });

  let cleanAuthor, cleanColonia, badge;
  if (req.currentUser) {
    cleanAuthor = req.currentUser.displayName;
    cleanColonia = req.currentUser.colonia;
    badge = req.currentUser.role === 'admin'
      ? 'Administrador'
      : (req.currentUser.status === 'verified' ? 'Vecino verificado' : null);
  } else {
    cleanAuthor = (author && author.trim()) || 'Vecino anónimo';
    cleanColonia = (colonia && colonia.trim()) || null;
    badge = null;
  }

  let cleanParentId = null;
  if (parentId) {
    const parent = db.prepare('SELECT id FROM comments WHERE id = ? AND article_id = ?').get(parentId, article.id);
    if (parent) cleanParentId = parent.id;
  }

  db.prepare(`
    INSERT INTO comments (article_id, parent_id, author, colonia, badge, text)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(article.id, cleanParentId, cleanAuthor, cleanColonia, badge, text.trim());

  logActivity(`<b>${escapeHtml(cleanAuthor)}</b> ${cleanParentId ? 'respondió' : 'comentó'} en una noticia`);

  res.status(201).json({
    comments: serializeCommentsFor(article.id),
    activity: serializeActivity(),
    voices: serializeVoices()
  });
});

app.post('/api/comments/:id/vote', (req, res) => {
  const visitorId = getVisitorId(req);
  if (!visitorId) return res.status(400).json({ error: 'falta visitor id' });
  const commentId = Number(req.params.id);
  const dir = req.body && req.body.dir === -1 ? -1 : 1;

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!comment) return res.status(404).json({ error: 'no encontrado' });

  const existing = db.prepare('SELECT * FROM comment_votes WHERE comment_id = ? AND visitor_id = ?').get(commentId, visitorId);
  let delta = 0;
  if (!existing) {
    db.prepare('INSERT INTO comment_votes (comment_id, visitor_id, dir) VALUES (?, ?, ?)').run(commentId, visitorId, dir);
    delta = dir;
  } else if (existing.dir === dir) {
    db.prepare('DELETE FROM comment_votes WHERE comment_id = ? AND visitor_id = ?').run(commentId, visitorId);
    delta = -dir;
  } else {
    db.prepare('UPDATE comment_votes SET dir = ? WHERE comment_id = ? AND visitor_id = ?').run(dir, commentId, visitorId);
    delta = dir * 2;
  }
  db.prepare('UPDATE comments SET votes = votes + ? WHERE id = ?').run(delta, commentId);
  const updated = db.prepare('SELECT votes FROM comments WHERE id = ?').get(commentId);
  res.json({ votes: updated.votes });
});

app.post('/api/comments/:id/report', (req, res) => {
  const visitorId = getVisitorId(req);
  if (!visitorId) return res.status(400).json({ error: 'falta visitor id' });
  const commentId = Number(req.params.id);
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(commentId);
  if (!comment) return res.status(404).json({ error: 'no encontrado' });

  db.prepare('INSERT OR IGNORE INTO comment_reports (comment_id, visitor_id) VALUES (?, ?)').run(commentId, visitorId);
  const count = db.prepare('SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id = ?').get(commentId).n;
  res.json({ reportCount: count });
});

// =====================================================================
// ENCUESTA
// =====================================================================
app.post('/api/poll/vote', (req, res) => {
  const visitorId = getVisitorId(req);
  if (!visitorId) return res.status(400).json({ error: 'falta visitor id' });
  const { optionKey } = req.body || {};
  const option = db.prepare('SELECT * FROM poll_options WHERE key = ?').get(optionKey);
  if (!option) return res.status(400).json({ error: 'opción inválida' });

  const existing = db.prepare('SELECT * FROM poll_votes WHERE visitor_id = ?').get(visitorId);
  if (existing) {
    return res.status(409).json({ error: 'ya votaste', poll: serializePoll(), pollVotedOption: existing.option_key });
  }
  db.prepare('INSERT INTO poll_votes (visitor_id, option_key) VALUES (?, ?)').run(visitorId, optionKey);
  db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE key = ?').run(optionKey);

  res.json({ poll: serializePoll(), pollVotedOption: optionKey });
});

// =====================================================================
// FORO ABIERTO
// =====================================================================
app.post('/api/threads', postLimiter, (req, res) => {
  if (!checkHoneypot(req, res)) return;
  const { title, category, author, body } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'falta título' });
  if (title.length > 200) return res.status(400).json({ error: 'título demasiado largo' });

  const cleanCategory = category && category.trim() ? category.trim() : 'Comunidad';
  const cleanAuthor = req.currentUser ? req.currentUser.displayName : ((author && author.trim()) || 'Vecino anónimo');

  db.prepare(`
    INSERT INTO threads (title, category, author, body)
    VALUES (?, ?, ?, ?)
  `).run(title.trim(), cleanCategory, cleanAuthor, (body && body.trim()) || null);

  logActivity(`<b>${escapeHtml(cleanAuthor)}</b> abrió un tema en el Foro`);
  res.status(201).json({ threads: serializeThreads(), activity: serializeActivity() });
});

app.post('/api/threads/:id/vote', (req, res) => {
  const visitorId = getVisitorId(req);
  if (!visitorId) return res.status(400).json({ error: 'falta visitor id' });
  const threadId = Number(req.params.id);

  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
  if (!thread) return res.status(404).json({ error: 'no encontrado' });

  const existing = db.prepare('SELECT 1 FROM thread_votes WHERE thread_id = ? AND visitor_id = ?').get(threadId, visitorId);
  let delta = 0;
  if (existing) {
    db.prepare('DELETE FROM thread_votes WHERE thread_id = ? AND visitor_id = ?').run(threadId, visitorId);
    delta = -1;
  } else {
    db.prepare('INSERT INTO thread_votes (thread_id, visitor_id) VALUES (?, ?)').run(threadId, visitorId);
    delta = 1;
  }
  db.prepare('UPDATE threads SET votes = votes + ? WHERE id = ?').run(delta, threadId);
  const updated = db.prepare('SELECT votes FROM threads WHERE id = ?').get(threadId);
  res.json({ votes: updated.votes });
});

app.listen(PORT, () => {
  console.log(`Agua Prieta con Sentido corriendo en http://localhost:${PORT}`);
});
