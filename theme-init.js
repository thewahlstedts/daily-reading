// Apply the saved theme before first paint to avoid a flash.
try {
  const theme = JSON.parse(localStorage.getItem('daily-reading:v1') || '{}').theme;
  if (/^[a-z]{1,20}$/.test(theme) && theme !== 'auto') document.documentElement.dataset.theme = theme;
} catch {}

// Reading fonts load non-blocking (media="print" until ready); offline, system fonts are used.
document.addEventListener('DOMContentLoaded', () => {
  const link = document.getElementById('reading-fonts');
  if (!link) return;
  if (link.sheet) link.media = 'all';
  else link.addEventListener('load', () => { link.media = 'all'; });
});
