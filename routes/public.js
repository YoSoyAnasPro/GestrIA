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

async function loadEmployees(db, userId) {
  const employeesSnap = await db.collection('users').doc(userId).collection('employees').get();
  const employees = [];
  for (const doc of employeesSnap.docs) {
    const data = doc.data();
    if (data.active === false) continue;
    const emp = { id: doc.id, ...data };
    const svcSnap = await db.collection('users').doc(userId).collection('employees').doc(doc.id).collection('services').get();
    emp.services = svcSnap.docs.map(s => ({ id: s.id, ...s.data() }));
    const schSnap = await db.collection('users').doc(userId).collection('employees').doc(doc.id).collection('schedules').get();
    emp.schedules = schSnap.docs.map(s => ({ id: s.id, ...s.data() }));
    employees.push(emp);
  }
  return employees;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^\+?\d{7,15}$/.test(cleaned);
}

function isTimeBlocked(slotStart, slotEnd, blockedTimes) {
  return blockedTimes.some(b => {
    if (!b.start_time || !b.end_time) return false;
    return b.start_time < slotEnd && b.end_time > slotStart;
  });
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

    const employees = await loadEmployees(db, userId);

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

    const holidaysSnap = await db.collection('users').doc(userId).collection('holidays').get();
    const holidayDates = holidaysSnap.docs.map(d => d.data().date);
    if (holidayDates.includes(date)) return res.json({ slots: [] });

    const employees = await loadEmployees(db, userId);

    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    let matchingEmployees = employee_id
      ? employees.filter(e => e.id === employee_id)
      : employees.filter(e => e.services?.some(s => s.id === service_id));

    if (matchingEmployees.length === 0) matchingEmployees = employees;
    if (matchingEmployees.length === 0) return res.json({ slots: [] });

    const blockedSnap = await db.collection('users').doc(userId).collection('blocked_times').get();
    const blockedTimes = blockedSnap.docs.map(d => d.data()).filter(b => {
      if (b.date_end) {
        return date >= b.date && date <= b.date_end;
      }
      if (b.recurring) {
        const blockDow = new Date(b.date + 'T00:00:00').getDay();
        return blockDow === dayOfWeek;
      }
      return b.date === date;
    }).filter(b => !b.employee_id || matchingEmployees.some(e => e.id === b.employee_id));

    const allSlots = {};
    for (const emp of matchingEmployees) {
      const schedule = emp.schedules?.find(s => {
        const dow = typeof s.day_of_week === 'string' ? parseInt(s.day_of_week) : s.day_of_week;
        return dow === dayOfWeek;
      });
      if (!schedule) continue;

      const empBlocked = blockedTimes.filter(b => !b.employee_id || b.employee_id === emp.id);

      const bookingsSnap = await db.collection('users').doc(userId).collection('bookings')
        .where('date', '==', date).where('employee_id', '==', emp.id).get();
      const empBookings = bookingsSnap.docs.map(d => d.data()).filter(b => b.status !== 'cancelled');

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

        const booked = empBookings.some(b => b.start_time < endTime && b.end_time > time);
        const blocked = isTimeBlocked(time, endTime, empBlocked);
        const available = !booked && !blocked;

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

    const phone = (client_phone || '').trim();
    const email = (client_email || '').trim();
    if (!phone && !email) {
      return res.status(400).json({ error: 'Introduce un teléfono o un email de contacto' });
    }
    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ error: 'El número de teléfono no es válido' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'El email no es válido' });
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
      .where('date', '==', date).where('employee_id', '==', empId).get();
    const conflict = bookingsSnap.docs.map(d => d.data()).filter(b => b.status !== 'cancelled').find(b => {
      return b.start_time < end_time && b.end_time > start_time;
    });
    if (conflict) return res.status(400).json({ error: 'Horario no disponible' });

    const blockedSnap = await db.collection('users').doc(userId).collection('blocked_times')
      .where('date', '==', date).get();
    const blockedTimes = blockedSnap.docs.map(d => d.data()).filter(b => !b.employee_id || b.employee_id === empId);
    if (isTimeBlocked(start_time, end_time, blockedTimes)) {
      return res.status(400).json({ error: 'Este horario está bloqueado' });
    }

    let clientId = null;
    if (phone) {
      const clientSnap = await db.collection('users').doc(userId).collection('clients')
        .where('phone', '==', phone).limit(1).get();
      if (!clientSnap.empty) clientId = clientSnap.docs[0].id;
    }
    if (!clientId && email) {
      const clientSnap = await db.collection('users').doc(userId).collection('clients')
        .where('email', '==', email).limit(1).get();
      if (!clientSnap.empty) clientId = clientSnap.docs[0].id;
    }
    if (!clientId) {
      const newClient = await db.collection('users').doc(userId).collection('clients').add({
        name: client_name, phone: phone, email: email,
        visits: 0, total_spent: 0, points: 0, notes: notes || '', created_at: new Date().toISOString()
      });
      clientId = newClient.id;
    }

    await db.collection('users').doc(userId).collection('bookings').add({
      client_id: clientId, client_name, employee_id: empId, employee_name: empName, employee_color: empColor,
      service_id, service_name: svc.name, service_price: svc.price, service_color: svc.color || '#4F46E5', service_duration: svc.duration || 30,
      date, start_time, end_time, status: 'confirmed', notes: notes || '', source: 'web',
      client_phone: phone, client_email: email,
      created_at: new Date().toISOString()
    });

    res.json({ success: true, message: 'Reserva confirmada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
