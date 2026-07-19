const bcrypt = require('bcryptjs');
const { getDb } = require('./firebase');

async function seed() {
  const db = getDb();
  console.log('Seeding Gestria Firebase database...');

  const hash = bcrypt.hashSync('123456', 10);
  const userRef = await db.collection('users').add({ name: 'Carlos Rodríguez', email: 'carlos@barberia.com', password: hash, business_name: 'Barbería Style', logo: null, created_at: new Date().toISOString() });
  const userId = userRef.id;

  await db.collection('users').doc(userId).collection('settings').doc('main').set({
    business_name: 'Barbería Style', phone: '612345678', email: 'info@barberia-style.com', address: 'Calle Mayor 15, Madrid',
    primary_color: '#4F46E5', iva: 21, min_booking_time: 2, max_advance_days: 30, cancellation_policy: 'Cancelaciones gratuitas hasta 24h antes.',
    social_instagram: '@barberia_style', social_facebook: '', social_tiktok: '',
    google_calendar_token: '', google_calendar_id: '', instagram_token: '', instagram_verify_token: '', instagram_page_id: '',
    whatsapp_token: '', whatsapp_phone_number_id: '', whatsapp_business_account_id: '',
    loyalty_points_per_visit: 10, loyalty_points_per_euro: 1, loyalty_free_service_threshold: 150,
    reminder_24h: true, reminder_2h: true, reminder_thank_you: true, reminder_inactive: true, inactive_days: 90
  });

  const services = [
    { name: 'Corte clásico', price: 20, duration: 30, color: '#4F46E5', description: 'Corte de pelo con tijera y máquina', iva: 21, needs_confirmation: false },
    { name: 'Barba', price: 12, duration: 20, color: '#10B981', description: 'Perfilado y recorte de barba', iva: 21, needs_confirmation: false },
    { name: 'Corte + Barba', price: 30, duration: 50, color: '#8B5CF6', description: 'Corte completo con barba', iva: 21, needs_confirmation: false },
    { name: 'Corte degradado', price: 22, duration: 35, color: '#F59E0B', description: 'Degradado profesional', iva: 21, needs_confirmation: false },
    { name: 'Diseño de barba', price: 15, duration: 25, color: '#EC4899', description: 'Diseño artístico de barba', iva: 21, needs_confirmation: true },
    { name: 'Cejas', price: 8, duration: 10, color: '#06B6D4', description: 'Recorte de cejas', iva: 21, needs_confirmation: false },
    { name: 'Corte infantil', price: 15, duration: 25, color: '#84CC16', description: 'Corte para niños', iva: 21, needs_confirmation: false },
    { name: 'Afeitado clásico', price: 18, duration: 30, color: '#EF4444', description: 'Afeitado con navaja', iva: 21, needs_confirmation: true },
  ];

  const serviceIds = [];
  for (const s of services) {
    const ref = await db.collection('users').doc(userId).collection('services').add({ ...s, active: true, created_at: new Date().toISOString() });
    serviceIds.push({ id: ref.id, ...s });
  }

  const employees = [
    { name: 'Carlos', color: '#4F46E5', commission: 40, svcIdx: [0, 1, 2, 3, 5, 7] },
    { name: 'Ana', color: '#EC4899', commission: 35, svcIdx: [0, 2, 3, 4, 5] },
    { name: 'Miguel', color: '#10B981', commission: 30, svcIdx: [0, 1, 2, 6] },
    { name: 'Laura', color: '#F59E0B', commission: 35, svcIdx: [0, 2, 4, 5] },
  ];

  const empIds = [];
  for (const e of employees) {
    const ref = await db.collection('users').doc(userId).collection('employees').add({ name: e.name, color: e.color, commission: e.commission, active: true, created_at: new Date().toISOString() });
    empIds.push(ref.id);
    const batch = db.batch();
    for (const si of e.svcIdx) {
      const svc = serviceIds[si];
      batch.set(ref.collection('services').doc(svc.id), { name: svc.name, price: svc.price, duration: svc.duration, color: svc.color });
    }
    for (let d = 1; d <= 5; d++) batch.set(ref.collection('schedules').doc(`day_${d}`), { day_of_week: d, start_time: '09:00', end_time: '20:00' });
    batch.set(ref.collection('schedules').doc('day_6'), { day_of_week: 6, start_time: '09:00', end_time: '15:00' });
    await batch.commit();
  }

  const clients = [
    { name: 'Juan Pérez', phone: '600111222', email: 'juan@email.com', instagram: 'juanperez', whatsapp: '600111222', visits: 37, spent: 1110, points: 370, notes: 'No le gusta la máquina muy corta', preferences: 'Corte degradado, Barba perfilada' },
    { name: 'María García', phone: '600333444', email: 'maria@email.com', instagram: 'mariagarcia', whatsapp: '600333444', visits: 23, spent: 460, points: 230, notes: '', preferences: 'Corte clásico' },
    { name: 'Pedro López', phone: '600555666', email: 'pedro@email.com', instagram: 'pedrolopez', whatsapp: '600555666', visits: 15, spent: 350, points: 150, notes: 'Siempre llega tarde', preferences: 'Corte + Barba' },
    { name: 'Laura Martín', phone: '600777888', email: 'laura@email.com', instagram: 'lauramartin', whatsapp: '600777888', visits: 31, spent: 620, points: 310, notes: 'Alérgica a ciertos productos', preferences: 'Solo corte' },
    { name: 'Carlos Ruiz', phone: '600999000', email: 'carlos.ruiz@email.com', instagram: 'carlosruiz', whatsapp: '600999000', visits: 8, spent: 240, points: 80, notes: '', preferences: 'Corte degradado' },
    { name: 'Ana Torres', phone: '601111222', email: 'ana@email.com', instagram: 'anatorres', whatsapp: '601111222', visits: 42, spent: 840, points: 420, notes: 'Cliente VIP', preferences: 'Corte + Barba premium' },
    { name: 'Miguel Sánchez', phone: '602333444', email: 'miguel@email.com', instagram: 'miguelsan', whatsapp: '602333444', visits: 5, spent: 150, points: 50, notes: '', preferences: '' },
    { name: 'Isabel Díaz', phone: '603555666', email: 'isabel@email.com', instagram: 'isabeldiaz', whatsapp: '603555666', visits: 19, spent: 380, points: 190, notes: '', preferences: 'Corte clásico, Cejas' },
    { name: 'Roberto Navarro', phone: '604777888', email: 'roberto@email.com', instagram: 'robertonavarro', whatsapp: '604777888', visits: 28, spent: 840, points: 280, notes: 'Prefiere por la mañana', preferences: 'Corte + Barba' },
    { name: 'Elena Moreno', phone: '605999000', email: 'elena@email.com', instagram: 'elenamoreno', whatsapp: '605999000', visits: 12, spent: 240, points: 120, notes: '', preferences: 'Solo corte' },
    { name: 'David Jiménez', phone: '606111222', email: 'david@email.com', instagram: 'davidjim', whatsapp: '606111222', visits: 3, spent: 90, points: 30, notes: 'Nuevo cliente', preferences: '' },
    { name: 'Lucía Fernández', phone: '607333444', email: 'lucia@email.com', instagram: 'luciafernandez', whatsapp: '607333444', visits: 16, spent: 320, points: 160, notes: '', preferences: 'Corte degradado' },
  ];

  const clientIds = [];
  for (const c of clients) {
    const firstVisit = new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
    const lastVisit = new Date(2026, 6, Math.floor(Math.random() * 19) + 1);
    const birthday = `${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
    const ref = await db.collection('users').doc(userId).collection('clients').add({
      name: c.name, email: c.email, phone: c.phone, instagram: c.instagram, whatsapp: c.whatsapp,
      first_visit: firstVisit.toISOString().split('T')[0], last_visit: lastVisit.toISOString().split('T')[0],
      visits: c.visits, total_spent: c.spent, points: c.points, notes: c.notes, preferences: c.preferences,
      birthday, created_at: new Date().toISOString()
    });
    clientIds.push({ id: ref.id, ...c });
  }

  const methods = ['card', 'cash', 'bizum'];
  const reviewComments = ['Excelente como siempre!', 'Muy buen servicio', 'Perfecto', 'Buena atención', 'Rápido y profesional', 'Recomendable', 'Impecable', 'Primera vez, satisfecho'];
  const today = new Date();
  let bookingCount = 0;

  for (let daysBack = 30; daysBack >= 0; daysBack--) {
    const date = new Date(today); date.setDate(today.getDate() - daysBack);
    if (date.getDay() === 0) continue;
    const dateStr = date.toISOString().split('T')[0];
    const numBookings = Math.floor(Math.random() * 6) + 5;
    for (let b = 0; b < numBookings; b++) {
      const hour = 9 + Math.floor(Math.random() * 10);
      const minute = Math.random() > 0.5 ? 0 : 30;
      const startTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      const ci = Math.floor(Math.random() * clientIds.length);
      const ei = Math.floor(Math.random() * empIds.length);
      const si = Math.floor(Math.random() * serviceIds.length);
      const svc = serviceIds[si];
      const emp = employees[ei];
      const endMin = hour * 60 + minute + svc.duration;
      const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      const status = daysBack === 0 ? 'confirmed' : Math.random() > 0.1 ? 'completed' : 'cancelled';

      const bookingRef = await db.collection('users').doc(userId).collection('bookings').add({
        client_id: clientIds[ci].id, employee_id: empIds[ei], service_id: serviceIds[si].id,
        date: dateStr, start_time: startTime, end_time: endTime, status,
        client_name: clientIds[ci].name, employee_name: emp.name, employee_color: emp.color,
        service_name: svc.name, service_price: svc.price, service_color: svc.color,
        notes: '', created_at: new Date().toISOString()
      });
      bookingCount++;

      if (status === 'completed') {
        await db.collection('users').doc(userId).collection('payments').add({ booking_id: bookingRef.id, client_id: clientIds[ci].id, client_name: clientIds[ci].name, amount: svc.price, method: methods[Math.floor(Math.random() * 3)], status: 'completed', created_at: new Date().toISOString() });
        if (Math.random() > 0.3) {
          await db.collection('users').doc(userId).collection('reviews').add({ booking_id: bookingRef.id, client_id: clientIds[ci].id, client_name: clientIds[ci].name, rating: [4, 5, 5, 5][Math.floor(Math.random() * 4)], comment: Math.random() > 0.4 ? reviewComments[Math.floor(Math.random() * reviewComments.length)] : null, created_at: new Date().toISOString() });
        }
      }
    }
  }

  await db.collection('users').doc(userId).collection('blocked_times').add({ employee_id: empIds[2], date: '2026-07-25', type: 'vacation', reason: 'Vacaciones de verano', created_at: new Date().toISOString() });
  await db.collection('users').doc(userId).collection('holidays').add({ date: '2026-08-15', name: 'Asunción de la Virgen' });
  await db.collection('users').doc(userId).collection('holidays').add({ date: '2026-10-12', name: 'Fiesta Nacional' });
  await db.collection('users').doc(userId).collection('holidays').add({ date: '2026-12-25', name: 'Navidad' });

  console.log('Firebase database seeded!');
  console.log(`User: carlos@barberia.com / 123456`);
  console.log(`${services.length} services, ${employees.length} employees, ${clients.length} clients, ${bookingCount} bookings`);
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
