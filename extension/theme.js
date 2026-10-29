export function applyTheme(theme = 'system') {
  document.documentElement.dataset.theme = theme;
}
const { settings } = await chrome.storage.local.get('settings');
applyTheme(settings?.theme);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings && changes.settings.oldValue?.theme !== changes.settings.newValue?.theme) applyTheme(changes.settings.newValue?.theme);
});
