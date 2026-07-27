(() => {
  let currentUser = null;
  let categories = [];
  let currentExpenses = [];
  let employeeFilter = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showView(viewId) {
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#${viewId}`).classList.add('active');

    $$('.bottom-nav-item[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    if (viewId === 'view-expense') {
      $('#expense-form').reset();
      $('#expense-error').textContent = '';
      $('#file-name-display').classList.add('hidden');
      if (!$('#exp-date').value) {
        $('#exp-date').value = new Date().toISOString().slice(0, 10);
      }
      loadCategories();
    }

    window.scrollTo(0, 0);
    $('#bottom-nav').classList.toggle('hidden', viewId !== 'view-dashboard' && viewId !== 'view-expense');
    requestAnimationFrame(() => initScrollAnimations());
  }

  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Server returned an invalid response'); }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function checkAuth() {
    try {
      const { user } = await api('/api/auth/me');
      currentUser = user;
      await loadCategories();
      setupDashboard();
      showView('view-dashboard');
    } catch {
      showView('view-welcome');
    } finally {
      finishLoadingBar();
    }
  }

  async function loadCategories() {
    try {
      categories = await api('/api/categories');
      populateCategorySelects();
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }

  function populateCategorySelects() {
    const selects = ['#filter-category', '#exp-category', '#edit-exp-category'];
    selects.forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      const firstOpt = sel === '#filter-category' ? '<option value="">All</option>' : '';
      el.innerHTML =
        firstOpt +
        categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    });
  }

  function setupDashboard() {
    const profileImg = currentUser.profile_image
      ? `<img src="${currentUser.profile_image}" class="nav-profile-img" alt="">`
      : `<span class="nav-profile-initials">${currentUser.username.charAt(0).toUpperCase()}</span>`;
    $('#nav-user').innerHTML = `${profileImg}<span class="nav-user-text">${currentUser.username} (${currentUser.role})</span>`;
    const isAdmin = currentUser.role === 'admin';
    $('#admin-stats').classList.toggle('hidden', !isAdmin);
    $('#th-employee').classList.toggle('hidden', !isAdmin);
    $('#btn-add-category').classList.toggle('hidden', !isAdmin);
    $('#charts-section').classList.toggle('hidden', !isAdmin);
    $('#employee-branches').classList.toggle('hidden', !isAdmin);

    if (isAdmin) {
      loadStats();
      loadEmployeeBranches();
    }
    loadExpenses();
  }

  async function loadStats() {
    try {
      const stats = await api('/api/admin/stats');
      $('#stat-total').textContent = `₹${stats.total.total.toFixed(2)}`;
      $('#stat-pending').textContent = stats.pending.count;
      $('#stat-approved').textContent = `₹${stats.approved.total.toFixed(2)}`;
      $('#stat-rejected').textContent = stats.rejected.count;
      renderBarChart('#chart-category', stats.byCategory, 'name', 'total');
      renderBarChart('#chart-employee', stats.byEmployee, 'username', 'total');
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  async function loadEmployeeStats() {
    try {
      const stats = await api('/api/my-stats');
      $('#employee-stats').classList.remove('hidden');
      $('#emp-stat-total').textContent = `₹${stats.total.total.toFixed(2)}`;
      $('#emp-stat-pending').textContent = stats.pending.count;
      $('#emp-stat-approved').textContent = `₹${stats.approved.total.toFixed(2)}`;
      $('#emp-stat-rejected').textContent = stats.rejected.count;
    } catch (err) {
      console.error('Failed to load employee stats:', err);
    }
  }

  async function loadEmployeeBranches() {
    try {
      const employees = await api('/api/admin/employees-summary');
      const container = $('#employee-branches');
      if (!employees.length) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
      }

      const roleOrder = ['COO', 'Head Coach', 'Assistant Coach', 'Intern'];
      const grouped = {};
      employees.forEach((emp) => {
        if (!grouped[emp.role]) grouped[emp.role] = [];
        grouped[emp.role].push(emp);
      });

      let html = '<h3 class="branches-title">Team by Role</h3>';
      roleOrder.forEach((role) => {
        const emps = grouped[role];
        if (!emps || !emps.length) return;

        html += `
          <div class="branch-group">
            <div class="branch-header glass">
              <span class="branch-role">${escapeHtml(role)}</span>
              <span class="branch-count">${emps.length} member${emps.length > 1 ? 's' : ''}</span>
            </div>
            <div class="branch-employees">
              ${emps.map((emp) => `
                <div class="employee-card glass${employeeFilter === emp.id ? ' active' : ''}" data-user-id="${emp.id}" onclick="window.app.filterByEmployee(${emp.id}, '${escapeHtml(emp.username).replace(/'/g, "\\'")}')">
                  <div class="emp-card-top">
                    <span class="emp-name">${escapeHtml(emp.username)}</span>
                    <span class="emp-count">${emp.expense_count} expense${emp.expense_count !== 1 ? 's' : ''}</span>
                  </div>
                  <div class="emp-card-stats">
                    <span class="emp-total">₹${parseFloat(emp.total_amount).toFixed(2)}</span>
                    ${emp.pending_count > 0 ? `<span class="emp-pending">${emp.pending_count} pending</span>` : ''}
                    ${emp.approved_count > 0 ? `<span class="emp-approved">${emp.approved_count} approved</span>` : ''}
                  </div>
                  ${emp.expense_count > 0 ? `<button class="btn-emp-download" onclick="event.stopPropagation(); window.app.downloadEmployeeSummary(${emp.id}, '${escapeHtml(emp.username).replace(/'/g, "\\'")}')">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M4 8l4 4 4-4M3 13h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    Summary
                  </button>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;
      container.classList.remove('hidden');
    } catch (err) {
      console.error('Failed to load employee branches:', err);
    }
  }

  function renderBarChart(containerSel, data, labelKey, valueKey) {
    const container = $(containerSel);
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">No data</p>';
      return;
    }
    const maxVal = Math.max(...data.map((d) => d[valueKey]), 1);
    container.innerHTML = `<div class="bar-chart">${data
      .map(
        (d) => `
      <div class="bar-row">
        <div class="bar-label">${d[labelKey]}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max((d[valueKey] / maxVal) * 100, 2)}%"></div>
        </div>
        <div class="bar-value">₹${d[valueKey].toFixed(2)}</div>
      </div>`
      )
      .join('')}</div>`;
  }

  async function loadExpenses() {
    try {
      const params = new URLSearchParams();
      const status = $('#filter-status').value;
      const catId = $('#filter-category').value;
      const start = $('#filter-start').value;
      const end = $('#filter-end').value;
      if (status) params.set('status', status);
      if (catId) params.set('category_id', catId);
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);
      if (employeeFilter) params.set('user_id', employeeFilter);

      const url =
        currentUser.role === 'admin'
          ? `/api/admin/expenses?${params}`
          : `/api/expenses?${params}`;

      const expenses = await api(url);
      currentExpenses = expenses;
      renderExpenses(expenses);

      if (currentUser.role !== 'admin') {
        loadEmployeeStats();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderExpenses(expenses) {
    const tbody = $('#expense-body');
    const noExp = $('#no-expenses');

    if (expenses.length === 0) {
      tbody.innerHTML = '';
      noExp.classList.remove('hidden');
      return;
    }
    noExp.classList.add('hidden');

    const isAdmin = currentUser.role === 'admin';
    tbody.innerHTML = expenses
      .map(
        (e) => `
      <tr>
        <td>${e.expense_date || new Date(e.created_at).toLocaleDateString()}</td>
        ${isAdmin ? `<td><button class="employee-link" onclick="window.app.filterByEmployee(${e.user_id}, '${escapeHtml(e.username).replace(/'/g, "\\'")}')">${escapeHtml(e.username)}</button></td>` : ''}
        <td>${e.category_name}</td>
        <td>${escapeHtml(e.description)}</td>
        <td>₹${parseFloat(e.amount).toFixed(2)}</td>
        <td><span class="status-badge status-${e.status}">${e.status}</span></td>
        <td>${
          e.receipt_path
            ? `<button class="btn-ghost" onclick="window.app.viewReceipt('${e.receipt_path}')">View</button>`
            : '<span style="color:var(--text-muted)">-</span>'
        }</td>
        <td>
          <div class="action-buttons">
            ${isAdmin && e.status === 'pending' ? `
              <button class="btn-approve" onclick="window.app.updateExpense('${e.id}', 'approved')">Approve</button>
              <button class="btn-reject" onclick="window.app.updateExpense('${e.id}', 'rejected')">Reject</button>
            ` : ''}
            ${isAdmin && e.status !== 'pending' ? `
              <button class="btn-revert" onclick="window.app.updateExpense('${e.id}', 'pending')">Revert</button>
            ` : ''}
            <button class="btn-edit" onclick="window.app.editExpense('${e.id}')">Edit</button>
            <button class="btn-delete" onclick="window.app.confirmDelete('${e.id}', '${escapeHtml(e.description).replace(/'/g, "\\'")}')">Delete</button>
          </div>
        </td>
      </tr>`
      )
      .join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function downloadSummary() {
    const expenses = currentExpenses;
    const isAdmin = currentUser.role === 'admin';
    const userName = currentUser.username;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const total = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
    const approved = expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + parseFloat(e.amount), 0);
    const pending = expenses.filter((e) => e.status === 'pending').reduce((s, e) => s + parseFloat(e.amount), 0);
    const rejected = expenses.filter((e) => e.status === 'rejected').reduce((s, e) => s + parseFloat(e.amount), 0);

    let receiptImages = '';
    expenses.forEach((e) => {
      if (e.receipt_path && e.receipt_path.match(/\.(jpg|jpeg|png|gif)$/i)) {
        receiptImages += `
          <div style="margin-top:8px;font-size:12px;color:#555">
            <strong>${escapeHtml(e.description)}</strong> — ${escapeHtml(e.category_name)} (₹${parseFloat(e.amount).toFixed(2)})
            <br><img src="${e.receipt_path}" style="max-width:400px;max-height:250px;margin-top:4px;border:1px solid #ddd;border-radius:4px;" />
          </div>`;
      }
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Expense Summary - ${userName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #222; padding: 40px; }
    .header { text-align: center; border-bottom: 2px solid #222; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header p { font-size: 13px; color: #666; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat-box { flex: 1; min-width: 120px; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; text-align: center; }
    .stat-box .label { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
    .stat-box .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; color: #888; border-bottom: 2px solid #222; }
    td { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
    tr:nth-child(even) { background: #f9f9f9; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-pending { background: #fff3cd; color: #856404; }
    .badge-approved { background: #d4edda; color: #155724; }
    .badge-rejected { background: #f8d7da; color: #721c24; }
    .receipts { page-break-before: always; }
    .receipts h2 { font-size: 16px; margin-bottom: 12px; }
    .footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #999; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Expense Summary</h1>
    <p>${isAdmin ? 'All Employees' : userName} &bull; Generated on ${dateStr}</p>
  </div>

  <div class="stats">
    <div class="stat-box">
      <div class="label">Total</div>
      <div class="value">₹${total.toFixed(2)}</div>
    </div>
    <div class="stat-box">
      <div class="label">Expenses</div>
      <div class="value">${expenses.length}</div>
    </div>
    <div class="stat-box">
      <div class="label">Approved</div>
      <div class="value" style="color:#228b22">₹${approved.toFixed(2)}</div>
    </div>
    <div class="stat-box">
      <div class="label">Pending</div>
      <div class="value" style="color:#b8860b">₹${pending.toFixed(2)}</div>
    </div>
    <div class="stat-box">
      <div class="label">Rejected</div>
      <div class="value" style="color:#dc143c">₹${rejected.toFixed(2)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        ${isAdmin ? '<th>Employee</th>' : ''}
        <th>Category</th>
        <th>Description</th>
        <th>Amount</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${expenses.map((e) => `
        <tr>
          <td>${e.expense_date || new Date(e.created_at).toLocaleDateString('en-IN')}</td>
          ${isAdmin ? `<td>${escapeHtml(e.username)}</td>` : ''}
          <td>${escapeHtml(e.category_name)}</td>
          <td>${escapeHtml(e.description)}</td>
          <td>₹${parseFloat(e.amount).toFixed(2)}</td>
          <td><span class="badge badge-${e.status}">${e.status}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${receiptImages ? `<div class="receipts"><h2>Attached Receipts</h2>${receiptImages}</div>` : ''}

  <div class="footer">Expense Tracker &bull; Auto-generated report</div>

  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  }

  // Welcome → Login
  $('#btn-welcome-enter').addEventListener('click', () => showView('view-login'));

  // Login
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#login-error');
    errEl.textContent = '';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#login-username').value,
          password: $('#login-password').value,
        }),
      });
      currentUser = data.user;
      await loadCategories();
      setupDashboard();
      showView('view-dashboard');
      toast(`Welcome back, ${currentUser.username}!`);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Signup/Login Toggle
  $('#show-signup').addEventListener('click', (e) => {
    e.preventDefault();
    $('#login-card').classList.add('hidden');
    $('#signup-card').classList.remove('hidden');
    $('#signup-error').textContent = '';
  });

  $('#show-login').addEventListener('click', (e) => {
    e.preventDefault();
    $('#signup-card').classList.add('hidden');
    $('#login-card').classList.remove('hidden');
    $('#login-error').textContent = '';
  });
  $('#signup-back').addEventListener('click', () => {
    $('#signup-card').classList.add('hidden');
    $('#login-card').classList.remove('hidden');
    $('#login-error').textContent = '';
  });

  // Avatar preview
  $('#signup-avatar').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      $('#avatar-preview').innerHTML = `<img src="${ev.target.result}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
  });

  // Signup
  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#signup-error');
    errEl.textContent = '';
    try {
      const formData = new FormData();
      formData.append('username', $('#signup-username').value);
      formData.append('password', $('#signup-password').value);
      formData.append('role', $('#signup-role').value);
      formData.append('email', $('#signup-email').value);
      formData.append('phone', $('#signup-phone').value);
      const file = $('#signup-avatar').files[0];
      if (file) formData.append('profile_image', file);

      const res = await fetch('/api/auth/register', { method: 'POST', body: formData, credentials: 'include' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Server returned an invalid response'); }
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      currentUser = data.user;
      await loadCategories();
      setupDashboard();
      showView('view-dashboard');
      toast(`Welcome, ${currentUser.username}!`);
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Logout
  async function handleLogout() {
    await api('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    currentExpenses = [];
    employeeFilter = null;
    $('#employee-filter-bar').classList.add('hidden');
    $('#login-form').reset();
    $('#signup-form').reset();
    $('#signup-card').classList.add('hidden');
    $('#login-card').classList.remove('hidden');
    showView('view-login');
  }
  $('#btn-logout').addEventListener('click', handleLogout);
  $('#bottom-nav-logout').addEventListener('click', handleLogout);
  $('#btn-expense-logout').addEventListener('click', handleLogout);

  // Filters
  $('#btn-filter').addEventListener('click', loadExpenses);
  $('#btn-clear-employee-filter').addEventListener('click', () => window.app.clearEmployeeFilter());

  // New Expense (navigate to separate page)
  $('#btn-new-expense').addEventListener('click', async () => {
    await loadCategories();
    showView('view-expense');
  });
  $('#btn-back-dashboard').addEventListener('click', () => {
    loadExpenses();
    showView('view-dashboard');
  });
  $('#btn-cancel-expense').addEventListener('click', () => showView('view-dashboard'));

  // Bottom nav
  $$('.bottom-nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'view-dashboard') {
        loadExpenses();
      }
      showView(btn.dataset.view);
    });
  });

  // File upload area
  const fileArea = $('#file-upload-area');
  const fileInput = $('#exp-receipt');
  const fileNameDisplay = $('#file-name-display');

  fileArea.addEventListener('click', () => fileInput.click());
  fileArea.addEventListener('dragover', (e) => { e.preventDefault(); fileArea.classList.add('dragover'); });
  fileArea.addEventListener('dragleave', () => fileArea.classList.remove('dragover'));
  fileArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFileSelect(fileInput.files[0]);
  });

  function handleFileSelect(file) {
    fileNameDisplay.textContent = file.name;
    fileNameDisplay.classList.remove('hidden');
  }

  // Add Category Modal
  $('#btn-add-category').addEventListener('click', () => {
    $('#category-form').reset();
    $('#category-error').textContent = '';
    $('#modal-category').classList.add('active');
  });

  // Modal Close
  $$('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal').classList.remove('active'));
  });
  $$('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', () => overlay.closest('.modal').classList.remove('active'));
  });

  // Account Modal
  function renderAvatar(container, user) {
    if (user.profile_image && user.profile_image.startsWith('data:')) {
      container.innerHTML = `<img src="${user.profile_image}" alt="">`;
    } else {
      container.innerHTML = `<span class="account-initials">${user.username.charAt(0).toUpperCase()}</span>`;
    }
  }
  function showAccountView() {
    $('#account-view').classList.remove('hidden');
    $('#account-edit').classList.add('hidden');
    $('#account-modal-title').textContent = 'My Account';
  }
  function showAccountEdit() {
    $('#account-view').classList.add('hidden');
    $('#account-edit').classList.remove('hidden');
    $('#account-modal-title').textContent = 'Edit Profile';
    $('#pw-error').textContent = '';
    $('#edit-email').value = currentUser.email || '';
    $('#edit-phone').value = currentUser.phone || '';
    $('#pw-current').value = '';
    $('#pw-new').value = '';
    $('#pw-confirm').value = '';
    const preview = $('#edit-avatar-preview');
    renderAvatar(preview, currentUser);
    $('#edit-avatar').value = '';
  }
  function openAccountModal() {
    if (!currentUser) return;
    renderAvatar($('#account-avatar'), currentUser);
    $('#account-username').textContent = currentUser.username;
    $('#account-role').textContent = currentUser.role;
    $('#account-email').textContent = currentUser.email || 'Not set';
    $('#account-phone').textContent = currentUser.phone || 'Not set';
    const statusEl = $('#account-status');
    statusEl.textContent = currentUser.status || 'active';
    statusEl.className = 'info-value account-status ' + (currentUser.status || 'active');
    showAccountView();
    $('#modal-account').classList.add('active');
  }
  $('#nav-user').addEventListener('click', openAccountModal);
  $('#btn-edit-profile').addEventListener('click', showAccountEdit);
  $('#btn-cancel-edit').addEventListener('click', showAccountView);

  $('#edit-avatar').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      $('#edit-avatar-preview').innerHTML = `<img src="${ev.target.result}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
  });

  // Edit Profile
  $('#edit-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#pw-error');
    errEl.textContent = '';
    const email = $('#edit-email').value.trim();
    const phone = $('#edit-phone').value.trim();
    const currentPw = $('#pw-current').value;
    const newPw = $('#pw-new').value;
    const confirmPw = $('#pw-confirm').value;
    const hasPassword = currentPw || newPw || confirmPw;
    if (hasPassword) {
      if (!currentPw) { errEl.textContent = 'Current password is required to change password'; return; }
      if (newPw !== confirmPw) { errEl.textContent = 'New passwords do not match'; return; }
      if (newPw.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
    }
    try {
      const formData = new FormData();
      formData.append('email', email);
      formData.append('phone', phone);
      if (hasPassword) {
        formData.append('currentPassword', currentPw);
        formData.append('newPassword', newPw);
      }
      const file = $('#edit-avatar').files[0];
      if (file) formData.append('profile_image', file);
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        credentials: 'include',
        body: formData,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Server returned an invalid response'); }
      if (!res.ok) throw new Error(data.error);
      currentUser = data.user;
      toast('Profile updated successfully');
      showAccountView();
      openAccountModal();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Password toggle
  $$('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $('#' + btn.dataset.target);
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.querySelector('.pw-eye-open').classList.toggle('hidden', isPassword);
      btn.querySelector('.pw-eye-closed').classList.toggle('hidden', !isPassword);
    });
  });

  // Submit Expense
  $('#expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#expense-error');
    errEl.textContent = '';

    const formData = new FormData();
    formData.append('amount', $('#exp-amount').value);
    formData.append('category_id', $('#exp-category').value);
    formData.append('description', $('#exp-description').value);
    formData.append('expense_date', $('#exp-date').value);
    const file = fileInput.files[0];
    if (file) formData.append('receipt', file);

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Server returned an invalid response'); }
      if (!res.ok) throw new Error(data.error);

      toast('Expense submitted successfully!');
      loadExpenses();
      if (currentUser.role === 'admin') { loadStats(); loadEmployeeBranches(); }
      showView('view-dashboard');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Submit Category
  $('#category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#category-error');
    errEl.textContent = '';

    try {
      await api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name: $('#cat-name').value }),
      });
      $('#modal-category').classList.remove('active');
      await loadCategories();
      toast('Category added!');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Edit Expense
  $('#edit-expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#edit-expense-error');
    errEl.textContent = '';
    const id = $('#edit-expense-id').value;

    try {
      await api(`/api/expenses/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: $('#edit-exp-amount').value,
          category_id: $('#edit-exp-category').value,
          description: $('#edit-exp-description').value,
          expense_date: $('#edit-exp-date').value,
        }),
      });
      $('#modal-edit-expense').classList.remove('active');
      toast('Expense updated!');
      loadExpenses();
      if (currentUser.role === 'admin') { loadStats(); loadEmployeeBranches(); }
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Download Summary
  $('#btn-download-summary').addEventListener('click', downloadSummary);

  // View Receipt
  window.app = {
    filterByEmployee(userId, name) {
      employeeFilter = userId;
      $('#employee-filter-name').textContent = name;
      $('#employee-filter-bar').classList.remove('hidden');
      $$('.employee-card').forEach((c) => {
        c.classList.toggle('active', parseInt(c.dataset.userId) === userId);
      });
      loadExpenses();
    },

    clearEmployeeFilter() {
      employeeFilter = null;
      $('#employee-filter-bar').classList.add('hidden');
      $$('.employee-card').forEach((c) => c.classList.remove('active'));
      loadExpenses();
    },

    async downloadEmployeeSummary(userId, username) {
      try {
        const expenses = await api(`/api/admin/expenses?user_id=${userId}`);
        if (!expenses.length) { toast('No expenses found for this employee', 'error'); return; }

        const total = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
        const approved = expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + parseFloat(e.amount), 0);
        const pending = expenses.filter((e) => e.status === 'pending').reduce((s, e) => s + parseFloat(e.amount), 0);
        const rejected = expenses.filter((e) => e.status === 'rejected').reduce((s, e) => s + parseFloat(e.amount), 0);
        const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Expense Summary - ${username}</title>
        <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;padding:40px}.header{text-align:center;border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:24px}.header h1{font-size:22px;margin-bottom:4px}.header p{font-size:13px;color:#666}.stats{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}.stat-box{flex:1;min-width:120px;border:1px solid #ddd;border-radius:8px;padding:12px 16px;text-align:center}.stat-box .label{font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.5px}.stat-box .value{font-size:20px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse;margin-bottom:24px}th{text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;color:#888;border-bottom:2px solid #222}td{padding:10px 12px;border-bottom:1px solid #eee;font-size:13px}tr:nth-child(even){background:#f9f9f9}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase}.badge-pending{background:#fff3cd;color:#856404}.badge-approved{background:#d4edda;color:#155724}.badge-rejected{background:#f8d7da;color:#721c24}.footer{text-align:center;margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:11px;color:#999}@media print{body{padding:20px}}</style></head><body>
        <div class="header"><h1>Expense Summary</h1><p>${escapeHtml(username)} &bull; Generated on ${dateStr}</p></div>
        <div class="stats"><div class="stat-box"><div class="label">Total</div><div class="value">₹${total.toFixed(2)}</div></div><div class="stat-box"><div class="label">Expenses</div><div class="value">${expenses.length}</div></div><div class="stat-box"><div class="label">Approved</div><div class="value" style="color:#228b22">₹${approved.toFixed(2)}</div></div><div class="stat-box"><div class="label">Pending</div><div class="value" style="color:#b8860b">₹${pending.toFixed(2)}</div></div><div class="stat-box"><div class="label">Rejected</div><div class="value" style="color:#dc143c">₹${rejected.toFixed(2)}</div></div></div>
        <table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>${expenses.map((e) => `<tr><td>${e.expense_date || new Date(e.created_at).toLocaleDateString('en-IN')}</td><td>${escapeHtml(e.category_name)}</td><td>${escapeHtml(e.description)}</td><td>₹${parseFloat(e.amount).toFixed(2)}</td><td><span class="badge badge-${e.status}">${e.status}</span></td></tr>`).join('')}</tbody></table>
        <div class="footer">Chessbishop Expense Tracker &bull; Auto-generated report</div>
        <script>window.onload=()=>window.print()<\/script></body></html>`;
        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
      } catch (err) {
        toast(err.message, 'error');
      }
    },

    viewReceipt(path) {
      const preview = $('#receipt-preview');
      if (path.match(/\.(jpg|jpeg|png|gif)$/i)) {
        preview.innerHTML = `<img src="${path}" alt="Receipt">`;
      } else {
        preview.innerHTML = `<a href="${path}" target="_blank">Open Receipt</a>`;
      }
      $('#modal-receipt').classList.add('active');
    },

    async updateExpense(id, status) {
      try {
        await api(`/api/admin/expenses/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ status }),
        });
        toast(`Expense ${status}!`);
        loadExpenses();
        if (currentUser.role === 'admin') {
          loadStats();
          loadEmployeeBranches();
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    },

    async editExpense(id) {
      const expense = currentExpenses.find((e) => String(e.id) === String(id));
      if (!expense) return;

      $('#edit-expense-id').value = expense.id;
      $('#edit-exp-amount').value = expense.amount;
      $('#edit-exp-description').value = expense.description;
      $('#edit-exp-date').value = expense.expense_date || expense.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);

      await loadCategories();
      const catSelect = $('#edit-exp-category');
      catSelect.value = expense.category_id;

      $('#edit-expense-error').textContent = '';
      $('#modal-edit-expense').classList.add('active');
    },

    confirmDelete(id, description) {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-box glass">
          <h3>Delete Expense</h3>
          <p>Are you sure you want to delete "${description}"? This action cannot be undone.</p>
          <div class="confirm-actions">
            <button class="btn btn-outline confirm-cancel">Cancel</button>
            <button class="btn btn-danger confirm-delete">Delete</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
      overlay.querySelector('.confirm-delete').addEventListener('click', async () => {
        overlay.remove();
        try {
          await api(`/api/expenses/${id}`, { method: 'DELETE' });
          toast('Expense deleted!');
          loadExpenses();
          if (currentUser.role === 'admin') { loadStats(); loadEmployeeBranches(); }
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  };

  // 3D Geometric Mesh Background - Vibrant
  function initBackground() {
    const canvas = $('#bg-canvas');
    const ctx = canvas.getContext('2d');
    let nodes = [];
    let animFrame;
    const NODE_COUNT = 28;
    const CONNECTION_DIST = 200;
    const SPEED = 0.35;

    const colors = [
      { r: 255, g: 215, b: 0 },
      { r: 255, g: 165, b: 0 },
      { r: 218, g: 165, b: 32 },
      { r: 255, g: 193, b: 37 },
      { r: 244, g: 164, b: 96 },
      { r: 205, g: 133, b: 63 },
    ];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function createNodes() {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        nodes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          z: Math.random() * 350 + 80,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
          vz: (Math.random() - 0.5) * SPEED * 0.5,
          size: Math.random() * 2.5 + 1,
          color,
        });
      }
    }

    function project(node) {
      const scale = 600 / (600 + node.z);
      return {
        x: canvas.width / 2 + (node.x - canvas.width / 2) * scale,
        y: canvas.height / 2 + (node.y - canvas.height / 2) * scale,
        scale,
      };
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        n.z += n.vz;
        if (n.x < -50 || n.x > canvas.width + 50) n.vx *= -1;
        if (n.y < -50 || n.y > canvas.height + 50) n.vy *= -1;
        if (n.z < 50 || n.z > 500) n.vz *= -1;
      });

      const projected = nodes.map((n) => ({ ...n, ...project(n) }));

      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const dx = projected[i].x - projected[j].x;
          const dy = projected[i].y - projected[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const opacity = (1 - dist / CONNECTION_DIST) * 0.35 * ((projected[i].scale + projected[j].scale) / 2);
            const c = projected[i].color;
            ctx.beginPath();
            ctx.moveTo(projected[i].x, projected[i].y);
            ctx.lineTo(projected[j].x, projected[j].y);
            ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${opacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      projected.forEach((n) => {
        const opacity = 0.4 + n.scale * 0.5;
        const size = n.size * n.scale;
        const c = n.color;

        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${opacity})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(n.x, n.y, size * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${opacity * 0.08})`;
        ctx.fill();
      });

      animFrame = requestAnimationFrame(draw);
    }

    resize();
    createNodes();
    draw();

    window.addEventListener('resize', resize);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(animFrame);
      } else {
        draw();
      }
    });
  }

  // Loading Bar
  const loadingBar = document.getElementById('loading-bar');
  let loadingProgress = 0;
  const loadingInterval = setInterval(() => {
    if (loadingProgress < 30) loadingProgress += 8;
    else if (loadingProgress < 60) loadingProgress += 3;
    else if (loadingProgress < 85) loadingProgress += 1;
    if (loadingBar) loadingBar.querySelector('.loading-bar-fill').style.width = loadingProgress + '%';
  }, 100);

  function finishLoadingBar() {
    clearInterval(loadingInterval);
    if (!loadingBar) return;
    loadingBar.querySelector('.loading-bar-fill').style.width = '100%';
    loadingBar.classList.add('done');
    setTimeout(() => {
      loadingBar.classList.add('fade-out');
      setTimeout(() => loadingBar.remove(), 500);
    }, 300);
  }

  // Scroll Fade-in Animation
  let scrollObserver = null;
  function initScrollAnimations() {
    if (scrollObserver) scrollObserver.disconnect();
    scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          scrollObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    $$('.scroll-fade').forEach((el) => {
      if (!el.classList.contains('visible')) scrollObserver.observe(el);
    });
  }

  // Init
  checkAuth();
  initBackground();
})();
