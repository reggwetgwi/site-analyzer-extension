document.addEventListener('DOMContentLoaded', async () => {
  const apiKeysInput = document.getElementById('apiKeys');
  const modelInput = document.getElementById('model');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const cacheCount = document.getElementById('cacheCount');
  const status = document.getElementById('status');

  // Загрузить сохранённые ключи и модель
  const stored = await chrome.storage.local.get(['geminiApiKeys', 'geminiModel']);
  if (stored.geminiApiKeys && stored.geminiApiKeys.length > 0) {
    apiKeysInput.value = stored.geminiApiKeys.join('\n');
  }
  if (stored.geminiModel) {
    modelInput.value = stored.geminiModel;
  }

  // Показать число записей в кэше
  await refreshCacheCount();

  async function refreshCacheCount() {
    const all = await chrome.storage.local.get(null);
    const n = Object.keys(all).filter(k => k.startsWith('analysis_')).length;
    cacheCount.textContent = n;
  }

  // Очистка кэша анализов
  clearCacheBtn.addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('analysis_'));
    if (keys.length === 0) {
      showStatus('Кэш уже пуст', 'success');
      return;
    }
    await chrome.storage.local.remove(keys);
    await refreshCacheCount();
    showStatus(`Удалено записей: ${keys.length}`, 'success');
  });

  // Сохранить ключи
  saveBtn.addEventListener('click', async () => {
    const keysText = apiKeysInput.value.trim();

    if (!keysText) {
      showStatus('Введите хотя бы один API-ключ', 'error');
      return;
    }

    // Разбить на строки и очистить
    const keys = keysText
      .split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    if (keys.length === 0) {
      showStatus('Введите хотя бы один API-ключ', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохранение...';

    try {
      await chrome.storage.local.set({
        geminiApiKeys: keys,
        geminiModel: modelInput.value.trim(),  // пусто = модель по умолчанию
        currentKeyIndex: 0  // Сброс индекса при сохранении новых ключей
      });
      showStatus(`Сохранено ${keys.length} API-ключ(ей)`, 'success');

      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (error) {
      showStatus('Ошибка сохранения: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить';
    }
  });

  // Отмена
  cancelBtn.addEventListener('click', () => {
    window.close();
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type} show`;

    setTimeout(() => {
      status.classList.remove('show');
    }, 5000);
  }
});
