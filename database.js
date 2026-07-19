const { getDb } = require('./firebase');
const bcrypt = require('bcryptjs');

const db = () => getDb();

// ===================== AUTH =====================
async function createUser(name, email, password, business_name) {
  const hash = bcrypt.hashSync(password, 10);
  const ref = await db().collection('users').add({ name, email, password: hash, business_name, logo: null, created_at: new Date().toISOString() });
  const settingsRef = db().collection('users').doc(ref.id).collection('settings').doc('main');
  await settingsRef.set({
    business_name, phone: '', email, address: '', primary_color: '#4F46E5', iva: 21,
    min_booking_time: 2, max_advance_days: 30, cancellation_policy: '',
    social_instagram: '', social_facebook: '', social_tiktok: '',
    google_calendar_token: '', google_calendar_id: '',
    instagram_token: '', instagram_verify_token: '', instagram_page_id: '',
    whatsapp_token: '', whatsapp_phone_number_id: '', whatsapp_business_account_id: '',
    loyalty_points_per_visit: 10, loyalty_points_per_euro: 1, loyalty_free_service_threshold: 150,
    reminder_24h: true, reminder_2h: true, reminder_thank_you: true, reminder_inactive: true, inactive_days: 90
  });
  return { id: ref.id, name, email, business_name };
}

async function getUserByEmail(email) {
  const snap = await db().collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getUserById(id) {
  const doc = await db().collection('users').doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// ===================== CLIENTS =====================
async function getClients(userId, search = '') {
  let ref = db().collection('users').doc(userId).collection('clients');
  const snap = await ref.get();
  let clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (search) {
    const s = search.toLowerCase();
    clients = clients.filter(c => c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.phone?.includes(s));
  }
  return clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function getClient(userId, clientId) {
  const doc = await db().collection('users').doc(userId).collection('clients').doc(clientId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

async function createClient(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('clients').add({ ...data, visits: 0, total_spent: 0, points: 0, first_visit: null, last_visit: null, created_at: new Date().toISOString() });
  return { id: ref.id, ...data, visits: 0, total_spent: 0, points: 0 };
}

async function updateClient(userId, clientId, data) {
  await db().collection('users').doc(userId).collection('clients').doc(clientId).update(data);
  return await getClient(userId, clientId);
}

async function deleteClient(userId, clientId) {
  await db().collection('users').doc(userId).collection('clients').doc(clientId).delete();
}

async function findClientByPhone(phone) {
  const usersSnap = await db().collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const clientsSnap = await db().collection('users').doc(userDoc.id).collection('clients').where('phone', '==', phone).limit(1).get();
    if (!clientsSnap.empty) {
      const doc = clientsSnap.docs[0];
      return { id: doc.id, user_id: userDoc.id, ...doc.data() };
    }
    const clientsSnap2 = await db().collection('users').doc(userDoc.id).collection('clients').where('whatsapp', '==', phone).limit(1).get();
    if (!clientsSnap2.empty) {
      const doc = clientsSnap2.docs[0];
      return { id: doc.id, user_id: userDoc.id, ...doc.data() };
    }
  }
  return null;
}

async function findOrCreateClient(userId, data) {
  if (data.phone) {
    const existing = await db().collection('users').doc(userId).collection('clients').where('phone', '==', data.phone).limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      await doc.ref.update({ name: data.name || doc.data().name, email: data.email || doc.data().email, whatsapp: data.whatsapp || doc.data().whatsapp, instagram: data.instagram || doc.data().instagram });
      return { id: doc.id, ...doc.data(), ...data };
    }
  }
  return await createClient(userId, data);
}

// ===================== SERVICES =====================
async function getServices(userId) {
  const snap = await db().collection('users').doc(userId).collection('services').where('active', '==', true).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function createService(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('services').add({ ...data, active: true, created_at: new Date().toISOString() });
  return { id: ref.id, ...data, active: true };
}

async function updateService(userId, serviceId, data) {
  await db().collection('users').doc(userId).collection('services').doc(serviceId).update(data);
  const doc = await db().collection('users').doc(userId).collection('services').doc(serviceId).get();
  return { id: doc.id, ...doc.data() };
}

async function deleteService(userId, serviceId) {
  await db().collection('users').doc(userId).collection('services').doc(serviceId).update({ active: false });
}

// ===================== EMPLOYEES =====================
async function getEmployees(userId) {
  const snap = await db().collection('users').doc(userId).collection('employees').where('active', '==', true).get();
  const employees = [];
  for (const doc of snap.docs) {
    const emp = { id: doc.id, ...doc.data() };
    const svcSnap = await db().collection('users').doc(userId).collection('employees').doc(doc.id).collection('services').get();
    emp.services = svcSnap.docs.map(s => ({ id: s.id, ...s.data() }));
    const schSnap = await db().collection('users').doc(userId).collection('employees').doc(doc.id).collection('schedules').get();
    emp.schedules = schSnap.docs.map(s => ({ id: s.id, ...s.data() })).sort((a, b) => (a.day_of_week || 0) - (b.day_of_week || 0));
    employees.push(emp);
  }
  return employees;
}

async function createEmployee(userId, data) {
  const { service_ids, schedules, ...empData } = data;
  const ref = await db().collection('users').doc(userId).collection('employees').add({ ...empData, active: true, created_at: new Date().toISOString() });
  if (service_ids?.length) {
    const servicesSnap = await db().collection('users').doc(userId).collection('services').get();
    const serviceMap = {};
    servicesSnap.docs.forEach(s => { serviceMap[s.data().name] = s.id; });
    const batch = db().batch();
    for (const sid of service_ids) {
      const svcDoc = await db().collection('users').doc(userId).collection('services').doc(sid).get();
      if (svcDoc.exists) {
        batch.set(ref.collection('services').doc(sid), { name: svcDoc.data().name, price: svcDoc.data().price, duration: svcDoc.data().duration, color: svcDoc.data().color });
      }
    }
    await batch.commit();
  }
  if (schedules?.length) {
    const batch = db().batch();
    for (const s of schedules) {
      batch.set(ref.collection('schedules').doc(`day_${s.day_of_week}`), s);
    }
    await batch.commit();
  }
  return { id: ref.id, ...empData };
}

async function updateEmployee(userId, employeeId, data) {
  const { service_ids, schedules, ...empData } = data;
  await db().collection('users').doc(userId).collection('employees').doc(employeeId).update(empData);
  if (service_ids !== undefined) {
    const existing = await db().collection('users').doc(userId).collection('employees').doc(employeeId).collection('services').get();
    const batch = db().batch();
    existing.docs.forEach(d => batch.delete(d.ref));
    for (const sid of service_ids) {
      const svcDoc = await db().collection('users').doc(userId).collection('services').doc(sid).get();
      if (svcDoc.exists) {
        batch.set(db().collection('users').doc(userId).collection('employees').doc(employeeId).collection('services').doc(sid), { name: svcDoc.data().name, price: svcDoc.data().price, duration: svcDoc.data().duration, color: svcDoc.data().color });
      }
    }
    await batch.commit();
  }
  if (schedules !== undefined) {
    const existing = await db().collection('users').doc(userId).collection('employees').doc(employeeId).collection('schedules').get();
    const batch = db().batch();
    existing.docs.forEach(d => batch.delete(d.ref));
    for (const s of schedules) {
      batch.set(db().collection('users').doc(userId).collection('employees').doc(employeeId).collection('schedules').doc(`day_${s.day_of_week}`), s);
    }
    await batch.commit();
  }
}

async function deleteEmployee(userId, employeeId) {
  await db().collection('users').doc(userId).collection('employees').doc(employeeId).update({ active: false });
}

// ===================== BOOKINGS =====================
async function getBookings(userId, filters = {}) {
  let ref = db().collection('users').doc(userId).collection('bookings');
  const snap = await ref.get();
  let bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (filters.date) bookings = bookings.filter(b => b.date === filters.date);
  if (filters.start_date && filters.end_date) bookings = bookings.filter(b => b.date >= filters.start_date && b.date <= filters.end_date);
  if (filters.employee_id) bookings = bookings.filter(b => b.employee_id === filters.employee_id);
  if (filters.service_id) bookings = bookings.filter(b => b.service_id === filters.service_id);
  return bookings;
}

async function createBooking(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('bookings').add({ ...data, status: data.status || 'confirmed', created_at: new Date().toISOString() });
  return { id: ref.id, ...data };
}

async function updateBooking(userId, bookingId, data) {
  await db().collection('users').doc(userId).collection('bookings').doc(bookingId).update(data);
}

async function cancelBooking(userId, bookingId) {
  await db().collection('users').doc(userId).collection('bookings').doc(bookingId).update({ status: 'cancelled' });
}

// ===================== BLOCKED TIMES =====================
async function getBlockedTimes(userId, filters = {}) {
  let ref = db().collection('users').doc(userId).collection('blocked_times');
  const snap = await ref.get();
  let blocked = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (filters.employee_id) blocked = blocked.filter(b => b.employee_id === filters.employee_id);
  if (filters.date) blocked = blocked.filter(b => b.date === filters.date);
  return blocked;
}

async function createBlockedTime(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('blocked_times').add({ ...data, created_at: new Date().toISOString() });
  return { id: ref.id, ...data };
}

async function deleteBlockedTime(userId, blockedId) {
  await db().collection('users').doc(userId).collection('blocked_times').doc(blockedId).delete();
}

// ===================== HOLIDAYS =====================
async function getHolidays(userId) {
  const snap = await db().collection('users').doc(userId).collection('holidays').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

async function createHoliday(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('holidays').add(data);
  return { id: ref.id, ...data };
}

async function deleteHoliday(userId, holidayId) {
  await db().collection('users').doc(userId).collection('holidays').doc(holidayId).delete();
}

// ===================== PAYMENTS =====================
async function getPayments(userId, filters = {}) {
  let ref = db().collection('users').doc(userId).collection('payments');
  const snap = await ref.get();
  let payments = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  if (filters.start_date && filters.end_date) {
    payments = payments.filter(p => p.created_at >= filters.start_date && p.created_at <= filters.end_date + ' 23:59:59');
  }
  return payments;
}

async function createPayment(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('payments').add({ ...data, status: 'completed', created_at: new Date().toISOString() });
  return { id: ref.id, ...data };
}

// ===================== REVIEWS =====================
async function getReviews(userId) {
  const snap = await db().collection('users').doc(userId).collection('reviews').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function createReview(userId, data) {
  const ref = await db().collection('users').doc(userId).collection('reviews').add({ ...data, created_at: new Date().toISOString() });
  return { id: ref.id, ...data };
}

// ===================== SETTINGS =====================
async function getSettings(userId) {
  const doc = await db().collection('users').doc(userId).collection('settings').doc('main').get();
  if (!doc.exists) return {};
  return { id: doc.id, ...doc.data() };
}

async function updateSettings(userId, data) {
  await db().collection('users').doc(userId).collection('settings').doc('main').update(data);
}

// ===================== BOT CONVERSATIONS =====================
async function getConversation(platform, identifier) {
  const snap = await db().collection('bot_conversations').where('platform', '==', platform).where('identifier', '==', identifier).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function createConversation(platform, identifier, data = {}) {
  const ref = await db().collection('bot_conversations').add({ platform, identifier, state: 'idle', collected_data: {}, messages: [], ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return { id: ref.id, platform, identifier, state: 'idle', collected_data: {}, ...data };
}

async function updateConversation(convId, data) {
  await db().collection('bot_conversations').doc(convId).update({ ...data, updated_at: new Date().toISOString() });
}

// ===================== STATS =====================
async function getStatsOverview(userId) {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const paymentsSnap = await db().collection('users').doc(userId).collection('payments').where('created_at', '>=', monthStart).where('created_at', '<=', monthEnd + ' 23:59:59').get();
  const currentRevenue = paymentsSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
  const clientsSnap = await db().collection('users').doc(userId).collection('clients').where('created_at', '>=', monthStart).get();
  const newClients = clientsSnap.size;
  const bookingsSnap = await db().collection('users').doc(userId).collection('bookings').where('date', '>=', monthStart).where('date', '<=', monthEnd).get();
  const completedBookings = bookingsSnap.docs.filter(d => d.data().status === 'completed');
  const uniqueClients = new Set(completedBookings.map(d => d.data().client_id)).size;
  const employeesSnap = await db().collection('users').doc(userId).collection('employees').where('active', '==', true).get();
  const schedulesSnap = await db().collection('users').doc(userId).collection('employees').doc('x').collection('schedules').get().catch(() => null);
  let totalSlots = employeesSnap.size * 10 * 7;
  const occupation = totalSlots > 0 ? Math.min(100, Math.round((completedBookings.length / Math.max(totalSlots, 1)) * 100)) : 0;
  return { currentRevenue, newClients, recurringClients: uniqueClients, occupation };
}

async function getAIInsights(userId) {
  const insights = [];
  const bookingsSnap = await db().collection('users').doc(userId).collection('bookings').get();
  const bookings = bookingsSnap.docs.map(d => d.data());
  const completed = bookings.filter(b => b.status !== 'cancelled');
  const total = completed.length;
  if (total === 0) return insights;

  const serviceCount = {};
  completed.forEach(b => { serviceCount[b.service_name] = (serviceCount[b.service_name] || 0) + 1; });
  const sorted = Object.entries(serviceCount).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    insights.push({ type: 'info', text: `El servicio "${sorted[0][0]}" representa el ${Math.round((sorted[0][1] / total) * 100)}% de tus reservas.` });
  }

  const hourCount = {};
  completed.forEach(b => { const h = b.start_time?.split(':')[0]; if (h) hourCount[h] = (hourCount[h] || 0) + 1; });
  const sortedHours = Object.entries(hourCount).sort((a, b) => a[1] - b[1]);
  if (sortedHours.length > 0) {
    insights.push({ type: 'opportunity', text: `La franja ${sortedHours[0][0]}:00-${parseInt(sortedHours[0][0]) + 2}:00 tiene menor ocupación. Considera ofrecer un descuento.` });
  }

  const empCount = {};
  completed.forEach(b => { if (b.employee_name) empCount[b.employee_name] = (empCount[b.employee_name] || 0) + 1; });
  const sortedEmp = Object.entries(empCount).sort((a, b) => b[1] - a[1]);
  if (sortedEmp.length > 0) {
    insights.push({ type: 'success', text: `${sortedEmp[0][0]} tiene la mayor cantidad de clientes atendidos (${sortedEmp[0][1]}).` });
  }

  const clientsSnap = await db().collection('users').doc(userId).collection('clients').get();
  const clients = clientsSnap.docs.map(d => d.data());
  const inactive = clients.filter(c => c.last_visit && (new Date() - new Date(c.last_visit)) > 90 * 86400000);
  if (inactive.length > 0) {
    insights.push({ type: 'warning', text: `Hay ${inactive.length} clientes que no visitan desde hace más de 90 días. Puedes enviarles una promoción.` });
  }

  return insights;
}

module.exports = {
  createUser, getUserByEmail, getUserById,
  getClients, getClient, createClient, updateClient, deleteClient, findClientByPhone, findOrCreateClient,
  getServices, createService, updateService, deleteService,
  getEmployees, createEmployee, updateEmployee, deleteEmployee,
  getBookings, createBooking, updateBooking, cancelBooking,
  getBlockedTimes, createBlockedTime, deleteBlockedTime,
  getHolidays, createHoliday, deleteHoliday,
  getPayments, createPayment,
  getReviews, createReview,
  getSettings, updateSettings,
  getConversation, createConversation, updateConversation,
  getStatsOverview, getAIInsights
};
