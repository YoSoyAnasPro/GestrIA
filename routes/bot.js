const express = require('express');
const router = express.Router();
const { getDb } = require('../firebase');
const { findOrCreateClient, findClientByPhone, getServices, getBookings, getConversation, createConversation, updateConversation, getSettings, getClients } = require('../database');
const { createBooking, cancelBooking, getClient } = require('../database');

function getLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const BOT_STATES = {
  IDLE: 'idle',
  MENU: 'menu',
  BOOKING_SERVICE: 'booking_service',
  BOOKING_DATE: 'booking_date',
  BOOKING_TIME: 'booking_time',
  BOOKING_EMPLOYEE: 'booking_employee',
  BOOKING_CONFIRM: 'booking_confirm',
  COLLECT_NAME: 'collect_name',
  COLLECT_PHONE: 'collect_phone',
  COLLECT_EMAIL: 'collect_email',
  CHANGE_SELECT: 'change_select',
  CANCEL_SELECT: 'cancel_select',
  VIEWING_POINTS: 'viewing_points'
};

function parseServiceOptions(services) {
  return services.map((s, i) => `${i + 1}️⃣ ${s.name} - ${s.price}€ (${s.duration}min)`).join('\n');
}

async function handleBotMessage(platform, identifier, message, clientName = '', userId = null) {
  const text = message.toLowerCase().trim();

  let conversation = await getConversation(platform, identifier);
  if (!conversation) {
    conversation = await createConversation(platform, identifier, { user_id: userId });
  }

  const state = conversation.state || BOT_STATES.IDLE;
  const data = conversation.collected_data || {};

  if (text === 'menu' || text === '0' || text === 'volver') {
    await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: {} });
    return { response: '¿Qué deseas hacer?\n\n1️⃣ Reservar\n2️⃣ Cambiar cita\n3️⃣ Cancelar\n4️⃣ Ver mis puntos\n\nEscribe el número de la opción.', state: BOT_STATES.MENU };
  }

  if (state === BOT_STATES.IDLE || text === 'hola' || text.startsWith('buen')) {
    let nameStr = clientName ? ` ${clientName}` : '';
    let client = null;
    if (identifier) client = await findClientByPhone(identifier);
    if (client) nameStr = ` ${client.name}`;

    if (!client) {
      await updateConversation(conversation.id, { state: BOT_STATES.COLLECT_NAME, collected_data: { platform, identifier } });
      return { response: `¡Hola${nameStr}! 👋 Bienvenido a nuestro negocio.\n\nPara comenzar, ¿cuál es tu nombre?`, state: BOT_STATES.COLLECT_NAME };
    }

    await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: { client_id: client.id, user_id: client.user_id, name: client.name } });
    return { response: `¡Hola ${client.name}! 👋\n¿Qué deseas hacer?\n\n1️⃣ Reservar\n2️⃣ Cambiar cita\n3️⃣ Cancelar\n4️⃣ Ver mis puntos`, state: BOT_STATES.MENU };
  }

  if (state === BOT_STATES.COLLECT_NAME) {
    data.name = message.trim();
    await updateConversation(conversation.id, { state: BOT_STATES.COLLECT_PHONE, collected_data: data });
    return { response: `Encantado, ${data.name}. 📱 ¿Cuál es tu número de teléfono?`, state: BOT_STATES.COLLECT_PHONE };
  }

  if (state === BOT_STATES.COLLECT_PHONE) {
    data.phone = message.trim();
    await updateConversation(conversation.id, { state: BOT_STATES.COLLECT_EMAIL, collected_data: data });
    return { response: `Perfecto. 📧 ¿Tu email? (escribe "saltar" si prefieres no darlo)`, state: BOT_STATES.COLLECT_EMAIL };
  }

  if (state === BOT_STATES.COLLECT_EMAIL) {
    data.email = text !== 'saltar' ? message.trim() : null;
    const ownerId = data.user_id || userId || conversation.user_id;
    if (ownerId && data.name) {
      const client = await findOrCreateClient(ownerId, { name: data.name, phone: data.phone, email: data.email, whatsapp: identifier, instagram: identifier });
      data.client_id = client.id;
      data.user_id = ownerId;
      await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: data });
    } else {
      await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: data });
    }
    return { response: `¡Perfecto, ${data.name}! ✅ Tu cuenta ha sido creada.\n\n¿Qué deseas hacer?\n\n1️⃣ Reservar\n2️⃣ Cambiar cita\n3️⃣ Cancelar\n4️⃣ Ver mis puntos`, state: BOT_STATES.MENU };
  }

  if (state === BOT_STATES.MENU) {
    if (text === '1' || text.includes('reservar')) {
      const ownerId = data.user_id || userId;
      if (!ownerId) return { response: 'No puedo identificar tu negocio. Contacta con soporte.', state: BOT_STATES.IDLE };
      const services = await getServices(ownerId);
      if (!services.length) return { response: 'Lo siento, no hay servicios disponibles.', state: BOT_STATES.MENU };
      await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_SERVICE, collected_data: { ...data, services_list: services.map(s => ({ id: s.id, name: s.name, price: s.price, duration: s.duration, color: s.color })) } });
      return { response: `¿Qué servicio deseas?\n\n${parseServiceOptions(services)}\n\nEscribe el número:`, state: BOT_STATES.BOOKING_SERVICE };
    }
    if (text === '2' || text.includes('cambiar')) {
      const ownerId = data.user_id || userId;
      if (!ownerId || !data.client_id) return { response: 'No puedo identificarte. Escribe "hola" para comenzar.', state: BOT_STATES.IDLE };
      const bookings = await getBookings(ownerId, {});
      const myBookings = bookings.filter(b => b.client_id === data.client_id && b.status !== 'cancelled' && b.date >= getLocalDate());
      if (!myBookings.length) return { response: 'No tienes reservas pendientes para cambiar.', state: BOT_STATES.MENU };
      const list = myBookings.map((b, i) => `${i + 1}️⃣ ${b.date} ${b.start_time} - ${b.service_name}`).join('\n');
      await updateConversation(conversation.id, { state: BOT_STATES.CHANGE_SELECT, collected_data: { ...data, change_bookings: myBookings.map(b => ({ id: b.id, date: b.date, time: b.start_time, service: b.service_name })) } });
      return { response: `¿Qué cita quieres cambiar?\n\n${list}\n\nEscribe el número:`, state: BOT_STATES.CHANGE_SELECT };
    }
    if (text === '3' || text.includes('cancelar')) {
      const ownerId = data.user_id || userId;
      if (!ownerId || !data.client_id) return { response: 'No puedo identificarte. Escribe "hola" para comenzar.', state: BOT_STATES.IDLE };
      const bookings = await getBookings(ownerId, {});
      const myBookings = bookings.filter(b => b.client_id === data.client_id && b.status !== 'cancelled' && b.date >= getLocalDate());
      if (!myBookings.length) return { response: 'No tienes reservas para cancelar.', state: BOT_STATES.MENU };
      const list = myBookings.map((b, i) => `${i + 1}️⃣ ${b.date} ${b.start_time} - ${b.service_name}`).join('\n');
      await updateConversation(conversation.id, { state: BOT_STATES.CANCEL_SELECT, collected_data: { ...data, cancel_bookings: myBookings.map(b => ({ id: b.id })) } });
      return { response: `¿Qué cita quieres cancelar?\n\n${list}\n\nEscribe el número:`, state: BOT_STATES.CANCEL_SELECT };
    }
    if (text === '4' || text.includes('puntos')) {
      const { getClient } = require('../database');
      if (data.client_id) {
        const client = await getClient(data.user_id || userId, data.client_id);
        if (client) {
          const settings = await getSettings(data.user_id || userId);
          const threshold = settings.loyalty_free_service_threshold || 150;
          const needed = Math.max(0, threshold - (client.points || 0));
          let msg = `${client.name}, tienes ${client.points || 0} puntos. 🌟`;
          if (needed > 0) msg += `\nTe faltan ${needed} para un servicio gratis.`;
          else msg += `\n¡Tienes suficientes para un servicio gratis! 🎉`;
          await updateConversation(conversation.id, { state: BOT_STATES.MENU });
          return { response: msg, state: BOT_STATES.MENU };
        }
      }
      return { response: 'Para consultar tus puntos, primero necesito que te registres. Escribe "hola".', state: BOT_STATES.IDLE };
    }
    return { response: 'No entiendo. Elige una opción:\n\n1️⃣ Reservar\n2️⃣ Cambiar cita\n3️⃣ Cancelar\n4️⃣ Ver mis puntos\n\nEscribe "menu" para volver.', state: BOT_STATES.MENU };
  }

  if (state === BOT_STATES.BOOKING_SERVICE) {
    const idx = parseInt(text) - 1;
    const services = data.services_list || [];
    if (isNaN(idx) || idx < 0 || idx >= services.length) {
      return { response: `Selecciona un número válido del 1 al ${services.length}:\n\n${parseServiceOptions(services)}`, state: BOT_STATES.BOOKING_SERVICE };
    }
    data.selected_service = services[idx];
    await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_DATE, collected_data: data });
    return { response: `${services[idx].name} seleccionado. 📅 ¿Qué día? (ej: 2026-07-25 o "mañana", "lunes")`, state: BOT_STATES.BOOKING_DATE };
  }

  if (state === BOT_STATES.BOOKING_DATE) {
    let date = message.trim();
    if (text === 'mañana' || text === 'manana') {
      const d = new Date(); d.setDate(d.getDate() + 1);
      date = d.toISOString().split('T')[0];
    } else if (text === 'hoy') {
      date = getLocalDate();
    } else if (text === 'pasado mañana' || text === 'pasado manana') {
      const d = new Date(); d.setDate(d.getDate() + 2);
      date = d.toISOString().split('T')[0];
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { response: 'Formato de fecha no válido. Usa YYYY-MM-DD (ej: 2026-07-25) o escribe "mañana", "hoy".', state: BOT_STATES.BOOKING_DATE };
    }
    data.date = date;
    await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_TIME, collected_data: data });
    return { response: `📅 ${date}. ¿A qué hora? (ej: 10:00, 14:30)`, state: BOT_STATES.BOOKING_TIME };
  }

  if (state === BOT_STATES.BOOKING_TIME) {
    if (!/^\d{1,2}:\d{2}$/.test(text)) {
      return { response: 'Formato de hora no válido. Usa HH:MM (ej: 10:00, 14:30).', state: BOT_STATES.BOOKING_TIME };
    }
    data.time = message.trim();
    const ownerId = data.user_id || userId;
    const employees = await getEmployees(ownerId);
    if (employees.length === 1) {
      data.selected_employee = employees[0];
      const svc = data.selected_service;
      const [h, m] = data.time.split(':').map(Number);
      const endMin = h * 60 + m + (svc.duration || 30);
      data.end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_CONFIRM, collected_data: data });
      return { response: `Resumen de tu reserva:\n\n📌 Servicio: ${svc.name}\n📅 Fecha: ${data.date}\n🕐 Hora: ${data.time} - ${data.end_time}\n💈 Empleado: ${employees[0].name}\n💰 Precio: ${svc.price}€\n\n¿Confirmar? (sí/no)`, state: BOT_STATES.BOOKING_CONFIRM };
    }
    const empList = employees.map((e, i) => `${i + 1}️⃣ ${e.name}`).join('\n');
    await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_EMPLOYEE, collected_data: { ...data, employees_list: employees.map(e => ({ id: e.id, name: e.name, color: e.color })) } });
    return { response: `¿Con qué empleado?\n\n${empList}\n\nEscribe el número:`, state: BOT_STATES.BOOKING_EMPLOYEE };
  }

  if (state === BOT_STATES.BOOKING_EMPLOYEE) {
    const idx = parseInt(text) - 1;
    const employees = data.employees_list || [];
    if (isNaN(idx) || idx < 0 || idx >= employees.length) {
      return { response: `Selecciona un número válido del 1 al ${employees.length}:\n\n${employees.map((e, i) => `${i + 1}️⃣ ${e.name}`).join('\n')}`, state: BOT_STATES.BOOKING_EMPLOYEE };
    }
    data.selected_employee = employees[idx];
    const svc = data.selected_service;
    const [h, m] = data.time.split(':').map(Number);
    const endMin = h * 60 + m + (svc.duration || 30);
    data.end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_CONFIRM, collected_data: data });
    return { response: `Resumen de tu reserva:\n\n📌 Servicio: ${svc.name}\n📅 Fecha: ${data.date}\n🕐 Hora: ${data.time} - ${data.end_time}\n💈 Empleado: ${employees[idx].name}\n💰 Precio: ${svc.price}€\n\n¿Confirmar? (sí/no)`, state: BOT_STATES.BOOKING_CONFIRM };
  }

  if (state === BOT_STATES.BOOKING_CONFIRM) {
    if (text === 'sí' || text === 'si' || text === 's' || text === 'confirmar' || text === 'yes') {
      const ownerId = data.user_id || userId;
      if (!ownerId) return { response: 'Error: no se pudo identificar el negocio.', state: BOT_STATES.IDLE };
      try {
        const svc = data.selected_service;
        const emp = data.selected_employee;
        const booking = await createBooking(ownerId, {
          client_id: data.client_id, employee_id: emp.id, service_id: svc.id,
          date: data.date, start_time: data.time, end_time: data.end_time,
          client_name: data.name || 'Cliente Bot', employee_name: emp.name, employee_color: emp.color,
          service_name: svc.name, service_price: svc.price, service_color: svc.color,
          status: 'confirmed', notes: `Reserva via ${conversation.platform}`
        });
        await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: data });
        return { response: `✅ ¡Reserva confirmada!\n\n📌 ${svc.name}\n📅 ${data.date} ${data.time}\n💈 ${emp.name}\n\n¡Te esperamos! 🎉`, state: BOT_STATES.MENU, booking_id: booking.id };
      } catch (err) {
        return { response: `❌ Error al crear la reserva: ${err.message}\n\nEscribe "menu" para volver.`, state: BOT_STATES.MENU };
      }
    }
    if (text === 'no' || text === 'cancelar') {
      await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: {} });
      return { response: 'Reserva cancelada. Escribe "menu" para ver las opciones.', state: BOT_STATES.MENU };
    }
    return { response: '¿Confirmar la reserva? Escribe "sí" o "no".', state: BOT_STATES.BOOKING_CONFIRM };
  }

  if (state === BOT_STATES.CHANGE_SELECT) {
    const idx = parseInt(text) - 1;
    const bookings = data.change_bookings || [];
    if (isNaN(idx) || idx < 0 || idx >= bookings.length) {
      return { response: `Selecciona un número válido del 1 al ${bookings.length}.`, state: BOT_STATES.CHANGE_SELECT };
    }
    data.change_booking = bookings[idx];
    await updateConversation(conversation.id, { state: BOT_STATES.BOOKING_DATE, collected_data: { ...data, services_list: [{ id: null, name: 'Mismo servicio', price: 0, duration: 30 }] } });
    return { response: `Cita: ${bookings[idx].date} ${bookings[idx].time} - ${bookings[idx].service}\n\n📅 Nueva fecha (YYYY-MM-DD):`, state: BOT_STATES.BOOKING_DATE };
  }

  if (state === BOT_STATES.CANCEL_SELECT) {
    const idx = parseInt(text) - 1;
    const bookings = data.cancel_bookings || [];
    if (isNaN(idx) || idx < 0 || idx >= bookings.length) {
      return { response: `Selecciona un número válido del 1 al ${bookings.length}.`, state: BOT_STATES.CANCEL_SELECT };
    }
    try {
      await cancelBooking(data.user_id || userId, bookings[idx].id);
      await updateConversation(conversation.id, { state: BOT_STATES.MENU, collected_data: data });
      return { response: `❌ Reserva cancelada correctamente.\n\nEscribe "menu" para ver las opciones.`, state: BOT_STATES.MENU };
    } catch (err) {
      return { response: `Error al cancelar: ${err.message}`, state: BOT_STATES.MENU };
    }
  }

  await updateConversation(conversation.id, { state: BOT_STATES.IDLE });
  return { response: 'Escribe "hola" para comenzar.', state: BOT_STATES.IDLE };
}

router.post('/webhook', async (req, res) => {
  try {
    const { platform, client_phone, client_name, message, user_id } = req.body;
    const identifier = client_phone || req.body.from || 'web_user';
    const result = await handleBotMessage(platform || 'web', identifier, message, client_name || '', user_id);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message, response: 'Error del sistema. Intenta de nuevo.' }); }
});

router.get('/conversations', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('bot_conversations').orderBy('updated_at', 'desc').limit(50).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.handleBotMessage = handleBotMessage;
