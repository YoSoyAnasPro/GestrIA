const express = require('express');
const router = express.Router();
const { getDb } = require('../firebase');

async function findUserBySlug(db, slug) {
  let snap = await db.collection('users').where('business_slug', '==', slug).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  const allUsers = await db.collection('users').get();
  for (const doc of allUsers.docs) {
    const data = doc.data();
    const nameSlug = (data.business_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (nameSlug === slug) {
      await db.collection('users').doc(doc.id).update({ business_slug: slug });
      return doc.id;
    }
  }
  return null;
}

router.get('/:slug', async (req, res) => {
  try {
    const db = getDb();
    const userId = await findUserBySlug(db, req.params.slug);
    if (!userId) return res.status(404).json({ error: 'Negocio no encontrado' });

    const settingsDoc = await db.collection('users').doc(userId).collection('settings').doc('main').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};

    const servicesSnap = await db.collection('users').doc(userId).collection('services').get();
    const services = servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const employeesSnap = await db.collection('users').doc(userId).collection('employees').where('active', '==', true).get();
    const employees = [];
    for (const doc of employeesSnap.docs) {
      const emp = { id: doc.id, ...doc.data() };
      const svcSnap = await db.collection('users').doc(userId).collection('employees').doc(doc.id).collection('services').get();
      emp.services = svcSnap.docs.map(s => ({ id: s.id, ...s.data() }));
      const schSnap = await db.collection('users').doc(userId).collection('employees').doc(doc.id).collection('schedules').get();
      emp.schedules = schSnap.docs.map(s => ({ id: s.id, ...s.data() })).sort((a, b) => (a.day_of_week || 0) - (b.day_of_week || 0));
      employees.push(emp);
    }

    res.json({ settings: { business_name: settings.business_name, address: settings.address, phone: settings.phone, primary_color: settings.primary_color }, services, employees });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:slug/slots', async (req, res) => {
  try {
    const db = getDb();
    const userId = await findUserBySlug(db, req.params.slug);
    if (!userId) return res.status(404).json({ error: 'Negocio no encontrado' });
    const { date, service_id, employee_id } = req.query;

    const servicesSnap = await db.collection('users').doc(userId).collection('services').get();
    const services = servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const service = services.find(s => s.id === service_id);
    if (!service) return res.status(400).json({ error: 'Servicio no encontrado' });

    const employeesSnap = await db.collection('users').doc(userId).collection('employees').where('active', '==', true).get();
    const employees = [];
    for (const doc of employeesSnap.docs) {
      const emp = { id: doc.id, ...doc.data() };
      const svcSnap = await db.collection('users').doc(userId).collection('employees').doc(doc.id).collection('services').get();
      emp.services = svcSnap.docs.map(s => ({ id: s.id, ...s.data() }));
      const schSnap = await db.collection('users').doc(userId).collection('employees').doc(doc.id).collection('schedules').get();
      emp.schedules = schSnap.docs.map(s => ({ id: s.id, ...s.data() }));
      employees.push(emp);
    }

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    let matchingEmployees = employee_id ? employees.filter(e => e.id === employee_id) : employees.filter(e => e.services?.some(s => s.id === service_id));

    if (matchingEmployees.length === 0) matchingEmployees = employees;
    if (matchingEmployees.length === 0) return res.json({ slots: [] });

    const allSlots = {};
    for (const emp of matchingEmployees) {
      const schedule = emp.schedules?.find(s => s.day_of_week === dayOfWeek);
      if (!schedule) continue;

      const empBookingsSnap = await db.collection('users').doc(userId).collection('bookings')
        .where('date', '==', date).where('employee_id', '==', emp.id).where('status', '!=', 'cancelled').get();
      const empBookings = empBookingsSnap.docs.map(d => d.data());

      const [sh, sm] = schedule.start_time.split(':').map(Number);
      const [eh, em] = schedule.end_time.split(':').map(Number);
      const duration = service.duration || 30;

      for (let min = sh * 60 + sm; min + duration <= eh * 60 + em; min += 30) {
        const h = String(Math.floor(min / 60)).padStart(2, '0');
        const m = String(min % 60).padStart(2, '0');
        const time = `${h}:${m}`;
        const endMin = min + duration;
        const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
        const endM = String(endMin % 60).padStart(2, '0');
        const endTime = `${endH}:${endM}`;
        const available = !empBookings.some(b => b.start_time < endTime && b.end_time > time);
        if (!allSlots[time]) allSlots[time] = { time, available };
        else if (!available) allSlots[time].available = false;
      }
    }

    const slots = Object.values(allSlots).sort((a, b) => a.time.localeCompare(b.time));

    res.json({ slots });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:slug/book', async (req, res) => {
  try {
    const db = getDb();
    const userId = await findUserBySlug(db, req.params.slug);
    if (!userId) return res.status(404).json({ error: 'Negocio no encontrado' });
    const { client_name, client_phone, client_email, notes, service_id, employee_id, date, start_time } = req.body;

    if (!client_name || !service_id || !date || !start_time) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const serviceDoc = await db.collection('users').doc(userId).collection('services').doc(service_id).get();
    if (!serviceDoc.exists) return res.status(400).json({ error: 'Servicio no encontrado' });
    const svc = serviceDoc.data();

    const empId = employee_id || null;
    let empName = '', empColor = '#10B981';
    if (empId) {
      const empDoc = await db.collection('users').doc(userId).collection('employees').doc(empId).get();
      if (empDoc.exists) {
        empName = empDoc.data().name;
        empColor = empDoc.data().color || '#10B981';
      }
    }

    const [h, m] = start_time.split(':').map(Number);
    const endMin = h * 60 + m + (svc.duration || 30);
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    const bookingsSnap = await db.collection('users').doc(userId).collection('bookings')
      .where('date', '==', date).where('employee_id', '==', empId).where('status', '!=', 'cancelled').get();
    const conflict = bookingsSnap.docs.find(d => {
      const b = d.data();
      return b.start_time < end_time && b.end_time > start_time;
    });
    if (conflict) return res.status(400).json({ error: 'Horario no disponible' });

    let clientId = null;
    if (client_phone) {
      const clientSnap = await db.collection('users').doc(userId).collection('clients')
        .where('phone', '==', client_phone).limit(1).get();
      if (!clientSnap.empty) clientId = clientSnap.docs[0].id;
    }
    if (!clientId && client_email) {
      const clientSnap = await db.collection('users').doc(userId).collection('clients')
        .where('email', '==', client_email).limit(1).get();
      if (!clientSnap.empty) clientId = clientSnap.docs[0].id;
    }
    if (!clientId) {
      const newClient = await db.collection('users').doc(userId).collection('clients').add({
        name: client_name, phone: client_phone || '', email: client_email || '',
        visits: 0, total_spent: 0, points: 0, notes: notes || '', created_at: new Date().toISOString()
      });
      clientId = newClient.id;
    }

    await db.collection('users').doc(userId).collection('bookings').add({
      client_id: clientId, client_name, employee_id: empId, employee_name: empName, employee_color: empColor,
      service_id, service_name: svc.name, service_price: svc.price, service_color: svc.color || '#4F46E5', service_duration: svc.duration || 30,
      date, start_time, end_time, status: 'confirmed', notes: notes || '', source: 'web', created_at: new Date().toISOString()
    });

    res.json({ success: true, message: 'Reserva confirmada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
