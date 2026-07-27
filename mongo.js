const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const bcrypt = require('bcryptjs');

const DB_NAME = 'Chessbishop-expense';
let cachedClient = null;
let cachedDb = null;

async function connectMongo(uri) {
  if (cachedDb) return cachedDb;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 10000,
  });
  await client.connect();
  cachedClient = client;
  cachedDb = client.db(DB_NAME);

  await cachedDb.collection('users').createIndex({ username: 1 }, { unique: true });
  await cachedDb.collection('expenses').createIndex({ user_id: 1, created_at: -1 });
  await cachedDb.collection('expenses').createIndex({ status: 1 });
  await cachedDb.collection('expenses').createIndex({ category_id: 1 });
  await cachedDb.collection('expenses').createIndex({ user_id: 1, status: 1 });

  await seedData(cachedDb);
  return cachedDb;
}

function getDb() { return cachedDb; }
function toObjectId(id) {
  try { return new ObjectId(id); } catch { return null; }
}

// ---- Seed ----

async function seedData(db) {
  const catCount = await db.collection('categories').countDocuments();
  if (catCount === 0) {
    const defaults = ['Travel', 'Meals', 'Office Supplies', 'Software', 'Other'];
    await db.collection('categories').insertMany(defaults.map(name => ({ name, is_default: true })));
  }

  const userCount = await db.collection('users').countDocuments();
  if (userCount === 0) {
    const hash = bcrypt.hashSync('Master@247', 10);
    await db.collection('users').insertOne({
      username: 'suryakumarceo@chessbishop',
      password_hash: hash,
      email: 'suryakumarceo@chessbishop.com',
      phone: '9000000000',
      role: 'admin',
      status: 'active',
      profile_image: null,
      created_at: new Date(),
    });
  }
}

// ---- Users ----

async function findUser(filter) {
  return cachedDb.collection('users').findOne(filter);
}

async function findUserById(id) {
  const oid = toObjectId(id);
  if (!oid) return null;
  return cachedDb.collection('users').findOne({ _id: oid }, { projection: { password_hash: 0 } });
}

async function findAllUsers() {
  return cachedDb.collection('users').find({}, { projection: { password_hash: 0 } }).sort({ created_at: -1 }).toArray();
}

async function findEmployees() {
  return cachedDb.collection('users').find(
    { role: { $ne: 'admin' } },
    { projection: { password_hash: 0 } }
  ).sort({ role: 1, username: 1 }).toArray();
}

async function createUser(doc) {
  const user = {
    username: doc.username,
    password_hash: doc.password_hash,
    email: doc.email || null,
    phone: doc.phone || null,
    role: doc.role || 'Intern',
    status: 'active',
    profile_image: doc.profile_image || null,
    created_at: new Date(),
  };
  const result = await cachedDb.collection('users').insertOne(user);
  user._id = result.insertedId;
  return user;
}

async function updateUserPassword(id, hash) {
  const oid = toObjectId(id);
  if (!oid) return null;
  return cachedDb.collection('users').updateOne({ _id: oid }, { $set: { password_hash: hash } });
}

// ---- Categories ----

async function findCategories() {
  return cachedDb.collection('categories').find().sort({ is_default: -1, name: 1 }).toArray();
}

async function findCategory(filter) {
  return cachedDb.collection('categories').findOne(filter);
}

async function createCategory(name) {
  const cat = { name, is_default: false };
  const result = await cachedDb.collection('categories').insertOne(cat);
  cat._id = result.insertedId;
  return cat;
}

// ---- Expenses ----

async function findExpenses(filter = {}, sort = { created_at: -1 }) {
  return cachedDb.collection('expenses').find(filter).sort(sort).toArray();
}

async function findOneExpense(filter) {
  return cachedDb.collection('expenses').findOne(filter);
}

async function insertExpense(doc) {
  const now = new Date();
  const expense = {
    user_id: doc.user_id,
    category_id: doc.category_id,
    category_name: doc.category_name || '',
    username: doc.username || '',
    amount: parseFloat(doc.amount),
    description: doc.description,
    status: 'pending',
    receipt_filename: doc.receipt_filename || null,
    receipt_id: doc.receipt_id || null,
    created_at: now,
    updated_at: now,
  };
  const result = await cachedDb.collection('expenses').insertOne(expense);
  expense._id = result.insertedId;
  return expense;
}

async function updateExpense(id, updates) {
  const oid = toObjectId(id);
  if (!oid) return null;
  updates.updated_at = new Date();
  return cachedDb.collection('expenses').findOneAndUpdate(
    { _id: oid },
    { $set: updates },
    { returnDocument: 'after' }
  );
}

async function deleteExpense(id) {
  const oid = toObjectId(id);
  if (!oid) return null;
  return cachedDb.collection('expenses').deleteOne({ _id: oid });
}

// ---- GridFS Receipts ----

let receiptsBucket = null;
function getReceiptsBucket() {
  if (!receiptsBucket) receiptsBucket = new GridFSBucket(cachedDb, { bucketName: 'receipts' });
  return receiptsBucket;
}

async function uploadReceipt(filename, buffer, contentType) {
  const bucket = getReceiptsBucket();
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { contentType });
    uploadStream.on('finish', () => resolve({ id: uploadStream.id, filename }));
    uploadStream.on('error', reject);
    uploadStream.end(buffer);
  });
}

async function downloadReceipt(fileId) {
  const oid = toObjectId(fileId);
  if (!oid) return null;
  try {
    return getReceiptsBucket().openDownloadStream(oid);
  } catch { return null; }
}

async function deleteReceipt(fileId) {
  const oid = toObjectId(fileId);
  if (!oid) return;
  try { await getReceiptsBucket().delete(oid); } catch {}
}

// ---- Aggregation ----

async function getAdminStats() {
  const result = await cachedDb.collection('expenses').aggregate([
    { $facet: {
      total: [{ $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }],
      pending: [{ $match: { status: 'pending' } }, { $group: { _id: null, count: { $sum: 1 } } }],
      approved: [{ $match: { status: 'approved' } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }],
      rejected: [{ $match: { status: 'rejected' } }, { $group: { _id: null, count: { $sum: 1 } } }],
      byCategory: [
        { $group: { _id: '$category_name', count: { $sum: 1 }, total: { $sum: '$amount' } } },
        { $sort: { total: -1 } }
      ],
      byEmployee: [
        { $group: { _id: '$username', count: { $sum: 1 }, total: { $sum: '$amount' } } },
        { $sort: { total: -1 } }
      ],
    }}
  ]).toArray();

  const r = result[0];
  return {
    total: r.total[0] || { count: 0, total: 0 },
    pending: r.pending[0] || { count: 0 },
    approved: r.approved[0] || { count: 0, total: 0 },
    rejected: r.rejected[0] || { count: 0 },
    byCategory: r.byCategory.map(c => ({ name: c._id, count: c.count, total: c.total })),
    byEmployee: r.byEmployee.map(e => ({ username: e._id, count: e.count, total: e.total })),
  };
}

async function getMyStats(userId) {
  const uid = typeof userId === 'number' ? userId : parseInt(userId);
  const result = await cachedDb.collection('expenses').aggregate([
    { $match: { user_id: uid } },
    { $facet: {
      total: [{ $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }],
      pending: [{ $match: { status: 'pending' } }, { $group: { _id: null, count: { $sum: 1 } } }],
      approved: [{ $match: { status: 'approved' } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }],
      rejected: [{ $match: { status: 'rejected' } }, { $group: { _id: null, count: { $sum: 1 } } }],
    }}
  ]).toArray();

  const r = result[0];
  return {
    total: r.total[0] || { count: 0, total: 0 },
    pending: r.pending[0] || { count: 0 },
    approved: r.approved[0] || { count: 0, total: 0 },
    rejected: r.rejected[0] || { count: 0 },
  };
}

async function getEmployeesSummary() {
  const result = await cachedDb.collection('expenses').aggregate([
    { $group: {
      _id: '$user_id',
      username: { $first: '$username' },
      expense_count: { $sum: 1 },
      total_amount: { $sum: '$amount' },
      pending_count: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
      approved_count: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
      rejected_count: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
    }},
    { $sort: { username: 1 } }
  ]).toArray();

  return result.map(e => ({
    id: e._id,
    username: e.username,
    expense_count: e.expense_count,
    total_amount: e.total_amount,
    pending_count: e.pending_count,
    approved_count: e.approved_count,
    rejected_count: e.rejected_count,
  }));
}

module.exports = {
  connectMongo, getDb, toObjectId,
  findUser, findUserById, findAllUsers, findEmployees, createUser, updateUserPassword,
  findCategories, findCategory, createCategory,
  findExpenses, findOneExpense, insertExpense, updateExpense, deleteExpense,
  uploadReceipt, downloadReceipt, deleteReceipt,
  getAdminStats, getMyStats, getEmployeesSummary,
};
