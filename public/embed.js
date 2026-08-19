/**
 * GestrIA Embed Widget - Script de incrustación
 * 
 * Uso básico:
 *   <div id="gestria-booking"></div>
 *   <script src="https://TU-DOMINIO/embed.js" data-slug="mi-barberia"></script>
 * 
 * Uso con opciones:
 *   <div id="gestria-booking"></div>
 *   <script src="https://TU-DOMINIO/embed.js" 
 *     data-slug="mi-barberia"
 *     data-theme="dark"
 *     data-color="#6366f1"
 *     data-width="100%"
 *     data-height="700"
 *   ></script>
 * 
 * Opciones data-*:
 *   data-slug    - Slug del negocio (obligatorio)
 *   data-theme   - "light" (default) o "dark"
 *   data-color   - Color primario en hex (ej: #6366f1)
 *   data-width   - Ancho del widget (default: "100%")
 *   data-height  - Altura inicial en px (default: "700", se ajusta automáticamente a la resolución de la ventana)
 *   data-target  - ID del contenedor donde insertar (default: se busca div#gestria-booking o se crea uno)
 */
(function() {
  'use strict';

  const scriptEl = document.currentScript;
  if (!scriptEl) return;

  const slug = scriptEl.getAttribute('data-slug');
  if (!slug) {
    console.error('[GestrIA] Falta el atributo data-slug en el script');
    return;
  }

  const theme = scriptEl.getAttribute('data-theme') || 'light';
  const color = scriptEl.getAttribute('data-color') || '';
  const width = scriptEl.getAttribute('data-width') || '100%';
  const height = scriptEl.getAttribute('data-height') || '700';
  const targetId = scriptEl.getAttribute('data-target');

  const baseUrl = scriptEl.src.replace(/\/embed\.js(\?.*)?$/, '');
  
  let params = `slug=${encodeURIComponent(slug)}&theme=${theme}`;
  if (color) params += `&color=${encodeURIComponent(color)}`;

  const iframeSrc = `${baseUrl}/embed.html?${params}`;

  let container = targetId ? document.getElementById(targetId) : null;
  if (!container) {
    container = document.getElementById('gestria-booking');
  }
  if (!container) {
    container = document.createElement('div');
    container.id = 'gestria-booking';
    scriptEl.parentNode.insertBefore(container, scriptEl.nextSibling);
  }

  const iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.style.width = width;
  iframe.style.border = 'none';
  iframe.style.borderRadius = '12px';
  iframe.style.overflow = 'hidden';
  iframe.style.boxShadow = '0 4px 24px rgba(0,0,0,0.08)';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', 'Reservar cita');
  iframe.setAttribute('allow', 'payment');

  container.appendChild(iframe);

  const VIEWPORT_MARGIN = 48;
  let contentHeight = parseInt(height, 10) || 700;

  function getMaxIframeHeight() {
    const viewport = window.innerHeight || document.documentElement.clientHeight || 700;
    return Math.max(Math.min(400, viewport), Math.min(1200, viewport - VIEWPORT_MARGIN));
  }

  function applyHeight() {
    const max = getMaxIframeHeight();
    const min = Math.min(400, max);
    iframe.style.height = Math.max(min, Math.min(contentHeight, max)) + 'px';
  }

  applyHeight();
  window.addEventListener('resize', applyHeight);

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data.type !== 'string') return;

    if (e.data.type === 'gestria-embed-height' && e.source === iframe.contentWindow) {
      contentHeight = e.data.height;
      applyHeight();
    }

    if (e.data.type === 'gestria-booking-confirmed') {
      window.dispatchEvent(new CustomEvent('gestria-booking-confirmed', { detail: e.data.booking }));
    }
  });
})();
