// Runs before the page is drawn, so the right theme is there from the first moment.
// A saved choice wins. Without one, the theme follows the device's setting.
(() => {
  const saved = /(?:^|; )theme=(light|dark)/.exec(document.cookie)?.[1];
  document.documentElement.dataset.theme = saved ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
})();
