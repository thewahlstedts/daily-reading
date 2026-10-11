// Apply the saved theme before first paint to avoid a flash.
try {
  const theme = JSON.parse(localStorage.getItem('daily-reading:v1') || '{}').theme;
  if (/^[a-z]{1,20}$/.test(theme) && theme !== 'auto') document.documentElement.dataset.theme = theme;
} catch {}

