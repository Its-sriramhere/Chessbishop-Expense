const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'expense_tracker.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

async function getDatabase() {
  if (db) return db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  initializeSchema();
  await seedData();
  saveDatabase();

  return db;
}

function initializeSchema() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
}

async function seedData() {
  const catCount = db.exec('SELECT COUNT(*) as count FROM categories');
  const categoryCount = catCount.length > 0 ? catCount[0].values[0][0] : 0;

  if (categoryCount === 0) {
    const defaultCategories = ['Travel', 'Meals', 'Office Supplies', 'Software', 'Other'];
    const stmt = db.prepare('INSERT INTO categories (name, is_default) VALUES (?, 1)');
    for (const cat of defaultCategories) {
      stmt.run([cat]);
    }
    stmt.free();
  }

  const userCountResult = db.exec('SELECT COUNT(*) as count FROM users');
  const userCount = userCountResult.length > 0 ? userCountResult[0].values[0][0] : 0;

  if (userCount === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const empHash = bcrypt.hashSync('emp123', 10);
    const stmt = db.prepare('INSERT INTO users (username, password_hash, email, phone, role, profile_image) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(['admin', adminHash, 'admin@expense.com', '9000000000', 'admin', null]);
    stmt.run(['employee', empHash, 'employee@expense.com', '9000000001', 'Intern', null]);
    stmt.free();
  }
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec('SELECT last_insert_rowid() as id');
  const changes = db.getRowsModified();
  saveDatabase();
  return { lastInsertRowid: lastId.length > 0 ? lastId[0].values[0][0] : null, changes };
}

module.exports = { getDatabase, queryAll, queryOne, run, saveDatabase };
