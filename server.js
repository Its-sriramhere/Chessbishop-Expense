require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { getDatabase, queryAll, queryOne, run, saveDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser(JWT_SECRET));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only images and PDFs allowed'));
  }
});

function authMiddleware(req, res, next) {
  const token = req.signedCookies.token || req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = queryOne('SELECT id, username, role, status, email, phone, profile_image FROM users WHERE id = ?', [decoded.userId]);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function generateToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is inactive' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, signed: true, maxAge: 86400000, sameSite: 'lax' });
  res.json({ user: { id: user.id, username: user.username, role: user.role, email: user.email, phone: user.phone, profile_image: user.profile_image } });
});

app.post('/api/auth/register', upload.single('profile_image'), (req, res) => {
  const { username, password, role, email, phone } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const validRoles = ['COO', 'Assistant Coach', 'Head Coach', 'Intern'];
  const userRole = validRoles.includes(role) ? role : 'Intern';
  const profileImage = req.file ? '/uploads/' + req.file.filename : null;

  const hash = bcrypt.hashSync(password, 10);
  const result = run('INSERT INTO users (username, password_hash, email, phone, role, profile_image) VALUES (?, ?, ?, ?, ?, ?)', [
    username, hash, email || null, phone || null, userRole, profileImage
  ]);

  const user = queryOne('SELECT id, username, role, email, phone, profile_image FROM users WHERE id = ?', [result.lastInsertRowid]);
  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, signed: true, maxAge: 86400000, sameSite: 'lax' });
  res.status(201).json({ user: { id: user.id, username: user.username, role: user.role, profile_image: user.profile_image } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

app.get('/api/categories', authMiddleware, (req, res) => {
  const categories = queryAll('SELECT * FROM categories ORDER BY is_default DESC, name');
  res.json(categories);
});

app.post('/api/admin/categories', authMiddleware, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });

  const existing = queryOne('SELECT id FROM categories WHERE name = ?', [name]);
  if (existing) return res.status(409).json({ error: 'Category already exists' });

  const result = run('INSERT INTO categories (name, is_default) VALUES (?, 0)', [name]);
  res.status(201).json({ id: result.lastInsertRowid, name, is_default: 0 });
});

app.get('/api/expenses', authMiddleware, (req, res) => {
  const { status, category_id, start_date, end_date } = req.query;
  let sql = `
    SELECT e.id, e.user_id, e.category_id, e.amount, e.description, e.status, e.receipt_path, e.created_at, e.updated_at, c.name as category_name, u.username
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    JOIN users u ON e.user_id = u.id
    WHERE e.user_id = ?
  `;
  const params = [req.user.id];

  if (status) { sql += ' AND e.status = ?'; params.push(status); }
  if (category_id) { sql += ' AND e.category_id = ?'; params.push(parseInt(category_id)); }
  if (start_date) { sql += ' AND e.created_at >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND e.created_at <= ?'; params.push(end_date); }

  sql += ' ORDER BY e.created_at DESC';
  const expenses = queryAll(sql, params);
  res.json(expenses);
});

app.post('/api/expenses', authMiddleware, (req, res) => {
  upload.single('receipt')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { amount, description, category_id } = req.body;
    if (!amount || !description || !category_id) {
      return res.status(400).json({ error: 'Amount, description, and category are required' });
    }

    if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'Amount must be positive' });

    const category = queryOne('SELECT id FROM categories WHERE id = ?', [parseInt(category_id)]);
    if (!category) return res.status(400).json({ error: 'Invalid category' });

    const receiptPath = req.file ? `/uploads/${req.file.filename}` : null;

    const result = run(
      'INSERT INTO expenses (user_id, category_id, amount, description, receipt_path) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, parseInt(category_id), parseFloat(amount), description, receiptPath]
    );

    const expense = queryOne(`
      SELECT e.id, e.user_id, e.category_id, e.amount, e.description, e.status, e.receipt_path, e.created_at, e.updated_at, c.name as category_name
      FROM expenses e JOIN categories c ON e.category_id = c.id
      WHERE e.id = ?
    `, [result.lastInsertRowid]);

    res.status(201).json(expense);
  });
});

app.put('/api/expenses/:id', authMiddleware, (req, res) => {
  const { amount, description, category_id } = req.body;
  if (!amount && !description && !category_id) {
    return res.status(400).json({ error: 'At least one field to update is required' });
  }

  const expense = queryOne('SELECT * FROM expenses WHERE id = ?', [parseInt(req.params.id)]);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });

  const isAdmin = req.user.role === 'admin';
  if (expense.user_id !== req.user.id && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  if (!isAdmin && expense.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending expenses can be edited' });
  }

  const updates = [];
  const params = [];
  if (amount) { updates.push('amount = ?'); params.push(parseFloat(amount)); }
  if (description) { updates.push('description = ?'); params.push(description); }
  if (category_id) {
    const cat = queryOne('SELECT id FROM categories WHERE id = ?', [parseInt(category_id)]);
    if (!cat) return res.status(400).json({ error: 'Invalid category' });
    updates.push('category_id = ?');
    params.push(parseInt(category_id));
  }
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(parseInt(req.params.id));

  run(`UPDATE expenses SET ${updates.join(', ')} WHERE id = ?`, params);

  const updated = queryOne(`
    SELECT e.id, e.user_id, e.category_id, e.amount, e.description, e.status, e.receipt_path, e.created_at, e.updated_at, c.name as category_name, u.username
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    JOIN users u ON e.user_id = u.id
    WHERE e.id = ?
  `, [parseInt(req.params.id)]);

  res.json(updated);
});

app.delete('/api/expenses/:id', authMiddleware, (req, res) => {
  const expense = queryOne('SELECT * FROM expenses WHERE id = ?', [parseInt(req.params.id)]);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });

  const isAdmin = req.user.role === 'admin';
  if (expense.user_id !== req.user.id && !isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  run('DELETE FROM expenses WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ message: 'Expense deleted' });
});

app.get('/api/admin/expenses', authMiddleware, adminOnly, (req, res) => {
  const { status, category_id, user_id, start_date, end_date } = req.query;
  let sql = `
    SELECT e.id, e.user_id, e.category_id, e.amount, e.description, e.status, e.receipt_path, e.created_at, e.updated_at, c.name as category_name, u.username
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    JOIN users u ON e.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (status) { sql += ' AND e.status = ?'; params.push(status); }
  if (category_id) { sql += ' AND e.category_id = ?'; params.push(parseInt(category_id)); }
  if (user_id) { sql += ' AND e.user_id = ?'; params.push(parseInt(user_id)); }
  if (start_date) { sql += ' AND e.created_at >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND e.created_at <= ?'; params.push(end_date); }

  sql += ' ORDER BY e.created_at DESC';
  const expenses = queryAll(sql, params);
  res.json(expenses);
});

app.put('/api/admin/expenses/:id', authMiddleware, adminOnly, (req, res) => {
  const { status } = req.body;
  if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved, rejected, or pending' });
  }

  const expense = queryOne('SELECT * FROM expenses WHERE id = ?', [parseInt(req.params.id)]);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });

  run('UPDATE expenses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, parseInt(req.params.id)]);

  const updated = queryOne(`
    SELECT e.id, e.user_id, e.category_id, e.amount, e.description, e.status, e.receipt_path, e.created_at, e.updated_at, c.name as category_name, u.username
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    JOIN users u ON e.user_id = u.id
    WHERE e.id = ?
  `, [parseInt(req.params.id)]);

  res.json(updated);
});

app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const totalRow = queryOne('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses');
  const pendingRow = queryOne("SELECT COUNT(*) as count FROM expenses WHERE status = 'pending'");
  const approvedRow = queryOne("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses WHERE status = 'approved'");
  const rejectedRow = queryOne("SELECT COUNT(*) as count FROM expenses WHERE status = 'rejected'");

  const byCategory = queryAll(`
    SELECT c.name, COUNT(e.id) as count, COALESCE(SUM(e.amount), 0) as total
    FROM categories c LEFT JOIN expenses e ON c.id = e.category_id
    GROUP BY c.id ORDER BY total DESC
  `);

  const byEmployee = queryAll(`
    SELECT u.username, COUNT(e.id) as count, COALESCE(SUM(e.amount), 0) as total
    FROM users u LEFT JOIN expenses e ON u.id = e.user_id
    WHERE u.role != 'admin'
    GROUP BY u.id ORDER BY total DESC
  `);

  res.json({
    total: totalRow || { count: 0, total: 0 },
    pending: pendingRow || { count: 0 },
    approved: approvedRow || { count: 0, total: 0 },
    rejected: rejectedRow || { count: 0 },
    byCategory,
    byEmployee
  });
});

app.get('/api/my-stats', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const totalRow = queryOne('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = ?', [userId]);
  const pendingRow = queryOne("SELECT COUNT(*) as count FROM expenses WHERE user_id = ? AND status = 'pending'", [userId]);
  const approvedRow = queryOne("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = ? AND status = 'approved'", [userId]);
  const rejectedRow = queryOne("SELECT COUNT(*) as count FROM expenses WHERE user_id = ? AND status = 'rejected'", [userId]);
  res.json({
    total: totalRow || { count: 0, total: 0 },
    pending: pendingRow || { count: 0 },
    approved: approvedRow || { count: 0, total: 0 },
    rejected: rejectedRow || { count: 0 }
  });
});

app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  const users = queryAll('SELECT id, username, role, status, email, phone, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

app.get('/api/admin/employees-summary', authMiddleware, adminOnly, (req, res) => {
  const employees = queryAll(`
    SELECT u.id, u.username, u.role, u.email, u.phone,
      COUNT(e.id) as expense_count,
      COALESCE(SUM(e.amount), 0) as total_amount,
      SUM(CASE WHEN e.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN e.status = 'approved' THEN 1 ELSE 0 END) as approved_count,
      SUM(CASE WHEN e.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
    FROM users u
    LEFT JOIN expenses e ON e.user_id = u.id
    WHERE u.role != 'admin'
    GROUP BY u.id
    ORDER BY u.role, u.username
  `);
  res.json(employees);
});

async function start() {
  await getDatabase();
  app.listen(PORT, () => {
    console.log(`Expense Tracker running on http://localhost:${PORT}`);
    console.log('Default accounts: admin/admin123, employee/emp123');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
