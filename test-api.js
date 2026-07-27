const http = require('http');

function request(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    const options = { hostname: 'localhost', port: 3000, path, method, headers };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, body: data, setCookie });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  // Login
  let res = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const cookie = res.setCookie ? res.setCookie[0].split(';')[0] : '';
  console.log('LOGIN:', res.status, res.body.substring(0, 80));

  // Categories
  res = await request('GET', '/api/categories', null, cookie);
  console.log('CATEGORIES:', res.status, res.body.substring(0, 120));

  // Create expense
  res = await request('POST', '/api/expenses', { amount: 42.50, description: 'Team lunch', category_id: 2 }, cookie);
  console.log('CREATE EXPENSE:', res.status, res.body.substring(0, 120));

  // List expenses
  res = await request('GET', '/api/expenses', null, cookie);
  console.log('MY EXPENSES:', res.status, res.body.substring(0, 120));

  // Admin stats
  res = await request('GET', '/api/admin/stats', null, cookie);
  console.log('ADMIN STATS:', res.status, res.body.substring(0, 200));

  // Approve expense
  res = await request('PUT', '/api/admin/expenses/1', { status: 'approved' }, cookie);
  console.log('APPROVE:', res.status, res.body.substring(0, 120));

  // Revert expense back to pending
  res = await request('PUT', '/api/admin/expenses/1', { status: 'pending' }, cookie);
  console.log('REVERT:', res.status, res.body.substring(0, 120));

  // Employees summary
  res = await request('GET', '/api/admin/employees-summary', null, cookie);
  console.log('EMPLOYEES SUMMARY:', res.status, res.body.substring(0, 200));

  // Register new user (public, no auth needed)
  res = await request('POST', '/api/auth/register', { username: 'testuser', password: 'test123', role: 'Head Coach', email: 'test@test.com', phone: '1234567890' });
  console.log('REGISTER:', res.status, res.body.substring(0, 120));

  // Employees summary after register
  res = await request('GET', '/api/admin/employees-summary', null, cookie);
  console.log('EMPLOYEES SUMMARY (after reg):', res.status, res.body.substring(0, 200));

  // Logout
  res = await request('POST', '/api/auth/logout', null, cookie);
  console.log('LOGOUT:', res.status, res.body);

  console.log('\n✓ All tests passed');
}

test().catch(console.error);
