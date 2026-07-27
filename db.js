const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    colonia TEXT,
    bio TEXT,
    role TEXT NOT NULL DEFAULT 'vecino',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER REFERENCES users(id),
    author_name TEXT NOT NULL,
    author_verified INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    dek TEXT,
    body TEXT,
    votes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS article_upvotes (
    article_id INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    PRIMARY KEY (article_id, visitor_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL DEFAULT 1,
    parent_id INTEGER REFERENCES comments(id),
    author TEXT NOT NULL,
    colonia TEXT,
    badge TEXT,
    text TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comment_votes (
    comment_id INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    dir INTEGER NOT NULL,
    PRIMARY KEY (comment_id, visitor_id)
  );

  CREATE TABLE IF NOT EXISTS poll_options (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS poll_votes (
    visitor_id TEXT PRIMARY KEY,
    option_key TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT,
    votes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS thread_votes (
    thread_id INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    PRIMARY KEY (thread_id, visitor_id)
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comment_reports (
    comment_id INTEGER NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (comment_id, visitor_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visits (
    visitor_id TEXT NOT NULL,
    day TEXT NOT NULL,
    PRIMARY KEY (visitor_id, day)
  );

  CREATE TABLE IF NOT EXISTS podcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- Seed: contenido de "Quiénes somos" ----------
const aboutSeed = db.prepare("SELECT 1 FROM site_settings WHERE key = 'about_content'").get();
if (!aboutSeed) {
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('about_content', '')").run();
}

// ---------- Seed: contenido de "Qué queremos" ----------
const goalsSeed = db.prepare("SELECT 1 FROM site_settings WHERE key = 'goals_content'").get();
if (!goalsSeed) {
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('goals_content', '')").run();
}

// ---------- Seed: canal de YouTube ----------
const youtubeSeed = db.prepare("SELECT 1 FROM site_settings WHERE key = 'youtube_channel_url'").get();
if (!youtubeSeed) {
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('youtube_channel_url', '')").run();
}

// ---------- Seed: pregunta de la encuesta ----------
const pollQuestionSeed = db.prepare("SELECT 1 FROM site_settings WHERE key = 'poll_question'").get();
if (!pollQuestionSeed) {
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('poll_question', ?)")
    .run('¿En qué debería invertir primero el ayuntamiento en 2026?');
}

// ---------- Seed: secreto de sesión ----------
const sessionSecretSeed = db.prepare("SELECT 1 FROM site_settings WHERE key = 'session_secret'").get();
if (!sessionSecretSeed) {
  db.prepare("INSERT INTO site_settings (key, value) VALUES ('session_secret', ?)")
    .run(require('crypto').randomBytes(32).toString('hex'));
}

// ---------- Seed: cuenta admin (solo si no existe ninguna todavía) ----------
const hasAnyAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
if (!hasAnyAdmin) {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.prepare(`
      INSERT INTO users (email, password_hash, display_name, role, status)
      VALUES (?, ?, 'Administrador', 'admin', 'verified')
    `).run(ADMIN_EMAIL.toLowerCase().trim(), hash);
    console.log(`Cuenta admin creada para ${ADMIN_EMAIL}`);
  } else {
    console.warn('AVISO: no hay ninguna cuenta admin y faltan las variables de entorno ADMIN_EMAIL / ADMIN_PASSWORD para crear una.');
  }
}

module.exports = db;
