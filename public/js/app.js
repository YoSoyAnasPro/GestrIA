(() => {
  let token = localStorage.getItem('gestria_token');
  let currentUser = null;
  let currentPage = '';
  let charts = {};

  const API = '/api';
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
  const api = async (url, opts = {}) => {
    const res = await fetch(API + url, { headers: headers(), ...opts });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    return data;
  };

  const skeleton = (lines = 4) => `<div class="skeleton-card"><div class="skeleton skeleton-title"></div>${Array(lines).fill('<div class="skeleton skeleton-text"></div>').join('')}</div>`;
  const loadingHtml = `<div class="fade-in" style="display:flex;flex-direction:column;gap:20px;padding:20px">${skeleton(3)}${skeleton(5)}${skeleton(2)}</div>`;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function toast(msg, type = 'success') {
    const c = $('#toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function openModal(title, bodyHtml) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-overlay').style.display = '';
  }

  function closeModal() { $('#modal-overlay').style.display = 'none'; }

  function formatDate(d) {
    if (!d) return '-';
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const date = new Date(d + 'T00:00:00');
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  function formatCurrency(n) { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0); }

  const pageTitles = {
    dashboard: 'Dashboard', calendar: 'Calendario', bookings: 'Reservas', clients: 'Clientes',
    services: 'Servicios', employees: 'Empleados', availability: 'Disponibilidad',
    loyalty: 'Fidelización', payments: 'Pagos', stats: 'Estadísticas',
    reviews: 'Reseñas', bot: 'Bots', integrations: 'Integraciones', settings: 'Configuración'
  };

  // ===================== DARK MODE =====================
  function initTheme() {
    const saved = localStorage.getItem('gestria_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const toggle = $('#theme-toggle');
    if (toggle) toggle.checked = saved === 'dark';
    toggle?.addEventListener('change', () => {
      const theme = toggle.checked ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('gestria_theme', theme);
    });
  }

  // ===================== AUTH =====================
  function initAuth() {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) });
        token = data.token; localStorage.setItem('gestria_token', token); currentUser = data.user;
        showApp();
      } catch (err) { $('#login-error').textContent = err.message; $('#login-error').style.display = ''; }
    });
    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ name: $('#reg-name').value, email: $('#reg-email').value, password: $('#reg-password').value, business_name: $('#reg-business').value }) });
        token = data.token; localStorage.setItem('gestria_token', token); currentUser = data.user;
        showApp();
      } catch (err) { $('#register-error').textContent = err.message; $('#register-error').style.display = ''; }
    });
    $('#show-register').addEventListener('click', (e) => { e.preventDefault(); $('#login-form').style.display = 'none'; $('#register-form').style.display = ''; });
    $('#show-login').addEventListener('click', (e) => { e.preventDefault(); $('#login-form').style.display = ''; $('#register-form').style.display = 'none'; });
    $('#logout-btn').addEventListener('click', () => { token = null; localStorage.removeItem('gestria_token'); location.reload(); });
  }

  async function showApp() {
    try {
      currentUser = await api('/auth/me');
      $('#login-screen').style.display = 'none';
      $('#main-app').style.display = '';
      $('#user-name').textContent = currentUser.name;
      $('#user-business').textContent = currentUser.business_name || '';
      $('#user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();
      initTheme();
      navigate(window.location.hash.slice(1) || '/');
    } catch { localStorage.removeItem('gestria_token'); location.reload(); }
  }

  // ===================== ROUTER =====================
  function navigate(path) {
    const page = path.split('/')[1] || 'dashboard';
    currentPage = page;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    $('#page-title').textContent = pageTitles[page] || page;
    Object.values(charts).forEach(c => c.destroy?.());
    charts = {};
    const renderers = { dashboard: renderDashboard, calendar: renderCalendar, bookings: renderBookings, clients: renderClients, services: renderServices, employees: renderEmployees, availability: renderAvailability, loyalty: renderLoyalty, payments: renderPayments, stats: renderStats, reviews: renderReviews, bot: renderBot, integrations: renderIntegrations, settings: renderSettings };
    (renderers[page] || renderDashboard)();
  }

  window.addEventListener('hashchange', () => { closeSidebar(); navigate(window.location.hash.slice(1)); });
  $('#menu-toggle')?.addEventListener('click', () => {
    const sb = $('#sidebar'), ov = $('#sidebar-overlay');
    sb.classList.toggle('open');
    ov.classList.toggle('active', sb.classList.contains('open'));
  });
  $('#sidebar-overlay')?.addEventListener('click', closeSidebar);
  $('#quick-book-btn')?.addEventListener('click', () => showBookingModal());
  document.addEventListener('click', (e) => { if (e.target === $('#modal-overlay')) closeModal(); });
  $('#modal-close')?.addEventListener('click', closeModal);

  function closeSidebar() { $('#sidebar')?.classList.remove('open'); $('#sidebar-overlay')?.classList.remove('active'); }

  // ===================== DASHBOARD =====================
  async function renderDashboard() {
    $('#content-area').innerHTML = loadingHtml;
    const data = await api('/dashboard');
    const greeting = new Date().getHours() < 14 ? 'Buenos días' : new Date().getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
    let html_content = `
      <div class="fade-in">
        <h2 style="font-size:24px;font-weight:700;margin-bottom:24px;color:var(--text)">${greeting}, ${currentUser.name} 👋</h2>
        <div class="card-grid card-grid-4" style="margin-bottom:24px">
          <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-calendar-check"></i></div><div class="stat-value">${data.today.bookings.length}</div><div class="stat-label">Citas hoy</div></div>
          <div class="stat-card"><div class="stat-icon green"><i class="fas fa-euro-sign"></i></div><div class="stat-value">${formatCurrency(data.today.revenue)}</div><div class="stat-label">Ingresos hoy</div></div>
          <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-users"></i></div><div class="stat-value">${data.today.clients}</div><div class="stat-label">Clientes hoy</div></div>
          <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-chart-pie"></i></div><div class="stat-value">${data.today.occupation}%</div><div class="stat-label">Ocupación</div></div>
        </div>
        ${data.nextBooking ? `<div class="card" style="margin-bottom:24px;background:linear-gradient(135deg,var(--primary),#7C3AED);color:white;border:none"><div style="display:flex;align-items:center;justify-content:space-between"><div><div style="font-size:13px;opacity:0.8;margin-bottom:4px">Próxima cita</div><div style="font-size:24px;font-weight:700">${data.nextBooking.start_time} - ${data.nextBooking.client_name}</div><div style="opacity:0.9;margin-top:4px">${data.nextBooking.service_name}</div></div><div style="font-size:48px;opacity:0.3"><i class="fas fa-clock"></i></div></div></div>` : ''}
        ${data.alerts.length ? data.alerts.map(a => `<div class="alert alert-${a.type}"><i class="fas fa-${a.type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>${a.message}</div>`).join('') : ''}
        <div class="card-grid card-grid-2" style="margin-top:24px">
          <div class="card"><div class="card-header"><h3>Calendario del día</h3></div>
            ${data.today.bookings.length ? data.today.bookings.map(b => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><div style="width:6px;height:40px;border-radius:3px;background:${b.employee_color || '#4F46E5'}"></div><div style="flex:1"><div style="font-weight:600;font-size:14px">${b.start_time} - ${b.end_time}</div><div style="font-size:13px;color:var(--text-secondary)">${b.client_name} · ${b.service_name}</div></div><span class="badge badge-${b.status === 'confirmed' ? 'success' : 'warning'}">${b.status === 'confirmed' ? 'Confirmada' : 'Pendiente'}</span></div>`).join('') : '<div class="empty-state"><p>No hay citas hoy</p></div>'}
          </div>
          <div class="card"><div class="card-header"><h3>Últimas reservas</h3></div>
            ${data.recentBookings.slice(0, 6).map(b => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)"><div style="width:36px;height:36px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;color:var(--primary);font-weight:600;font-size:14px">${b.client_name?.charAt(0) || '?'}</div><div style="flex:1"><div style="font-weight:600;font-size:14px">${b.client_name}</div><div style="font-size:12px;color:var(--text-secondary)">${b.service_name} · ${formatDate(b.date)}</div></div></div>`).join('')}
          </div>
        </div>
      </div>`;
    $('#content-area').innerHTML = html_content;
  }

  // ===================== CALENDAR =====================
  let calView = 'month', calDate = new Date(), calEmployeeFilter = '';

  async function renderCalendar() {
    $('#content-area').innerHTML = loadingHtml;
    const employees = await api('/employees');
    const startOfMonth = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
    const endOfMonth = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0);
    const sd = startOfMonth.toISOString().split('T')[0];
    const ed = endOfMonth.toISOString().split('T')[0];
    let url = `/bookings?start_date=${sd}&end_date=${ed}`;
    if (calEmployeeFilter) url += `&employee_id=${calEmployeeFilter}`;
    const bookings = await api(url);
    const days = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
    let filtersHtml = `<div class="filters"><div class="view-toggle"><button class="${calView === 'day' ? 'active' : ''}" onclick="window._calView('day')">Día</button><button class="${calView === 'week' ? 'active' : ''}" onclick="window._calView('week')">Semana</button><button class="${calView === 'month' ? 'active' : ''}" onclick="window._calView('month')">Mes</button></div><div class="filter-group"><label>Empleado:</label><select onchange="window._calEmployee(this.value)"><option value="">Todos</option>${employees.map(e => `<option value="${e.id}" ${calEmployeeFilter == e.id ? 'selected' : ''}>${e.name}</option>`).join('')}</select></div></div>`;

    let calHtml = '';
    if (calView === 'month') {
      const firstDay = (startOfMonth.getDay() + 6) % 7;
      const daysInMonth = endOfMonth.getDate();
      calHtml = `<div class="calendar-grid">${days.map(d => `<div class="calendar-day-header">${d}</div>`).join('')}`;
      const prevMonth = new Date(calDate.getFullYear(), calDate.getMonth(), 0);
      for (let i = firstDay - 1; i >= 0; i--) { calHtml += `<div class="calendar-day other-month"><div class="day-number">${prevMonth.getDate() - i}</div></div>`; }
      const today = new Date();
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calDate.getFullYear()}-${String(calDate.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday = today.getFullYear() === calDate.getFullYear() && today.getMonth() === calDate.getMonth() && today.getDate() === d;
        const dayBookings = bookings.filter(b => b.date === dateStr);
        calHtml += `<div class="calendar-day${isToday ? ' today' : ''}" onclick="window._calDayClick('${dateStr}')"><div class="day-number">${d}</div><div class="day-events">${dayBookings.slice(0, 3).map(b => `<div class="day-event" style="background:${b.employee_color || '#4F46E5'}">${b.start_time} ${b.client_name}</div>`).join('')}${dayBookings.length > 3 ? `<div style="font-size:10px;color:var(--text-secondary);padding:2px 4px">+${dayBookings.length - 3} más</div>` : ''}</div></div>`;
      }
      const totalCells = firstDay + daysInMonth;
      for (let i = 1; i <= (7 - (totalCells % 7)) % 7; i++) { calHtml += `<div class="calendar-day other-month"><div class="day-number">${i}</div></div>`; }
      calHtml += '</div>';
    } else if (calView === 'week') {
      const weekStart = new Date(calDate);
      weekStart.setDate(calDate.getDate() - ((calDate.getDay() + 6) % 7));
      calHtml = `<div class="week-view"><div class="week-header"></div>`;
      for (let i = 0; i < 7; i++) { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); calHtml += `<div class="week-header${d.toDateString() === new Date().toDateString() ? ' today' : ''}">${days[i]} ${d.getDate()}</div>`; }
      for (let h = 9; h <= 20; h++) {
        calHtml += `<div class="time-label">${String(h).padStart(2, '0')}:00</div>`;
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
          const dateStr = d.toISOString().split('T')[0];
          const hourBookings = bookings.filter(b => b.date === dateStr && b.start_time?.startsWith(String(h).padStart(2, '0')));
          calHtml += `<div class="time-slot" onclick="window._calSlotClick('${dateStr}','${String(h).padStart(2,'0')}:00')">${hourBookings.map(b => `<div class="time-slot-event" style="background:${b.employee_color || '#4F46E5'}">${b.client_name}<br><small>${b.service_name}</small></div>`).join('')}</div>`;
        }
      }
      calHtml += '</div>';
    } else {
      const dateStr = calDate.toISOString().split('T')[0];
      const dayBookings = bookings.filter(b => b.date === dateStr);
      calHtml = `<div style="text-align:center;margin-bottom:16px"><h3 style="color:var(--text)">${formatDate(dateStr)}</h3></div><div style="display:grid;grid-template-columns:70px 1fr;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">`;
      for (let h = 9; h <= 20; h++) {
        const timeBookings = dayBookings.filter(b => b.start_time?.startsWith(String(h).padStart(2, '0')));
        calHtml += `<div style="padding:8px;font-size:13px;color:var(--text-secondary);text-align:right;border-right:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--gray-50)">${String(h).padStart(2, '0')}:00</div>`;
        calHtml += `<div style="padding:4px;border-bottom:1px solid var(--border)">${timeBookings.map(b => `<div style="background:${b.employee_color || '#4F46E5'};color:white;padding:8px 12px;border-radius:8px;margin:2px 0;cursor:pointer"><div style="font-weight:600">${b.start_time} - ${b.end_time}</div><div style="font-size:12px;opacity:0.9">${b.client_name} · ${b.service_name}</div></div>`).join('')}</div>`;
      }
      calHtml += '</div>';
    }
    $('#content-area').innerHTML = filtersHtml + calHtml;
  }

  window._calView = (v) => { calView = v; renderCalendar(); };
  window._calEmployee = (id) => { calEmployeeFilter = id; renderCalendar(); };
  window._calDayClick = (date) => { calDate = new Date(date + 'T00:00:00'); calView = 'day'; renderCalendar(); };
  window._calSlotClick = (date, time) => showBookingModal(null, date, time);

  // ===================== BOOKINGS =====================
  async function renderBookings() {
    $('#content-area').innerHTML = loadingHtml;
    const today = new Date().toISOString().split('T')[0];
    const bookings = await api(`/bookings?date=${today}`);
    $('#content-area').innerHTML = `<div class="fade-in"><div class="card"><div class="card-header"><h3>Reservas de hoy</h3><button class="btn btn-primary btn-sm" onclick="window._newBooking()"><i class="fas fa-plus"></i> Nueva Reserva</button></div>
      ${bookings.length ? `<div class="table-wrapper"><table><thead><tr><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Empleado</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${bookings.map(b => `<tr><td><strong>${b.start_time}</strong> - ${b.end_time}</td><td>${b.client_name || '-'}</td><td><span class="badge" style="background:${b.service_color}20;color:${b.service_color}">${b.service_name}</span></td><td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${b.employee_color}"></span>${b.employee_name}</span></td><td><span class="badge badge-${b.status === 'confirmed' ? 'success' : b.status === 'completed' ? 'info' : 'danger'}">${b.status}</span></td><td><div style="display:flex;gap:4px">${b.status === 'confirmed' ? `<button class="btn btn-success btn-sm" onclick="window._completeBooking('${b.id}')"><i class="fas fa-check"></i></button>` : ''}${b.status !== 'cancelled' && b.status !== 'completed' ? `<button class="btn btn-danger btn-sm" onclick="window._cancelBooking('${b.id}')"><i class="fas fa-times"></i></button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><i class="fas fa-calendar-times"></i><h3>Sin reservas hoy</h3></div>'}</div></div>`;
  }

  window._newBooking = () => showBookingModal();
  window._completeBooking = async (id) => { await api(`/bookings/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'completed' }) }); toast('Reserva completada'); renderBookings(); };
  window._cancelBooking = async (id) => { await api(`/bookings/${id}`, { method: 'DELETE' }); toast('Reserva cancelada'); renderBookings(); };

  async function showBookingModal(booking = null, preDate = '', preTime = '') {
    const [clients, services, employees] = await Promise.all([api('/clients'), api('/services'), api('/employees')]);
    openModal(booking ? 'Editar Reserva' : 'Nueva Reserva', `
      <form id="booking-form">
        <div class="form-group"><label>Cliente</label><select id="bk-client" required><option value="">Seleccionar cliente...</option>${clients.map(c => `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`).join('')}</select></div>
        <div class="form-row">
          <div class="form-group"><label>Servicio</label><select id="bk-service" required onchange="window._updateBookingDuration()"><option value="">Seleccionar...</option>${services.map(s => `<option value="${s.id}" data-duration="${s.duration}" data-price="${s.price}" data-color="${s.color}">${s.name} (${s.duration}min - ${formatCurrency(s.price)})</option>`).join('')}</select></div>
          <div class="form-group"><label>Empleado</label><select id="bk-employee" required><option value="">Seleccionar...</option>${employees.map(e => `<option value="${e.id}" data-name="${e.name}" data-color="${e.color}">${e.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fecha</label><input type="date" id="bk-date" value="${preDate || new Date().toISOString().split('T')[0]}" required></div>
          <div class="form-group"><label>Hora</label><input type="time" id="bk-time" value="${preTime || '10:00'}" required></div>
        </div>
        <div class="form-group"><label>Notas</label><textarea id="bk-notes" rows="2" placeholder="Notas opcionales...">${booking?.notes || ''}</textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn btn-outline" onclick="window._closeModal()">Cancelar</button><button type="submit" class="btn btn-primary">${booking ? 'Actualizar' : 'Crear Reserva'}</button></div>
      </form>`);
    document.getElementById('booking-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const svcEl = document.getElementById('bk-service');
        const empEl = document.getElementById('bk-employee');
        const svcOpt = svcEl.options[svcEl.selectedIndex];
        const empOpt = empEl.options[empEl.selectedIndex];
        const body = {
          client_id: document.getElementById('bk-client').value,
          service_id: svcEl.value,
          employee_id: empEl.value,
          date: document.getElementById('bk-date').value,
          start_time: document.getElementById('bk-time').value,
          notes: document.getElementById('bk-notes').value,
          service_name: svcOpt?.text?.split(' (')[0] || '',
          service_price: parseFloat(svcOpt?.dataset?.price) || 0,
          service_color: svcOpt?.dataset?.color || '#4F46E5',
          service_duration: parseInt(svcOpt?.dataset?.duration) || 30,
          employee_name: empOpt?.dataset?.name || '',
          employee_color: empOpt?.dataset?.color || '#10B981',
          client_name: document.getElementById('bk-client').options[document.getElementById('bk-client').selectedIndex]?.dataset?.name || ''
        };
        if (booking) await api(`/bookings/${booking.id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/bookings', { method: 'POST', body: JSON.stringify(body) });
        closeModal(); toast('Reserva guardada');
        if (currentPage === 'bookings') renderBookings(); else if (currentPage === 'calendar') renderCalendar(); else if (currentPage === 'dashboard') renderDashboard();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  window._closeModal = closeModal;

  // ===================== CLIENTS =====================
  let selectedClient = null;

  async function renderClients() {
    if (selectedClient) {
      const data = await api(`/clients/${selectedClient}`);
      $('#content-area').innerHTML = `<div class="fade-in"><button class="btn btn-ghost" onclick="window._backToClients()" style="margin-bottom:16px"><i class="fas fa-arrow-left"></i> Volver</button>
        <div class="client-detail"><div class="client-info-card card">
          <div class="client-avatar-lg">${data.name?.charAt(0) || '?'}</div>
          <div class="client-name-lg">${data.name}</div>
          <div class="client-meta">Cliente desde ${formatDate(data.first_visit || data.created_at?.split(' ')[0]?.split('T')[0])}</div>
          <div class="client-stats">
            <div class="client-stat"><div class="value">${data.visits || 0}</div><div class="label">Visitas</div></div>
            <div class="client-stat"><div class="value">${formatCurrency(data.total_spent)}</div><div class="label">Gastado</div></div>
            <div class="client-stat"><div class="value">${data.points || 0}</div><div class="label">Puntos</div></div>
            <div class="client-stat"><div class="value">${data.last_visit ? formatDate(data.last_visit) : 'N/A'}</div><div class="label">Última visita</div></div>
          </div>
          ${data.notes ? `<div class="client-notes"><i class="fas fa-sticky-note"></i> ${data.notes}</div>` : ''}
          ${data.preferences ? `<div class="client-preferences"><i class="fas fa-heart"></i> ${data.preferences}</div>` : ''}
          <div class="client-links">
            ${data.phone ? `<a href="tel:${data.phone}"><i class="fas fa-phone"></i> ${data.phone}</a>` : ''}
            ${data.whatsapp ? `<a href="https://wa.me/${data.whatsapp}" target="_blank"><i class="fab fa-whatsapp" style="color:#25D366"></i> WhatsApp</a>` : ''}
            ${data.instagram ? `<a href="https://instagram.com/${data.instagram}" target="_blank"><i class="fab fa-instagram" style="color:#E4405F"></i> @${data.instagram}</a>` : ''}
            ${data.email ? `<a href="mailto:${data.email}"><i class="fas fa-envelope"></i> ${data.email}</a>` : ''}
          </div>
          <button class="btn btn-outline btn-full" style="margin-top:16px" onclick="window._editClient('${data.id}')"><i class="fas fa-edit"></i> Editar</button>
        </div><div>
          <div class="card" style="margin-bottom:20px"><div class="card-header"><h3>Historial de visitas</h3></div>
            ${data.history?.length ? data.history.map(h => `<div class="history-item"><div class="history-date">${formatDate(h.date)}</div><div class="history-service">${h.service_name}</div><div class="history-price">${formatCurrency(h.service_price || h.price)}</div></div>`).join('') : '<div class="empty-state"><p>Sin historial</p></div>'}
          </div>
          <div class="card"><div class="card-header"><h3>Reseñas</h3></div>
            ${data.reviews?.length ? data.reviews.map(r => `<div style="padding:12px 0;border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><div class="rating">${[1,2,3,4,5].map(i => `<i class="fas fa-star${i <= r.rating ? ' active' : ''}"></i>`).join('')}</div><span style="font-size:12px;color:var(--text-secondary)">${formatDate(r.created_at?.split(' ')[0]?.split('T')[0])}</span></div>${r.comment ? `<p style="font-size:14px;color:var(--text-secondary)">${r.comment}</p>` : ''}</div>`).join('') : '<div class="empty-state"><p>Sin reseñas</p></div>'}
          </div>
        </div></div></div>`;
      return;
    }
    $('#content-area').innerHTML = loadingHtml;
    const clients = await api('/clients');
    $('#content-area').innerHTML = `<div class="fade-in"><div class="card"><div class="card-header"><h3>Clientes (${clients.length})</h3><button class="btn btn-primary btn-sm" onclick="window._newClient()"><i class="fas fa-plus"></i> Nuevo Cliente</button></div>
      <div style="margin-bottom:16px"><input type="text" placeholder="Buscar cliente..." id="client-search" oninput="window._searchClients(this.value)" style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;background:var(--input-bg);color:var(--text)"></div>
      <div class="table-wrapper"><table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Visitas</th><th>Gastado</th><th>Puntos</th><th></th></tr></thead><tbody id="clients-tbody">${clients.map(c => `<tr style="cursor:pointer" onclick="window._viewClient('${c.id}')"><td><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;color:var(--primary);font-weight:600">${c.name?.charAt(0) || '?'}</div>${c.name}</div></td><td>${c.phone || '-'}</td><td><strong>${c.visits || 0}</strong></td><td>${formatCurrency(c.total_spent)}</td><td><span class="badge badge-purple">${c.points || 0} pts</span></td><td><button class="btn-icon" onclick="event.stopPropagation();window._editClient('${c.id}')"><i class="fas fa-edit"></i></button></td></tr>`).join('')}</tbody></table></div></div></div>`;
  }

  window._viewClient = (id) => { selectedClient = id; renderClients(); };
  window._backToClients = () => { selectedClient = null; renderClients(); };
  window._searchClients = async (q) => {
    const clients = q ? await api(`/clients?search=${encodeURIComponent(q)}`) : await api('/clients');
    const tbody = $('#clients-tbody');
    if (tbody) tbody.innerHTML = clients.map(c => `<tr style="cursor:pointer" onclick="window._viewClient('${c.id}')"><td><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;color:var(--primary);font-weight:600">${c.name?.charAt(0) || '?'}</div>${c.name}</div></td><td>${c.phone || '-'}</td><td><strong>${c.visits || 0}</strong></td><td>${formatCurrency(c.total_spent)}</td><td><span class="badge badge-purple">${c.points || 0} pts</span></td><td><button class="btn-icon" onclick="event.stopPropagation();window._editClient('${c.id}')"><i class="fas fa-edit"></i></button></td></tr>`).join('');
  };

  function showClientForm(client = null) {
    openModal(client ? 'Editar Cliente' : 'Nuevo Cliente', `
      <form id="client-form">
        <div class="form-group"><label>Nombre *</label><input type="text" id="cl-name" value="${client?.name || ''}" required></div>
        <div class="form-row"><div class="form-group"><label>Teléfono</label><input type="tel" id="cl-phone" value="${client?.phone || ''}"></div><div class="form-group"><label>Email</label><input type="email" id="cl-email" value="${client?.email || ''}"></div></div>
        <div class="form-row"><div class="form-group"><label>Instagram</label><input type="text" id="cl-instagram" value="${client?.instagram || ''}"></div><div class="form-group"><label>WhatsApp</label><input type="text" id="cl-whatsapp" value="${client?.whatsapp || ''}"></div></div>
        <div class="form-group"><label>Cumpleaños</label><input type="date" id="cl-birthday" value="${client?.birthday || ''}"></div>
        <div class="form-group"><label>Notas</label><textarea id="cl-notes" rows="2">${client?.notes || ''}</textarea></div>
        <div class="form-group"><label>Preferencias</label><textarea id="cl-preferences" rows="2">${client?.preferences || ''}</textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn btn-outline" onclick="window._closeModal()">Cancelar</button><button type="submit" class="btn btn-primary">${client ? 'Guardar' : 'Crear'}</button></div>
      </form>`);
    document.getElementById('client-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: $('#cl-name').value, phone: $('#cl-phone').value, email: $('#cl-email').value, instagram: $('#cl-instagram').value, whatsapp: $('#cl-whatsapp').value, birthday: $('#cl-birthday').value, notes: $('#cl-notes').value, preferences: $('#cl-preferences').value };
      try {
        if (client) await api(`/clients/${client.id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/clients', { method: 'POST', body: JSON.stringify(body) });
        closeModal(); toast('Cliente guardado'); selectedClient = null; renderClients();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  window._newClient = () => showClientForm();
  window._editClient = async (id) => { const c = await api(`/clients/${id}`); showClientForm(c); };

  // ===================== SERVICES =====================
  async function renderServices() {
    $('#content-area').innerHTML = loadingHtml;
    const services = await api('/services');
    $('#content-area').innerHTML = `<div class="fade-in"><div class="card"><div class="card-header"><h3>Servicios</h3><button class="btn btn-primary btn-sm" onclick="window._newService()"><i class="fas fa-plus"></i> Nuevo Servicio</button></div>
      <div class="card-grid card-grid-3">${services.map(s => `<div style="background:var(--surface);border:2px solid var(--border);border-radius:var(--radius);padding:20px;cursor:pointer;border-top:4px solid ${s.color}" onclick="window._editService('${s.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h4 style="font-size:16px;font-weight:700;color:var(--text)">${s.name}</h4><span class="badge badge-${s.needs_confirmation ? 'warning' : 'success'}">${s.needs_confirmation ? 'Requiere confirmación' : 'Automático'}</span></div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px"><span style="font-size:28px;font-weight:700;color:${s.color}">${formatCurrency(s.price)}</span><span style="color:var(--text-secondary)">· ${s.duration} min</span></div>
        ${s.description ? `<p style="font-size:13px;color:var(--text-secondary)">${s.description}</p>` : ''}
        <div style="margin-top:12px;font-size:12px;color:var(--text-secondary)">IVA: ${s.iva}%</div>
      </div>`).join('')}
      <div style="border:2px dashed var(--border);border-radius:var(--radius);padding:40px 20px;text-align:center;cursor:pointer" onclick="window._newService()"><i class="fas fa-plus" style="font-size:24px;color:var(--gray-300);margin-bottom:8px"></i><div style="font-size:14px;color:var(--text-secondary)">Añadir servicio</div></div>
      </div></div></div>`;
  }

  function showServiceForm(service = null) {
    const colors = ['#4F46E5','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'];
    openModal(service ? 'Editar Servicio' : 'Nuevo Servicio', `
      <form id="service-form">
        <div class="form-group"><label>Nombre *</label><input type="text" id="sv-name" value="${service?.name || ''}" required></div>
        <div class="form-row"><div class="form-group"><label>Precio (€) *</label><input type="number" id="sv-price" step="0.01" value="${service?.price || ''}" required></div><div class="form-group"><label>Duración (min) *</label><input type="number" id="sv-duration" value="${service?.duration || ''}" required></div></div>
        <div class="form-row"><div class="form-group"><label>IVA (%)</label><input type="number" id="sv-iva" value="${service?.iva ?? 21}"></div><div class="form-group"><label>Confirmación</label><label class="checkbox-row" style="margin-top:8px"><input type="checkbox" id="sv-confirm" ${service?.needs_confirmation ? 'checked' : ''}> Requiere confirmación</label></div></div>
        <div class="form-group"><label>Color</label><div class="color-options">${colors.map(c => `<div class="color-option ${(service?.color || '#4F46E5') === c ? 'selected' : ''}" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.color-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected')"></div>`).join('')}</div></div>
        <div class="form-group"><label>Descripción</label><textarea id="sv-desc" rows="2">${service?.description || ''}</textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn btn-outline" onclick="window._closeModal()">Cancelar</button><button type="submit" class="btn btn-primary">${service ? 'Guardar' : 'Crear'}</button></div>
      </form>`);
    document.getElementById('service-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const color = document.querySelector('.color-option.selected')?.dataset.color || '#4F46E5';
      const body = { name: $('#sv-name').value, price: +$('#sv-price').value, duration: +$('#sv-duration').value, iva: +$('#sv-iva').value, needs_confirmation: $('#sv-confirm').checked, color, description: $('#sv-desc').value };
      try {
        if (service) await api(`/services/${service.id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/services', { method: 'POST', body: JSON.stringify(body) });
        closeModal(); toast('Servicio guardado'); renderServices();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  window._newService = () => showServiceForm();
  window._editService = async (id) => { const svcs = await api('/services'); showServiceForm(svcs.find(s => s.id === id)); };

  // ===================== EMPLOYEES =====================
  async function renderEmployees() {
    $('#content-area').innerHTML = loadingHtml;
    const employees = await api('/employees');
    const allServices = await api('/services');
    const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    $('#content-area').innerHTML = `<div class="fade-in"><div class="card"><div class="card-header"><h3>Empleados</h3><button class="btn btn-primary btn-sm" onclick="window._newEmployee()"><i class="fas fa-plus"></i> Nuevo Empleado</button></div>
      <div class="card-grid card-grid-2">${employees.map(e => `<div style="background:var(--surface);border:2px solid var(--border);border-radius:var(--radius);padding:20px;border-left:4px solid ${e.color}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <div style="width:48px;height:48px;border-radius:50%;background:${e.color};color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700">${e.name?.charAt(0) || '?'}</div>
          <div><h4 style="font-size:16px;font-weight:700;color:var(--text)">${e.name}</h4><div style="font-size:13px;color:var(--text-secondary)">Comisión: ${e.commission}%</div></div>
          <button class="btn-icon" style="margin-left:auto" onclick="window._editEmployee('${e.id}')"><i class="fas fa-edit"></i></button>
        </div>
        <div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">SERVICIOS</div><div style="display:flex;flex-wrap:wrap;gap:4px">${e.services?.map(s => `<span class="badge" style="background:${s.color}20;color:${s.color}">${s.name}</span>`).join('') || '<span style="font-size:13px;color:var(--text-secondary)">Sin servicios</span>'}</div></div>
        <div><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px">HORARIO</div><div style="display:flex;flex-wrap:wrap;gap:4px">${e.schedules?.map(s => `<span class="badge badge-info">${dayNames[s.day_of_week]} ${s.start_time}-${s.end_time}</span>`).join('') || '<span style="font-size:13px;color:var(--text-secondary)">Sin horario</span>'}</div></div>
      </div>`).join('')}</div></div></div>`;
  }

  function showEmployeeForm(employee = null, allServices = []) {
    const colors = ['#10B981','#4F46E5','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316'];
    const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    openModal(employee ? 'Editar Empleado' : 'Nuevo Empleado', `
      <form id="employee-form">
        <div class="form-group"><label>Nombre *</label><input type="text" id="emp-name" value="${employee?.name || ''}" required></div>
        <div class="form-row"><div class="form-group"><label>Comisión (%)</label><input type="number" id="emp-commission" value="${employee?.commission || 0}"></div>
          <div class="form-group"><label>Color</label><div class="color-options">${colors.map(c => `<div class="color-option ${(employee?.color || '#10B981') === c ? 'selected' : ''}" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.color-option').forEach(e=>e.classList.remove('selected'));this.classList.add('selected')"></div>`).join('')}</div></div></div>
        <div class="form-group"><label>Servicios</label><div style="display:flex;flex-wrap:wrap;gap:8px">${allServices.map(s => `<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-size:13px"><input type="checkbox" value="${s.id}" class="emp-service" ${employee?.services?.some(es => es.id === s.id) ? 'checked' : ''}> ${s.name}</label>`).join('')}</div></div>
        <div class="form-group"><label>Horario</label>${dayNames.map((d, i) => { const sched = employee?.schedules?.find(s => s.day_of_week === i); return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><label style="width:100px;font-size:13px;color:var(--text)"><input type="checkbox" class="emp-day" value="${i}" ${sched ? 'checked' : ''}> ${d}</label><input type="time" class="emp-start" value="${sched?.start_time || '09:00'}" style="width:120px;padding:4px 8px;font-size:13px" ${sched ? '' : 'disabled'}><span style="color:var(--text-secondary)">-</span><input type="time" class="emp-end" value="${sched?.end_time || '18:00'}" style="width:120px;padding:4px 8px;font-size:13px" ${sched ? '' : 'disabled'}></div>`; }).join('')}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn btn-outline" onclick="window._closeModal()">Cancelar</button><button type="submit" class="btn btn-primary">${employee ? 'Guardar' : 'Crear'}</button></div>
      </form>`);
    $$('.emp-day').forEach(cb => cb.addEventListener('change', () => { const row = cb.closest('div'); row.querySelector('.emp-start').disabled = !cb.checked; row.querySelector('.emp-end').disabled = !cb.checked; }));
    document.getElementById('employee-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const service_ids = $$('.emp-service:checked').map(cb => cb.value);
      const schedules = []; $$('.emp-day:checked').forEach(cb => { const row = cb.closest('div'); schedules.push({ day_of_week: +cb.value, start_time: row.querySelector('.emp-start').value, end_time: row.querySelector('.emp-end').value }); });
      const body = { name: $('#emp-name').value, color: document.querySelector('.color-option.selected')?.dataset.color || '#10B981', commission: +$('#emp-commission').value, service_ids, schedules };
      try {
        if (employee) await api(`/employees/${employee.id}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/employees', { method: 'POST', body: JSON.stringify(body) });
        closeModal(); toast('Empleado guardado'); renderEmployees();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  window._newEmployee = async () => { const s = await api('/services'); showEmployeeForm(null, s); };
  window._editEmployee = async (id) => { const [emps, svcs] = await Promise.all([api('/employees'), api('/services')]); showEmployeeForm(emps.find(e => e.id === id), svcs); };

  // ===================== AVAILABILITY =====================
  async function renderAvailability() {
    $('#content-area').innerHTML = loadingHtml;
    const [blocked, holidays, employees] = await Promise.all([api('/availability'), api('/availability/holidays'), api('/employees')]);
    const typeLabels = { vacation: 'Vacaciones', holiday: 'Festivo', lunch: 'Comida', meeting: 'Reunión', illness: 'Enfermedad', other: 'Otro' };
    const typeColors = { vacation: 'info', holiday: 'warning', lunch: 'success', meeting: 'purple', illness: 'danger', other: 'warning' };
    $('#content-area').innerHTML = `<div class="fade-in">
      <div class="card" style="margin-bottom:20px"><div class="card-header"><h3>Bloquear horario</h3></div>
        <form id="block-form" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
          <div class="form-group" style="margin:0"><label>Empleado</label><select id="bl-employee"><option value="">Todos</option>${employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select></div>
          <div class="form-group" style="margin:0"><label>Fecha</label><input type="date" id="bl-date" required></div>
          <div class="form-group" style="margin:0"><label>Tipo</label><select id="bl-type"><option value="vacation">Vacaciones</option><option value="holiday">Festivo</option><option value="lunch">Comida</option><option value="meeting">Reunión</option><option value="illness">Enfermedad</option><option value="other">Otro</option></select></div>
          <div class="form-group" style="margin:0"><label>Desde</label><input type="time" id="bl-start"></div>
          <div class="form-group" style="margin:0"><label>Hasta</label><input type="time" id="bl-end"></div>
          <button type="submit" class="btn btn-primary"><i class="fas fa-ban"></i> Bloquear</button>
        </form>
      </div>
      <div class="card-grid card-grid-2">
        <div class="card"><div class="card-header"><h3>Horarios bloqueados</h3></div>
          ${blocked.length ? blocked.map(b => `<div class="alert alert-${typeColors[b.type] || 'info'}" style="justify-content:space-between"><div><strong>${typeLabels[b.type] || b.type}</strong> - ${formatDate(b.date)}${b.start_time ? ` ${b.start_time}-${b.end_time}` : ''}</div><button class="btn-icon" onclick="window._deleteBlocked('${b.id}')"><i class="fas fa-trash"></i></button></div>`).join('') : '<div class="empty-state"><p>Sin bloqueos</p></div>'}
        </div>
        <div class="card"><div class="card-header"><h3>Festivos</h3><button class="btn btn-primary btn-sm" onclick="window._addHoliday()"><i class="fas fa-plus"></i></button></div>
          ${holidays.length ? holidays.map(h => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span>${formatDate(h.date)} - ${h.name || 'Festivo'}</span><button class="btn-icon" onclick="window._deleteHoliday('${h.id}')"><i class="fas fa-trash"></i></button></div>`).join('') : '<div class="empty-state"><p>Sin festivos</p></div>'}
        </div>
      </div></div>`;
    document.getElementById('block-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/availability', { method: 'POST', body: JSON.stringify({ employee_id: $('#bl-employee').value || null, date: $('#bl-date').value, type: $('#bl-type').value, start_time: $('#bl-start').value || null, end_time: $('#bl-end').value || null }) }); toast('Horario bloqueado'); renderAvailability(); } catch (err) { toast(err.message, 'error'); }
    });
  }
  window._deleteBlocked = async (id) => { await api(`/availability/${id}`, { method: 'DELETE' }); toast('Eliminado'); renderAvailability(); };
  window._addHoliday = () => { openModal('Añadir Festivo', `<form id="holiday-form"><div class="form-group"><label>Fecha</label><input type="date" id="hol-date" required></div><div class="form-group"><label>Nombre</label><input type="text" id="hol-name" placeholder="Navidad..."></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-outline" onclick="window._closeModal()">Cancelar</button><button type="submit" class="btn btn-primary">Añadir</button></div></form>`); document.getElementById('holiday-form').addEventListener('submit', async (e) => { e.preventDefault(); await api('/availability/holidays', { method: 'POST', body: JSON.stringify({ date: $('#hol-date').value, name: $('#hol-name').value }) }); closeModal(); toast('Festivo añadido'); renderAvailability(); }); };
  window._deleteHoliday = async (id) => { await api(`/availability/holidays/${id}`, { method: 'DELETE' }); toast('Eliminado'); renderAvailability(); };

  // ===================== LOYALTY =====================
  async function renderLoyalty() {
    $('#content-area').innerHTML = loadingHtml;
    const [leaderboard, settings] = await Promise.all([api('/loyalty/leaderboard'), api('/settings')]);
    $('#content-area').innerHTML = `<div class="fade-in">
      <div class="card-grid card-grid-2" style="margin-bottom:20px">
        <div class="loyalty-card"><div style="font-size:14px;opacity:0.8;margin-bottom:8px">Top Cliente</div><div style="font-size:32px;font-weight:700">${leaderboard[0]?.name || 'N/A'}</div><div style="font-size:18px;opacity:0.9;margin-top:4px">${leaderboard[0]?.points || 0} puntos · ${leaderboard[0]?.visits || 0} visitas</div></div>
        <div class="card"><div class="card-header"><h3>Configuración de fidelización</h3></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:700;color:var(--primary)">${settings.loyalty_points_per_visit || 10}</div><div style="font-size:12px;color:var(--text-secondary)">Puntos por visita</div></div>
          <div style="padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);text-align:center"><div style="font-size:24px;font-weight:700;color:var(--primary)">${settings.loyalty_points_per_euro || 1}</div><div style="font-size:12px;color:var(--text-secondary)">Puntos por €</div></div>
          <div style="padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);text-align:center;grid-column:span 2"><div style="font-size:24px;font-weight:700;color:var(--success)">${settings.loyalty_free_service_threshold || 150}</div><div style="font-size:12px;color:var(--text-secondary)">Puntos para servicio gratis</div></div>
        </div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Clasificación</h3></div><div class="table-wrapper"><table><thead><tr><th>#</th><th>Cliente</th><th>Puntos</th><th>Visitas</th><th>Progreso</th></tr></thead><tbody>${leaderboard.map((c, i) => `<tr><td><strong>${i + 1}</strong></td><td><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:${['#FFD700','#C0C0C0','#CD7F32'][i] || 'var(--primary-bg)'};display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;color:${i < 3 ? 'white' : 'var(--primary)'}">${c.name?.charAt(0) || '?'}</div>${c.name}</div></td><td><span class="badge badge-purple">${c.points} pts</span></td><td>${c.visits}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:var(--gray-200);border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.min(100, (c.points / (settings.loyalty_free_service_threshold || 150)) * 100)}%;background:var(--primary);border-radius:3px"></div></div><span style="font-size:12px;color:var(--text-secondary)">${Math.round((c.points / (settings.loyalty_free_service_threshold || 150)) * 100)}%</span></div></td></tr>`).join('')}</tbody></table></div></div></div>`;
  }

  // ===================== PAYMENTS =====================
  async function renderPayments() {
    $('#content-area').innerHTML = loadingHtml;
    const payments = await api('/payments');
    const total = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const methodLabels = { card: 'Tarjeta', bizum: 'Bizum', cash: 'Efectivo' };
    const methodIcons = { card: 'fa-credit-card', bizum: 'fa-mobile-alt', cash: 'fa-money-bill-wave' };
    $('#content-area').innerHTML = `<div class="fade-in">
      <div class="stat-card" style="margin-bottom:20px"><div style="display:flex;align-items:center;justify-content:space-between"><div><div class="stat-label">Total cobrado</div><div class="stat-value">${formatCurrency(total)}</div></div><div style="font-size:48px;opacity:0.2"><i class="fas fa-euro-sign"></i></div></div></div>
      <div class="card"><div class="card-header"><h3>Historial de pagos</h3><button class="btn btn-primary btn-sm" onclick="window._newPayment()"><i class="fas fa-plus"></i> Registrar pago</button></div>
        <div class="table-wrapper"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Método</th><th>Importe</th></tr></thead><tbody>${payments.map(p => `<tr><td>${formatDate(p.created_at?.split(' ')[0]?.split('T')[0])}</td><td>${p.client_name || '-'}</td><td><span class="badge badge-info"><i class="fas ${methodIcons[p.method] || 'fa-money-bill'}"></i> ${methodLabels[p.method] || p.method}</span></td><td><strong>${formatCurrency(p.amount)}</strong></td></tr>`).join('')}</tbody></table></div></div></div>`;
  }

  window._newPayment = async () => {
    const clients = await api('/clients');
    openModal('Registrar Pago', `<form id="payment-form"><div class="form-group"><label>Cliente *</label><select id="pay-client" required><option value="">Seleccionar...</option>${clients.map(c => `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`).join('')}</select></div><div class="form-row"><div class="form-group"><label>Importe (€) *</label><input type="number" id="pay-amount" step="0.01" required></div><div class="form-group"><label>Método *</label><select id="pay-method" required><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="bizum">Bizum</option></select></div></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-outline" onclick="window._closeModal()">Cancelar</button><button type="submit" class="btn btn-primary">Registrar</button></div></form>`);
    document.getElementById('payment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const clientName = document.getElementById('pay-client').options[document.getElementById('pay-client').selectedIndex]?.dataset?.name || '';
      await api('/payments', { method: 'POST', body: JSON.stringify({ client_id: $('#pay-client').value, client_name: clientName, amount: +$('#pay-amount').value, method: $('#pay-method').value }) });
      closeModal(); toast('Pago registrado'); renderPayments();
    });
  };

  // ===================== REVIEWS =====================
  async function renderReviews() {
    $('#content-area').innerHTML = loadingHtml;
    const reviews = await api('/reviews');
    const avg = await api('/reviews/average');
    $('#content-area').innerHTML = `<div class="fade-in">
      <div class="card-grid card-grid-3" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-star"></i></div><div class="stat-value">${avg.average ? Number(avg.average).toFixed(1) : 'N/A'}</div><div class="stat-label">Valoración media</div></div>
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-comment-dots"></i></div><div class="stat-value">${avg.total || 0}</div><div class="stat-label">Total reseñas</div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-smile"></i></div><div class="stat-value">${reviews.filter(r => r.rating >= 4).length}</div><div class="stat-label">Positivas</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Reseñas</h3></div>
        ${reviews.length ? reviews.map(r => `<div style="padding:16px 0;border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><div style="width:36px;height:36px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;color:var(--primary);font-weight:600">${r.client_name?.charAt(0) || '?'}</div><div style="flex:1"><strong>${r.client_name || 'Anónimo'}</strong><div style="font-size:12px;color:var(--text-secondary)">${formatDate(r.created_at?.split(' ')[0]?.split('T')[0])}</div></div><div class="rating">${[1,2,3,4,5].map(i => `<i class="fas fa-star${i <= r.rating ? ' active' : ''}"></i>`).join('')}</div></div>${r.comment ? `<p style="color:var(--text-secondary);font-size:14px;margin-left:48px">${r.comment}</p>` : ''}</div>`).join('') : '<div class="empty-state"><i class="fas fa-comment-dots"></i><h3>Sin reseñas</h3></div>'}
      </div></div>`;
  }

  // ===================== BOT =====================
  async function renderBot() {
    $('#content-area').innerHTML = loadingHtml;
    const settings = await api('/settings');
    $('#content-area').innerHTML = `<div class="fade-in"><div class="card-grid card-grid-2">
      <div class="card"><div class="card-header"><h3>Configuración del Bot</h3></div>
        <div class="form-group"><label>Plataformas activas</label><div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);cursor:pointer"><input type="checkbox" checked> <i class="fab fa-instagram" style="color:#E4405F;font-size:20px"></i> Instagram Messenger</label>
          <label style="display:flex;align-items:center;gap:8px;padding:12px;background:var(--gray-50);border-radius:var(--radius-sm);cursor:pointer"><input type="checkbox" checked> <i class="fab fa-whatsapp" style="color:#25D366;font-size:20px"></i> WhatsApp Business</label>
        </div></div>
        <div class="form-group"><label>Mensaje de bienvenida</label><textarea rows="3">¡Hola! 👋 Bienvenido a ${currentUser?.business_name || 'nuestro negocio'}. ¿Qué deseas hacer?</textarea></div>
        <div class="form-group"><label>Opciones del menú</label><div style="display:flex;flex-direction:column;gap:8px">
          <input type="text" value="Reservar" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;background:var(--input-bg);color:var(--text)">
          <input type="text" value="Cambiar cita" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;background:var(--input-bg);color:var(--text)">
          <input type="text" value="Cancelar" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;background:var(--input-bg);color:var(--text)">
          <input type="text" value="Ver mis puntos" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:14px;background:var(--input-bg);color:var(--text)">
        </div></div>
        <button class="btn btn-primary btn-full" onclick="toast('Configuración guardada')"><i class="fas fa-save"></i> Guardar</button>
      </div>
      <div class="card"><div class="card-header"><h3>Vista previa</h3></div>
        <div class="bot-preview"><div class="bot-phone"><div class="bot-screen">
          <div class="bot-header"><i class="fas fa-scissors" style="font-size:20px"></i><div><div style="font-weight:600">${currentUser?.business_name || 'Bot'}</div><div style="font-size:11px;opacity:0.8">en línea</div></div></div>
          <div class="bot-messages" id="bot-messages"><div class="bot-msg bot"><div class="bot-msg-bubble">¡Hola! 👋 Bienvenido a ${currentUser?.business_name || 'nuestro negocio'}. Para comenzar, ¿cuál es tu nombre?</div></div></div>
          <div class="bot-input"><input type="text" id="bot-input" placeholder="Escribe un mensaje..." onkeydown="if(event.key==='Enter')window._sendBotMsg()"><button onclick="window._sendBotMsg()"><i class="fas fa-paper-plane"></i></button></div>
        </div></div></div>
        <div style="margin-top:16px;padding:12px;background:var(--info-bg);border-radius:var(--radius-sm);font-size:13px;color:var(--info)"><i class="fas fa-info-circle"></i> El bot registra automáticamente nombre, teléfono y email del cliente durante la conversación.</div>
      </div></div></div>`;
  }

  window._sendBotMsg = async () => {
    const input = document.getElementById('bot-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    const container = document.getElementById('bot-messages');
    container.innerHTML += `<div class="bot-msg user"><div class="bot-msg-bubble">${msg}</div></div>`;
    container.scrollTop = container.scrollHeight;
    try {
      const res = await fetch('/api/bot/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, platform: 'web', client_name: '' }) });
      const data = await res.json();
      setTimeout(() => {
        container.innerHTML += `<div class="bot-msg bot"><div class="bot-msg-bubble">${data.response}</div></div>`;
        container.scrollTop = container.scrollHeight;
      }, 500);
    } catch { }
  };

  // ===================== INTEGRATIONS =====================
  async function renderIntegrations() {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (params.get('gcal') === 'success') { toast('Google Calendar conectado correctamente'); window.location.hash = '#/integrations'; return; }
    if (params.get('gcal') === 'error') { toast(params.get('msg') || 'Error al conectar Google Calendar', 'error'); window.location.hash = '#/integrations'; return; }

    const [gcalStatus, igStatus, waStatus] = await Promise.all([
      api('/integrations/google-calendar/status').catch(() => ({ connected: false })),
      api('/integrations/instagram/status').catch(() => ({ connected: false })),
      api('/integrations/whatsapp/status').catch(() => ({ connected: false }))
    ]);

    $('#content-area').innerHTML = `<div class="fade-in">
      <div style="margin-bottom:24px"><h2 style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:8px">Integraciones</h2><p style="color:var(--text-secondary);font-size:14px">Conecta Gestria con tus herramientas favoritas</p></div>

      <div class="integration-card ${gcalStatus.connected ? 'connected' : ''}">
        <div class="integration-card-header">
          <div class="icon" style="background:#DBEAFE;color:#4285F4"><i class="fab fa-google"></i></div>
          <div class="info"><h4>Google Calendar</h4><p>Sincroniza tus reservas con Google Calendar</p></div>
          <div class="integration-status"><div class="dot ${gcalStatus.connected ? 'on' : 'off'}"></div>${gcalStatus.connected ? 'Conectado' : 'Desconectado'}</div>
        </div>
        ${gcalStatus.connected ? `<div style="padding:8px 12px;background:var(--success-bg);border-radius:var(--radius-sm);font-size:13px;margin-bottom:12px"><i class="fas fa-check-circle" style="color:var(--success)"></i> Calendario: ${gcalStatus.calendar_id}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${gcalStatus.connected ? `<button class="btn btn-danger btn-sm" onclick="window._disconnectGoogleCalendar()"><i class="fas fa-unlink"></i> Desconectar</button><button class="btn btn-primary btn-sm" onclick="window._syncGoogleCalendar()"><i class="fas fa-sync"></i> Sincronizar reservas</button>` : `<button class="btn btn-primary" onclick="window._connectGoogleCalendar()"><i class="fab fa-google"></i> Conectar con Google</button>`}
        </div>
      </div>

      <div class="integration-card ${igStatus.connected ? 'connected' : ''}">
        <div class="integration-card-header">
          <div class="icon" style="background:linear-gradient(135deg,#833AB4,#FD1D1D,#F77737);color:white"><i class="fab fa-instagram"></i></div>
          <div class="info"><h4>Instagram Messenger</h4><p>Bot automático para Instagram</p></div>
          <div class="integration-status"><div class="dot ${igStatus.connected ? 'on' : 'off'}"></div>${igStatus.connected ? 'Conectado' : 'Desconectado'}</div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Page ID</label><input type="text" id="ig-page-id" placeholder="Page ID" value="${igStatus.page_id || ''}"></div>
          <div class="form-group"><label>Access Token</label><input type="password" id="ig-token" placeholder="Page Access Token" value="${igStatus.connected ? '••••••••' : ''}"></div>
        </div>
        ${igStatus.verify_token ? `<div style="margin-bottom:12px;padding:8px 12px;background:var(--success-bg);border-radius:var(--radius-sm);font-size:13px"><strong>Verify Token:</strong> <code>${igStatus.verify_token}</code></div>` : ''}
        <div style="display:flex;gap:8px">
          ${igStatus.connected ? `<button class="btn btn-danger btn-sm" onclick="window._disconnectInstagram()"><i class="fas fa-unlink"></i> Desconectar</button>` : `<button class="btn btn-primary" onclick="window._configureInstagram()"><i class="fas fa-cog"></i> Configurar</button>`}
        </div>
      </div>

      <div class="integration-card ${waStatus.connected ? 'connected' : ''}">
        <div class="integration-card-header">
          <div class="icon" style="background:#25D366;color:white"><i class="fab fa-whatsapp"></i></div>
          <div class="info"><h4>WhatsApp Business</h4><p>Bot automático para WhatsApp</p></div>
          <div class="integration-status"><div class="dot ${waStatus.connected ? 'on' : 'off'}"></div>${waStatus.connected ? 'Conectado' : 'Desconectado'}</div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Phone Number ID</label><input type="text" id="wa-phone-id" placeholder="Phone Number ID" value="${waStatus.phone_number_id || ''}"></div>
          <div class="form-group"><label>Business Account ID</label><input type="text" id="wa-business-id" placeholder="WABA ID" value="${waStatus.business_account_id || ''}"></div>
        </div>
        <div class="form-group"><label>Access Token</label><input type="password" id="wa-token" placeholder="Permanent Access Token" value="${waStatus.connected ? '••••••••' : ''}"></div>
        <div style="display:flex;gap:8px">
          ${waStatus.connected ? `<button class="btn btn-danger btn-sm" onclick="window._disconnectWhatsApp()"><i class="fas fa-unlink"></i> Desconectar</button>` : `<button class="btn btn-primary" onclick="window._configureWhatsApp()"><i class="fas fa-cog"></i> Configurar</button>`}
        </div>
      </div>
    </div>`;
  }

  window._connectGoogleCalendar = () => { window.location.href = `/api/integrations/google-calendar/auth?token=${token}`; };
  window._syncGoogleCalendar = async () => { try { const r = await api('/integrations/google-calendar/sync', { method: 'POST' }); toast(r.message || 'Sincronizado'); } catch (err) { toast(err.message, 'error'); } };
  window._disconnectGoogleCalendar = async () => { await api('/integrations/google-calendar/disconnect', { method: 'POST' }); toast('Google Calendar desconectado'); renderIntegrations(); };

  window._configureInstagram = async () => {
    try {
      const res = await api('/integrations/instagram/configure', { method: 'POST', body: JSON.stringify({ page_id: $('#ig-page-id').value, access_token: $('#ig-token').value }) });
      toast('Instagram configurado. Guarda el verify token.'); renderIntegrations();
    } catch (err) { toast(err.message, 'error'); }
  };
  window._disconnectInstagram = async () => { await api('/integrations/instagram/disconnect', { method: 'POST' }); toast('Instagram desconectado'); renderIntegrations(); };

  window._configureWhatsApp = async () => {
    try {
      await api('/integrations/whatsapp/configure', { method: 'POST', body: JSON.stringify({ phone_number_id: $('#wa-phone-id').value, business_account_id: $('#wa-business-id').value, access_token: $('#wa-token').value }) });
      toast('WhatsApp configurado correctamente'); renderIntegrations();
    } catch (err) { toast(err.message, 'error'); }
  };
  window._disconnectWhatsApp = async () => { await api('/integrations/whatsapp/disconnect', { method: 'POST' }); toast('WhatsApp desconectado'); renderIntegrations(); };

  // ===================== STATS =====================
  async function renderStats() {
    $('#content-area').innerHTML = loadingHtml;
    const [overview, revenue, services, employees, clientStats, heatmap, insights] = await Promise.all([
      api('/stats/overview'), api('/stats/revenue'), api('/stats/services'),
      api('/stats/employees'), api('/stats/clients'), api('/stats/heatmap'), api('/stats/ai-insights')
    ]);
    $('#content-area').innerHTML = `<div class="fade-in">
      <div class="card-grid card-grid-4" style="margin-bottom:24px">
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-euro-sign"></i></div><div class="stat-value">${formatCurrency(overview.currentRevenue)}</div><div class="stat-label">Ingresos este mes</div><div class="stat-change ${overview.revenueChange >= 0 ? 'positive' : 'negative'}">${overview.revenueChange >= 0 ? '+' : ''}${overview.revenueChange || 0}%</div></div>
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-user-plus"></i></div><div class="stat-value">${overview.newClients}</div><div class="stat-label">Clientes nuevos</div></div>
        <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-users"></i></div><div class="stat-value">${overview.recurringClients}</div><div class="stat-label">Recurrentes</div></div>
        <div class="stat-card"><div class="stat-icon yellow"><i class="fas fa-chart-pie"></i></div><div class="stat-value">${overview.occupation}%</div><div class="stat-label">Ocupación</div></div>
      </div>
      <div class="card-grid card-grid-2" style="margin-bottom:24px">
        <div class="card"><div class="card-header"><h3>Ingresos</h3></div><canvas id="revenue-chart" height="200"></canvas></div>
        <div class="card"><div class="card-header"><h3>Servicios</h3></div><canvas id="services-chart" height="200"></canvas></div>
      </div>
      <div class="card-grid card-grid-2" style="margin-bottom:24px">
        <div class="card"><div class="card-header"><h3>Empleados</h3></div><div class="table-wrapper"><table><thead><tr><th>Empleado</th><th>Reservas</th><th>Ingresos</th><th>Valoración</th></tr></thead><tbody>${employees.map(e => `<tr><td><div style="display:flex;align-items:center;gap:8px"><span style="width:10px;height:10px;border-radius:50%;background:${e.color}"></span>${e.name}</div></td><td>${e.total_bookings}</td><td>${formatCurrency(e.revenue)}</td><td>${e.avg_rating ? `⭐ ${Number(e.avg_rating).toFixed(1)}` : '-'}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card"><div class="card-header"><h3>Mapa de calor</h3></div><div class="heatmap">${heatmap.length ? heatmap.map(h => { const max = Math.max(...heatmap.map(x => x.count), 1); const pct = (h.count / max) * 100; const colors = ['#EEF2FF','#C7D2FE','#818CF8','#6366F1','#4F46E5','#3730A3']; const ci = Math.min(5, Math.floor((h.count / max) * 6)); return `<div class="heatmap-row"><div class="heatmap-label">${String(h.hour).padStart(2, '0')}:00</div><div class="heatmap-bar" style="width:${Math.max(pct, 5)}%;background:${colors[ci]}">${h.count}</div></div>`; }).join('') : '<div class="empty-state"><p>Sin datos</p></div>'}</div></div>
      </div>
      <div class="card-grid card-grid-2" style="margin-bottom:24px">
        <div class="card"><div class="card-header"><h3>Clientes</h3></div>
          ${clientStats.topClient ? `<div style="padding:12px;background:var(--warning-bg);border-radius:var(--radius-sm);margin-bottom:12px"><strong>Más frecuente:</strong> ${clientStats.topClient.name} (${clientStats.topClient.visits} visitas)</div>` : ''}
          ${clientStats.vip?.length ? `<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">TOP VIP</div>${clientStats.vip.slice(0, 5).map(c => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span>${c.name}</span><span class="badge badge-purple">${formatCurrency(c.total_spent)}</span></div>`).join('')}</div>` : ''}
          ${clientStats.inactive?.length ? `<div><div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">INACTIVOS (90+ días)</div>${clientStats.inactive.slice(0, 5).map(c => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span>${c.name}</span><span style="font-size:13px;color:var(--text-secondary)">${c.last_visit ? formatDate(c.last_visit) : 'Nunca'}</span></div>`).join('')}</div>` : ''}
        </div>
        <div class="card"><div class="card-header"><h3><i class="fas fa-brain" style="color:var(--primary)"></i> IA del negocio</h3></div>
          ${insights.length ? insights.map(ins => `<div class="insight-card ${ins.type}"><div class="insight-icon"><i class="fas fa-${ins.type === 'opportunity' ? 'lightbulb' : ins.type === 'info' ? 'info-circle' : ins.type === 'warning' ? 'exclamation-triangle' : 'check-circle'}"></i></div><div class="insight-text">${ins.text}</div></div>`).join('') : '<div class="empty-state"><p>Aún no hay datos suficientes</p></div>'}
        </div>
      </div></div>`;
    setTimeout(() => {
      if (revenue.length && document.getElementById('revenue-chart')) {
        charts.revenue = new Chart(document.getElementById('revenue-chart'), { type: 'bar', data: { labels: revenue.map(r => r.label), datasets: [{ label: 'Ingresos', data: revenue.map(r => r.total), backgroundColor: '#4F46E5', borderRadius: 6 }] }, options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
      }
      if (services.length && document.getElementById('services-chart')) {
        charts.services = new Chart(document.getElementById('services-chart'), { type: 'doughnut', data: { labels: services.map(s => s.name), datasets: [{ data: services.map(s => s.count), backgroundColor: services.map(s => s.color || '#4F46E5') }] }, options: { responsive: true, plugins: { legend: { position: 'bottom' } } } });
      }
    }, 100);
  }

  // ===================== SETTINGS =====================
  async function renderSettings() {
    $('#content-area').innerHTML = loadingHtml;
    const s = await api('/settings');
    $('#content-area').innerHTML = `<div class="fade-in"><form id="settings-form"><div class="settings-grid">
      <div class="card">
        <div class="settings-section"><h4><i class="fas fa-store"></i> Datos del negocio</h4>
          <div class="form-group"><label>Nombre</label><input type="text" id="set-business" value="${s.business_name || ''}"></div>
          <div class="form-group"><label>Teléfono</label><input type="tel" id="set-phone" value="${s.phone || ''}"></div>
          <div class="form-group"><label>Email</label><input type="email" id="set-email" value="${s.email || ''}"></div>
          <div class="form-group"><label>Dirección</label><input type="text" id="set-address" value="${s.address || ''}"></div>
        </div>
        <div class="settings-section"><h4><i class="fas fa-palette"></i> Apariencia</h4>
          <div class="form-group"><label>Color principal</label><input type="color" id="set-color" value="${s.primary_color || '#4F46E5'}"></div>
        </div>
        <div class="settings-section"><h4><i class="fas fa-calculator"></i> Fiscal</h4>
          <div class="form-group"><label>IVA (%)</label><input type="number" id="set-iva" value="${s.iva || 21}"></div>
        </div>
      </div>
      <div class="card">
        <div class="settings-section"><h4><i class="fas fa-clock"></i> Reservas</h4>
          <div class="form-row"><div class="form-group"><label>Mín. horas para reservar</label><input type="number" id="set-min-booking" value="${s.min_booking_time || 2}"></div><div class="form-group"><label>Máx. días de antelación</label><input type="number" id="set-max-advance" value="${s.max_advance_days || 30}"></div></div>
          <div class="form-group"><label>Política de cancelación</label><textarea id="set-cancel" rows="2">${s.cancellation_policy || ''}</textarea></div>
        </div>
        <div class="settings-section"><h4><i class="fas fa-star"></i> Fidelización</h4>
          <div class="form-row"><div class="form-group"><label>Puntos/visita</label><input type="number" id="set-pts-visit" value="${s.loyalty_points_per_visit || 10}"></div><div class="form-group"><label>Puntos/€</label><input type="number" id="set-pts-euro" step="0.1" value="${s.loyalty_points_per_euro || 1}"></div></div>
          <div class="form-group"><label>Puntos para gratis</label><input type="number" id="set-pts-threshold" value="${s.loyalty_free_service_threshold || 150}"></div>
        </div>
        <div class="settings-section"><h4><i class="fas fa-bell"></i> Recordatorios</h4>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="set-rem-24" ${s.reminder_24h ? 'checked' : ''}> 24h antes</label>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="set-rem-2" ${s.reminder_2h ? 'checked' : ''}> 2h antes</label>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="set-rem-thanks" ${s.reminder_thank_you ? 'checked' : ''}> Agradecimiento</label>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text)"><input type="checkbox" id="set-rem-inactive" ${s.reminder_inactive ? 'checked' : ''}> Clientes inactivos</label>
          </div>
          <div class="form-group" style="margin-top:12px"><label>Días para inactivo</label><input type="number" id="set-inactive-days" value="${s.inactive_days || 90}"></div>
        </div>
      </div>
    </div><div style="margin-top:20px;display:flex;justify-content:flex-end"><button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button></div></form></div>`;
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/settings', { method: 'PUT', body: JSON.stringify({
          business_name: $('#set-business').value, phone: $('#set-phone').value, email: $('#set-email').value,
          address: $('#set-address').value, primary_color: $('#set-color').value, iva: +$('#set-iva').value,
          min_booking_time: +$('#set-min-booking').value, max_advance_days: +$('#set-max-advance').value,
          cancellation_policy: $('#set-cancel').value, loyalty_points_per_visit: +$('#set-pts-visit').value,
          loyalty_points_per_euro: +$('#set-pts-euro').value, loyalty_free_service_threshold: +$('#set-pts-threshold').value,
          reminder_24h: $('#set-rem-24').checked, reminder_2h: $('#set-rem-2').checked,
          reminder_thank_you: $('#set-rem-thanks').checked, reminder_inactive: $('#set-rem-inactive').checked,
          inactive_days: +$('#set-inactive-days').value
        })});
        toast('Configuración guardada');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // ===================== INIT =====================
  initAuth();
  if (token) showApp();
  initTheme();
})();
