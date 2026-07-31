function renderSubscriptionPage(container, api, currentUser, toast) {
  container.innerHTML = `
    <div class="fade-in">
      <div id="sub-loading" style="display:flex;flex-direction:column;gap:16px;padding:16px">
        <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div>
        <div class="skeleton-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div>
      </div>
      <div id="sub-content" style="display:none"></div>
    </div>
  `;

  loadSubscriptionData(container, api, currentUser, toast);
}

async function loadSubscriptionData(container, api, currentUser, toast) {
  try {
    const statusData = await api('/subscriptions/status');
    let invoicesData = { invoices: [] };
    if (statusData.has_subscription) {
      try { invoicesData = await api('/subscriptions/invoices'); } catch {}
    }
    renderSubscriptionContent(container, statusData, invoicesData, api, currentUser, toast);
  } catch (err) {
    document.getElementById('sub-loading').style.display = 'none';
    document.getElementById('sub-content').style.display = '';
    document.getElementById('sub-content').innerHTML = `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <i class="fas fa-exclamation-triangle" style="color:white;font-size:24px"></i>
        </div>
        <h3 style="color:var(--text);margin-bottom:8px">No se pudo cargar la información</h3>
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px">${err.message}</p>
        <button class="btn btn-primary" onclick="location.reload()"><i class="fas fa-redo"></i> Reintentar</button>
      </div>`;
  }
}

function renderSubscriptionContent(container, statusData, invoicesData, api, currentUser, toast) {
  const loading = document.getElementById('sub-loading');
  const content = document.getElementById('sub-content');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = '';

  const status = statusData.status || 'inactive';
  const hasSub = statusData.has_subscription;

  const statusConfig = {
    active: { label: 'Activa', color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: 'fa-check-circle' },
    trialing: { label: 'Período de prueba', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: 'fa-flask' },
    past_due: { label: 'Pago pendiente', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: 'fa-exclamation-circle' },
    canceled: { label: 'Cancelada', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: 'fa-times-circle' },
    unpaid: { label: 'Impagada', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: 'fa-exclamation-triangle' },
    incomplete: { label: 'Pendiente', color: '#6366f1', bg: 'rgba(99,102,241,0.1)', icon: 'fa-hourglass-half' },
    inactive: { label: 'Sin suscripción', color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: 'fa-ban' },
  };

  const sc = statusConfig[status] || statusConfig.inactive;
  const isActive = ['active', 'trialing'].includes(status);
  const isCanceled = ['canceled', 'unpaid'].includes(status);
  const cancelPending = statusData.cancel_at_period_end;

  const formatAmount = (cents) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
  const formatDate = (d) => {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  let html = '';

  // Subscription Status Card
  html += `
    <div class="card" style="margin-bottom:24px;border:1px solid ${sc.color}20;overflow:hidden">
      <div style="background:${sc.bg};padding:24px 28px;display:flex;align-items:center;gap:16px;border-bottom:1px solid ${sc.color}20">
        <div style="width:48px;height:48px;border-radius:50%;background:${sc.color};display:flex;align-items:center;justify-content:center">
          <i class="fas ${sc.icon}" style="color:white;font-size:20px"></i>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;font-weight:600">Estado de la suscripción</div>
          <div style="font-size:22px;font-weight:800;color:${sc.color};letter-spacing:-0.5px">${sc.label}</div>
        </div>
        ${cancelPending ? `<div style="background:#fef3c7;color:#92400e;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600"><i class="fas fa-clock" style="margin-right:6px"></i>Se cancela el ${formatDate(statusData.current_period_end)}</div>` : ''}
      </div>`;

  if (hasSub && status !== 'inactive') {
    html += `
      <div style="padding:24px 28px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:20px">
          <div>
            <div style="font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">Plan</div>
            <div style="font-size:16px;font-weight:700;color:var(--text)">Gestria Pro</div>
            <div style="font-size:13px;color:var(--text-secondary)">49,99 €/mes</div>
          </div>
          <div>
            <div style="font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">Período actual</div>
            <div style="font-size:14px;font-weight:600;color:var(--text)">${formatDate(statusData.current_period_start)}</div>
            <div style="font-size:13px;color:var(--text-secondary)">hasta ${formatDate(statusData.current_period_end)}</div>
          </div>
          ${statusData.payment_method_brand ? `
          <div>
            <div style="font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">Método de pago</div>
            <div style="display:flex;align-items:center;gap:8px">
              <i class="fab fa-cc-${statusData.payment_method_brand}" style="font-size:24px;color:var(--text)"></i>
              <div>
                <div style="font-size:14px;font-weight:600;color:var(--text)">${statusData.payment_method_brand.charAt(0).toUpperCase() + statusData.payment_method_brand.slice(1)}</div>
                <div style="font-size:13px;color:var(--text-secondary)">**** ${statusData.payment_method_last4}</div>
              </div>
            </div>
          </div>` : ''}
          ${statusData.last_payment_status ? `
          <div>
            <div style="font-size:12px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:6px">Último pago</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="width:8px;height:8px;border-radius:50%;background:${statusData.last_payment_status === 'succeeded' ? '#10b981' : '#ef4444'}"></span>
              <span style="font-size:14px;font-weight:600;color:var(--text)">${statusData.last_payment_status === 'succeeded' ? formatAmount(statusData.last_invoice_amount) : 'Fallido'}</span>
            </div>
          </div>` : ''}
        </div>
      </div>`;
  } else {
    html += `
      <div style="padding:32px 28px;text-align:center">
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px">Activa tu suscripción para acceder a todas las funcionalidades de Gestría.</p>
        <button class="btn btn-primary btn-lg" onclick="window._startCheckout()" style="padding:14px 32px;font-size:16px">
          <i class="fas fa-rocket" style="margin-right:8px"></i>Suscribirme ahora
        </button>
      </div>`;
  }

  html += `</div>`;

  // Action Buttons
  if (hasSub && isActive) {
    html += `
      <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="window._openPortal()">
          <i class="fas fa-cog" style="margin-right:8px"></i>Gestionar facturación
        </button>
        ${!cancelPending ? `
        <button class="btn btn-outline" onclick="window._confirmCancel()" style="color:var(--text-secondary);border-color:var(--border)">
          <i class="fas fa-times" style="margin-right:8px"></i>Cancelar suscripción
        </button>` : `
        <button class="btn btn-primary" onclick="window._reactivateSub()" style="background:#10b981;border-color:#10b981">
          <i class="fas fa-redo" style="margin-right:8px"></i>Reactivar suscripción
        </button>`}
      </div>`;
  }

  if (isCanceled) {
    html += `
      <div style="display:flex;gap:12px;margin-bottom:24px">
        <button class="btn btn-primary" onclick="window._startCheckout()">
          <i class="fas fa-rocket" style="margin-right:8px"></i>Reactivar suscripción
        </button>
      </div>`;
  }

  // Invoices Table
  if (hasSub && invoicesData.invoices && invoicesData.invoices.length > 0) {
    html += `
      <div class="card">
        <div class="card-header"><h3><i class="fas fa-file-invoice" style="margin-right:8px;color:var(--text-secondary)"></i>Historial de facturas</h3></div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="padding:12px 16px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);font-weight:600">Factura</th>
                <th style="padding:12px 16px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);font-weight:600">Fecha</th>
                <th style="padding:12px 16px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);font-weight:600">Estado</th>
                <th style="padding:12px 16px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);font-weight:600">Importe</th>
                <th style="padding:12px 16px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-secondary);font-weight:600">Acción</th>
              </tr>
            </thead>
            <tbody>
              ${invoicesData.invoices.map(inv => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:12px 16px;font-size:14px;font-weight:600;color:var(--text)">${inv.number || inv.id.slice(-8)}</td>
                  <td style="padding:12px 16px;font-size:13px;color:var(--text-secondary)">${formatDate(new Date(inv.created * 1000).toISOString())}</td>
                  <td style="padding:12px 16px">
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${inv.status === 'paid' ? 'rgba(16,185,129,0.1)' : inv.status === 'open' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)'};color:${inv.status === 'paid' ? '#10b981' : inv.status === 'open' ? '#f59e0b' : '#ef4444'}">
                      <span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>
                      ${inv.status === 'paid' ? 'Pagada' : inv.status === 'open' ? 'Pendiente' : 'Fallida'}
                    </span>
                  </td>
                  <td style="padding:12px 16px;text-align:right;font-size:14px;font-weight:700;color:var(--text)">${formatAmount(inv.amount)}</td>
                  <td style="padding:12px 16px;text-align:center">
                    <a href="${inv.invoice_pdf || inv.hosted_invoice_url}" target="_blank" class="btn btn-outline btn-sm" style="font-size:12px;padding:4px 12px;text-decoration:none">
                      <i class="fas fa-download" style="margin-right:4px"></i>PDF
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // Features Comparison (when no subscription)
  if (!hasSub || status === 'inactive') {
    html += `
      <div class="card" style="margin-top:24px">
        <div class="card-header"><h3><i class="fas fa-gem" style="margin-right:8px;color:#8b5cf6"></i>¿Qué incluye el Plan Pro?</h3></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;padding:8px 0">
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check" style="color:#10b981;font-size:14px"></i></div>
            <div><div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:2px">Calendario inteligente</div><div style="font-size:13px;color:var(--text-secondary)">Gestión completa de citas con vista día, semana y mes</div></div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check" style="color:#10b981;font-size:14px"></i></div>
            <div><div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:2px">Gestión de clientes</div><div style="font-size:13px;color:var(--text-secondary)">CRM completo con historial y fidelización</div></div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check" style="color:#10b981;font-size:14px"></i></div>
            <div><div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:2px">Bot de WhatsApp e Instagram</div><div style="font-size:13px;color:var(--text-secondary)">Automatización de reservas por mensajería</div></div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check" style="color:#10b981;font-size:14px"></i></div>
            <div><div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:2px">Estadísticas e insights</div><div style="font-size:13px;color:var(--text-secondary)">Análisis de negocio con IA integrada</div></div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check" style="color:#10b981;font-size:14px"></i></div>
            <div><div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:2px">Recordatorios automáticos</div><div style="font-size:13px;color:var(--text-secondary)">Email, WhatsApp y SMS para tus clientes</div></div>
          </div>
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-check" style="color:#10b981;font-size:14px"></i></div>
            <div><div style="font-weight:600;color:var(--text);font-size:14px;margin-bottom:2px">Soporte prioritario</div><div style="font-size:13px;color:var(--text-secondary)">Asistencia técnica dedicada</div></div>
          </div>
        </div>
      </div>`;
  }

  content.innerHTML = html;

  // Wire up button handlers
  window._startCheckout = async () => {
    try {
      const btn = event.target.closest('button');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px"></i>Procesando...'; }
      const data = await api('/subscriptions/checkout', { method: 'POST', body: JSON.stringify({}) });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast(err.message, 'error');
      const btn = event?.target?.closest?.('button');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rocket" style="margin-right:8px"></i>Suscribirme ahora'; }
    }
  };

  window._openPortal = async () => {
    try {
      const data = await api('/subscriptions/portal', { method: 'POST', body: JSON.stringify({}) });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window._confirmCancel = () => {
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const overlay = document.getElementById('modal-overlay');
    if (modalTitle) modalTitle.textContent = 'Cancelar suscripción';
    if (modalBody) modalBody.innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div style="width:64px;height:64px;border-radius:50%;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <i class="fas fa-exclamation-triangle" style="color:#ef4444;font-size:28px"></i>
        </div>
        <h3 style="color:var(--text);margin-bottom:8px">¿Estás seguro?</h3>
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:8px">Tu suscripción permanecerá activa hasta el final del período de facturación actual.</p>
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px">Después de la cancelación, perderás acceso a las funcionalidades premium.</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn btn-outline" onclick="document.getElementById('modal-overlay').style.display='none'">No, mantener</button>
          <button class="btn btn-primary" style="background:#ef4444;border-color:#ef4444" onclick="window._executeCancel()">Sí, cancelar</button>
        </div>
      </div>`;
    if (overlay) { overlay.style.display = ''; overlay.style.opacity = '0'; requestAnimationFrame(() => { overlay.style.transition = 'opacity 0.2s'; overlay.style.opacity = '1'; }); }
  };

  window._executeCancel = async () => {
    try {
      await api('/subscriptions/portal', { method: 'POST', body: JSON.stringify({}) });
      toast('Redirigiendo al portal de facturación...', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window._reactivateSub = async () => {
    try {
      const data = await api('/subscriptions/reactivate', { method: 'POST', body: JSON.stringify({}) });
      if (data.success) {
        toast('Suscripción reactivada correctamente');
        loadSubscriptionData(container, api, currentUser, toast);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
