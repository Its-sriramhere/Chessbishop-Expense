require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const mongo = require('../mongo');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const MONGODB_URI = process.env.MONGODB_URI;

let dbReady = null;
function ensureDb() {
  if (!dbReady) dbReady = mongo.connectMongo(MONGODB_URI);
  return dbReady;
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser(JWT_SECRET));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Only images and PDFs allowed'));
  }
});

async function authMiddleware(req, res, next) {
  await ensureDb();
  const token = req.signedCookies.token || req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await mongo.findUserById(decoded.userId);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid session' });
    req.user = { id: user._id.toString(), idNum: user._id, username: user.username, role: user.role, status: user.status, email: user.email, phone: user.phone, profile_image: user.profile_image };
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
  return jwt.sign({ userId: user._id.toString(), role: user.role }, JWT_SECRET, { expiresIn: '24h' });
}

function formatExpense(e) {
  return {
    id: e._id ? e._id.toString() : e.id,
    user_id: e.user_id,
    category_id: e.category_id,
    category_name: e.category_name || '',
    username: e.username || '',
    amount: e.amount,
    description: e.description,
    status: e.status,
    receipt_path: e.receipt_id ? `/api/receipts/${e.receipt_id}` : (e.receipt_path || null),
    receipt_id: e.receipt_id ? e.receipt_id.toString() : null,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

// ---- Auth ----

app.post('/api/auth/login', async (req, res) => {
  await ensureDb();
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await mongo.findUser({ username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is inactive' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, signed: true, maxAge: 86400000, sameSite: 'lax' });
  res.json({ user: { id: user._id.toString(), username: user.username, role: user.role, email: user.email, phone: user.phone, profile_image: user.profile_image, status: user.status } });
});

app.post('/api/auth/register', upload.single('profile_image'), async (req, res) => {
  await ensureDb();
  const { username, password, role, email, phone } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const existing = await mongo.findUser({ username });
  if (existing) return res.status(409).json({ error: 'Username already exists' });
  const validRoles = ['COO', 'Assistant Coach', 'Head Coach', 'Intern'];
  const userRole = validRoles.includes(role) ? role : 'Intern';
  const profileImage = req.file ? req.file.originalname : null;
  const hash = bcrypt.hashSync(password, 10);
  const user = await mongo.createUser({ username, password_hash: hash, email, phone, role: userRole, profile_image: profileImage });
  const token = generateToken(user);
  res.cookie('token', token, { httpOnly: true, signed: true, maxAge: 86400000, sameSite: 'lax' });
  res.status(201).json({ user: { id: user._id.toString(), username: user.username, role: user.role, profile_image: user.profile_image, status: 'active' } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = await mongo.findUser({ _id: req.user.idNum });
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await mongo.updateUserPassword(req.user.id, hash);
  res.json({ message: 'Password updated successfully' });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// ---- Categories ----

app.get('/api/categories', authMiddleware, async (req, res) => {
  const categories = await mongo.findCategories();
  res.json(categories.map(c => ({ id: c._id.toString(), name: c.name, is_default: c.is_default })));
});

app.post('/api/admin/categories', authMiddleware, adminOnly, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name required' });
  const existing = await mongo.findCategory({ name });
  if (existing) return res.status(409).json({ error: 'Category already exists' });
  const cat = await mongo.createCategory(name);
  res.status(201).json({ id: cat._id.toString(), name: cat.name, is_default: false });
});

// ---- Expenses ----

app.get('/api/expenses', authMiddleware, async (req, res) => {
  try {
    const { status, category_id, start_date, end_date } = req.query;
    const filter = { user_id: parseInt(req.user.id) || req.user.id };
    if (status) filter.status = status;
    if (category_id) filter.category_id = parseInt(category_id);
    if (start_date || end_date) {
      filter.created_at = {};
      if (start_date) filter.created_at.$gte = new Date(start_date);
      if (end_date) filter.created_at.$lte = new Date(end_date + 'T23:59:59.999Z');
    }
    const expenses = await mongo.findExpenses(filter);
    res.json(expenses.map(formatExpense));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

app.post('/api/expenses', authMiddleware, (req, res) => {
  upload.single('receipt')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const { amount, description, category_id } = req.body;
    if (!amount || !description || !category_id) return res.status(400).json({ error: 'Amount, description, and category are required' });
    if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'Amount must be positive' });
    const catId = parseInt(category_id);
    const category = await mongo.findCategory({ _id: mongo.toObjectId(category_id) });
    if (!category) {
      const catById = await mongo.findCategory({ _id: mongo.toObjectId(category_id) });
      if (!catById) return res.status(400).json({ error: 'Invalid category' });
    }
    try {
      let receiptId = null;
      let receiptFilename = null;
      if (req.file) {
        receiptFilename = req.file.originalname;
        const uploaded = await mongo.uploadReceipt(receiptFilename, req.file.buffer, req.file.mimetype);
        receiptId = uploaded.id;
      }
      const expense = await mongo.insertExpense({
        user_id: parseInt(req.user.id) || req.user.id,
        category_id: catId,
        category_name: category ? category.name : '',
        username: req.user.username,
        amount, description,
        receipt_filename: receiptFilename,
        receipt_id: receiptId,
      });
      res.status(201).json(formatExpense(expense));
    } catch (e) {
      res.status(500).json({ error: 'Failed to create expense' });
    }
  });
});

app.put('/api/expenses/:id', authMiddleware, async (req, res) => {
  try {
    const { amount, description, category_id } = req.body;
    if (!amount && !description && !category_id) return res.status(400).json({ error: 'At least one field to update is required' });
    const expense = await mongo.findOneExpense({ _id: mongo.toObjectId(req.params.id) });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const isAdmin = req.user.role === 'admin';
    if (expense.user_id !== (parseInt(req.user.id) || req.user.id) && !isAdmin) return res.status(403).json({ error: 'Not authorized' });
    if (!isAdmin && expense.status !== 'pending') return res.status(400).json({ error: 'Only pending expenses can be edited' });
    const updates = {};
    if (amount) updates.amount = parseFloat(amount);
    if (description) updates.description = description;
    if (category_id) {
      const cat = await mongo.findCategory({ _id: mongo.toObjectId(category_id) });
      if (!cat) return res.status(400).json({ error: 'Invalid category' });
      updates.category_id = parseInt(category_id);
      updates.category_name = cat.name;
    }
    const updated = await mongo.updateExpense(req.params.id, updates);
    res.json(formatExpense(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
  try {
    const expense = await mongo.findOneExpense({ _id: mongo.toObjectId(req.params.id) });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const isAdmin = req.user.role === 'admin';
    if (expense.user_id !== (parseInt(req.user.id) || req.user.id) && !isAdmin) return res.status(403).json({ error: 'Not authorized' });
    if (expense.receipt_id) await mongo.deleteReceipt(expense.receipt_id);
    await mongo.deleteExpense(req.params.id);
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

// ---- Admin Expenses ----

app.get('/api/admin/expenses', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status, category_id, user_id, start_date, end_date } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category_id) filter.category_id = parseInt(category_id);
    if (user_id) filter.user_id = parseInt(user_id);
    if (start_date || end_date) {
      filter.created_at = {};
      if (start_date) filter.created_at.$gte = new Date(start_date);
      if (end_date) filter.created_at.$lte = new Date(end_date + 'T23:59:59.999Z');
    }
    const expenses = await mongo.findExpenses(filter);
    res.json(expenses.map(formatExpense));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

app.put('/api/admin/expenses/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Status must be approved, rejected, or pending' });
    const expense = await mongo.findOneExpense({ _id: mongo.toObjectId(req.params.id) });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    const updated = await mongo.updateExpense(req.params.id, { status });
    res.json(formatExpense(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense status' });
  }
});

// ---- Receipts from GridFS ----

app.get('/api/receipts/:fileId', authMiddleware, async (req, res) => {
  try {
    const stream = await mongo.downloadReceipt(req.params.fileId);
    if (!stream) return res.status(404).json({ error: 'Receipt not found' });
    const db = mongo.getDb();
    const file = await db.collection('receipts.files').findOne({ _id: mongo.toObjectId(req.params.fileId) });
    if (file) {
      res.set('Content-Type', file.contentType || 'application/octet-stream');
      res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    }
    stream.pipe(res);
  } catch (err) {
    res.status(404).json({ error: 'Receipt not found' });
  }
});

// ---- Stats ----

app.get('/api/admin/stats', authMiddleware, adminOnly, async (req, res) => {
  try { res.json(await mongo.getAdminStats()); } catch { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

app.get('/api/my-stats', authMiddleware, async (req, res) => {
  try { res.json(await mongo.getMyStats(parseInt(req.user.id) || req.user.id)); } catch { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

// ---- Users ----

app.get('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  const users = await mongo.findAllUsers();
  res.json(users.map(u => ({ id: u._id.toString(), username: u.username, role: u.role, status: u.status, email: u.email, phone: u.phone, created_at: u.created_at })));
});

app.get('/api/admin/employees-summary', authMiddleware, adminOnly, async (req, res) => {
  try {
    const employees = await mongo.findEmployees();
    const mongoSummary = await mongo.getEmployeesSummary();
    const summaryMap = {};
    mongoSummary.forEach(s => { summaryMap[s.id.toString()] = s; });
    res.json(employees.map(u => {
      const stats = summaryMap[u._id.toString()] || { expense_count: 0, total_amount: 0, pending_count: 0, approved_count: 0, rejected_count: 0 };
      return { id: u._id.toString(), username: u.username, role: u.role, email: u.email, phone: u.phone, ...stats };
    }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch employee summary' });
  }
});

module.exports = app;
