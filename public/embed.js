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
 *     data-font="Poppins"
 *     data-bg-color="#ffffff"
 *     data-text-color="#1a1a2e"
 *     data-text-secondary-color="rgba(0,0,0,0.5)"
 *     data-surface-color="#f8f9fb"
 *     data-border-color="rgba(0,0,0,0.08)"
 *     data-border-radius="16px"
 *     data-success-color="#22c55e"
 *     data-danger-color="#c1292e"
 *   ></script>
 * 
 * Opciones data-*:
 *   data-slug                  - Slug del negocio (obligatorio)
 *   data-theme                 - "light" (default) o "dark"
 *   data-color                 - Color primario en hex (ej: #6366f1)
 *   data-width                 - Ancho del widget (default: "100%")
 *   data-height                - Altura inicial en px (default: "550", se ajusta automáticamente)
 *   data-target                - ID del contenedor donde insertar (default: se busca div#gestria-booking o se crea uno)
 *   data-font                  - Fuente de Google Fonts (ej: "Poppins", "Raleway", "Montserrat")
 *   data-bg-color              - Color de fondo del widget (hex)
 *   data-text-color            - Color del texto principal (hex o rgba)
 *   data-text-secondary-color  - Color del texto secundario (hex o rgba)
 *   data-surface-color         - Color de superficies/cards (hex)
 *   data-border-color          - Color de bordes (hex o rgba)
 *   data-border-radius         - Radio de bordes (ej: "16px", "8px", "0")
 *   data-success-color         - Color de éxito/confirmación (hex)
 *   data-danger-color          - Color de error/peligro (hex)
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
  const height = scriptEl.getAttribute('data-height') || '550';
  const targetId = scriptEl.getAttribute('data-target');

  // Nuevos parámetros de personalización
  const font = scriptEl.getAttribute('data-font') || '';
  const bgColor = scriptEl.getAttribute('data-bg-color') || '';
  const textColor = scriptEl.getAttribute('data-text-color') || '';
  const textSecondaryColor = scriptEl.getAttribute('data-text-secondary-color') || '';
  const surfaceColor = scriptEl.getAttribute('data-surface-color') || '';
  const borderColor = scriptEl.getAttribute('data-border-color') || '';
  const borderRadius = scriptEl.getAttribute('data-border-radius') || '';
  const successColor = scriptEl.getAttribute('data-success-color') || '';
  const dangerColor = scriptEl.getAttribute('data-danger-color') || '';

  const baseUrl = scriptEl.src.replace(/\/embed\.js(\?.*)?$/, '');
  
  let params = `slug=${encodeURIComponent(slug)}&theme=${theme}`;
  if (color) params += `&color=${encodeURIComponent(color)}`;
  if (font) params += `&font=${encodeURIComponent(font)}`;
  if (bgColor) params += `&bg_color=${encodeURIComponent(bgColor)}`;
  if (textColor) params += `&text_color=${encodeURIComponent(textColor)}`;
  if (textSecondaryColor) params += `&text_secondary_color=${encodeURIComponent(textSecondaryColor)}`;
  if (surfaceColor) params += `&surface_color=${encodeURIComponent(surfaceColor)}`;
  if (borderColor) params += `&border_color=${encodeURIComponent(borderColor)}`;
  if (borderRadius) params += `&border_radius=${encodeURIComponent(borderRadius)}`;
  if (successColor) params += `&success_color=${encodeURIComponent(successColor)}`;
  if (dangerColor) params += `&danger_color=${encodeURIComponent(dangerColor)}`;

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
  iframe.style.height = height + 'px';
  iframe.style.border = 'none';
  iframe.style.overflow = 'hidden';
  iframe.style.transition = 'height 0.3s ease';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', 'Reservar cita');
  iframe.setAttribute('allow', 'payment');
  
  container.appendChild(iframe);

  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data.type !== 'string') return;

    if (e.data.type === 'gestria-embed-height' && e.source === iframe.contentWindow) {
      iframe.style.height = e.data.height + 'px';
    }

    if (e.data.type === 'gestria-booking-confirmed') {
      window.dispatchEvent(new CustomEvent('gestria-booking-confirmed', { detail: e.data.booking }));
    }
  });
})();
