// Каталог услуг компании. Правится под свой профиль здесь и в SERVICES_BRIEF ниже —
// расширение само по себе к конкретному набору услуг не привязано.
const SERVICES = [
  { name: 'Услуга A', icon: '🔍', color: '#4a9eff' },
  { name: 'Услуга B', icon: '📊', color: '#a78bfa' },
  { name: 'Услуга C', icon: '💰', color: '#fbbf24' },
  { name: 'Услуга D', icon: '⚙️', color: '#9ca3af' },
  { name: 'Услуга E', icon: '⭐', color: '#2dd4bf' }
];

const SERVICE_ICONS = Object.fromEntries(SERVICES.map(s => [s.name, s.icon]));
const SERVICE_COLORS = Object.fromEntries(SERVICES.map(s => [s.name, s.color]));

// Описание услуг для модели: что входит и кому это уместно предлагать.
const SERVICES_BRIEF = SERVICES.map(s =>
  `- ${s.name} (что входит в услугу; кому предлагать, а кому нет)`
).join('\n');

// Модель по умолчанию и список фолбэков на случай, если Google
// переименует/выключит модель. Перебираются по очереди при ошибке 404/400.
const DEFAULT_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

// Параметры кэша
const CACHE_TTL = 3600000;       // запись «свежая» 1 час (показывается без переанализа)
const CACHE_MAX_AGE = 7 * 24 * 3600000; // старше 7 дней — удаляем
const CACHE_MAX_ENTRIES = 50;    // не больше N доменов в кэше

// ===== Утилиты безопасности и форматирования =====

// Экранирование HTML для безопасной вставки данных от ИИ/сайта в innerHTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Разрешаем только безопасные http(s) ссылки, иначе возвращаем пустую строку
function safeUrl(value) {
  const url = String(value ?? '').trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    // невалидный URL
  }
  return '';
}

// Извлекает JSON из ответа модели (срезает markdown-обёртку ```json ... ```)
function extractJson(text) {
  let cleaned = String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  return JSON.parse(cleaned);
}

// Минимальный безопасный markdown -> HTML.
// Сначала экранируем весь текст, затем включаем поддержку базового форматирования.
function renderMarkdown(text) {
  const lines = String(text || '').split('\n');
  let html = '';
  let inList = false;
  let inCode = false;
  let codeBuffer = '';

  const inline = (s) => {
    let r = escapeHtml(s);
    // `code`
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
    // **bold**
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // *italic* / _italic_
    r = r.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    r = r.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    return r;
  };

  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // Блок кода ```
    if (/^```/.test(line)) {
      if (inCode) {
        html += `<pre class="md-pre">${escapeHtml(codeBuffer)}</pre>`;
        codeBuffer = '';
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuffer += (codeBuffer ? '\n' : '') + raw; continue; }

    // Заголовки ###
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = Math.min(6, h[1].length + 2);
      html += `<h${level} class="md-h">${inline(h[2])}</h${level}>`;
      continue;
    }

    // Списки - * •
    const li = line.match(/^\s*[-*•]\s+(.*)$/);
    if (li) {
      if (!inList) { html += '<ul class="md-ul">'; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    html += `<p class="md-p">${inline(line)}</p>`;
  }

  if (inCode) html += `<pre class="md-pre">${escapeHtml(codeBuffer)}</pre>`;
  closeList();
  return html;
}

document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    loading: document.getElementById('loading'),
    content: document.getElementById('content'),
    error: document.getElementById('error'),
    domain: document.getElementById('domain'),
    statusBadge: document.getElementById('statusBadge'),
    openerText: document.getElementById('openerText'),
    servicesOffer: document.getElementById('servicesOffer'),
    servicesAvoid: document.getElementById('servicesAvoid'),
    strengths: document.getElementById('strengths'),
    weaknesses: document.getElementById('weaknesses'),
    techData: document.getElementById('techData'),
    errorMessage: document.getElementById('errorMessage'),
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn')
  };

  let currentDomain = '';
  let currentAnalysis = null;
  let currentDomData = null;
  let chatHistory = [];
  let competitors = null;

  // Кнопки
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'settings.html' });
  });

  document.getElementById('copyOpener').addEventListener('click', () => {
    copyToClipboard(elements.openerText.textContent, document.getElementById('copyOpener'));
  });

  document.getElementById('refreshBtn').addEventListener('click', analyze);
  document.getElementById('errorRetryBtn').addEventListener('click', analyze);

  document.getElementById('techToggle').addEventListener('click', () => {
    const content = document.getElementById('techContent');
    const arrow = document.querySelector('.arrow');
    content.classList.toggle('open');
    arrow.textContent = content.classList.contains('open') ? '▲' : '▼';
  });

  // Чат
  document.getElementById('sendBtn').addEventListener('click', sendChatMessage);
  elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  // Авто-рост поля ввода
  elements.chatInput.addEventListener('input', () => {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
  });

  // Конкуренты
  document.getElementById('findCompetitorsBtn').addEventListener('click', findCompetitors);

  // Запуск анализа
  await loadCachedOrAnalyze();

  // ===== Единый вызов Gemini: ротация ключей + фолбэк моделей =====
  async function callGemini({ prompt, json = false, useSearch = false }) {
    const stored = await chrome.storage.local.get(['geminiApiKeys', 'currentKeyIndex', 'geminiModel']);
    if (!stored.geminiApiKeys || stored.geminiApiKeys.length === 0) {
      throw new Error('API-ключи не настроены. Откройте настройки.');
    }

    const apiKeys = stored.geminiApiKeys;
    const startIndex = stored.currentKeyIndex || 0;

    // Список моделей: выбранная пользователем -> фолбэки (без дублей)
    const models = [];
    const preferred = stored.geminiModel || DEFAULT_MODEL;
    [preferred, ...FALLBACK_MODELS].forEach(m => {
      if (m && !models.includes(m)) models.push(m);
    });

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    };
    if (json) body.generationConfig.responseMimeType = 'application/json';
    if (useSearch) body.tools = [{ googleSearch: {} }];

    let lastError = new Error('Не удалось получить ответ от Gemini');

    for (const model of models) {
      let modelRejected = false;

      for (let attempt = 0; attempt < apiKeys.length && !modelRejected; attempt++) {
        const keyIndex = (startIndex + attempt) % apiKeys.length;
        const apiKey = apiKeys[keyIndex];

        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
          );

          if (res.status === 429) {
            // лимит ключа исчерпан — пробуем следующий ключ
            lastError = new Error('Превышен лимит запросов API.');
            continue;
          }

          if (!res.ok) {
            let msg = `Ошибка API (HTTP ${res.status})`;
            try {
              const errData = await res.json();
              if (errData.error?.message) msg = errData.error.message;
            } catch { /* тело не JSON */ }

            // 404/400 — модель недоступна/переименована: пробуем следующую модель
            if (res.status === 404 || res.status === 400) {
              lastError = new Error(msg);
              modelRejected = true;
              continue;
            }
            // прочие ошибки — пробуем следующий ключ
            lastError = new Error(msg);
            continue;
          }

          const data = await res.json();
          const parts = data?.candidates?.[0]?.content?.parts;
          if (!parts) throw new Error('Некорректный ответ от API');

          const text = parts.map(p => p.text || '').join('');
          if (!text) throw new Error('Пустой ответ от API');

          // Успех — запоминаем рабочий ключ
          await chrome.storage.local.set({ currentKeyIndex: keyIndex });
          return text;

        } catch (e) {
          // Сетевая ошибка/парсинг — пробуем следующий ключ
          lastError = e;
        }
      }
    }

    throw lastError;
  }

  async function loadCachedOrAnalyze() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url) {
        throw new Error('Не удалось получить URL страницы');
      }

      if (isSystemPage(tab.url)) {
        throw new Error('Расширение не работает на системных страницах браузера');
      }

      const domain = new URL(tab.url).hostname;
      elements.domain.textContent = domain;
      currentDomain = domain;

      const cacheKey = `analysis_${domain}`;
      const cached = await chrome.storage.local.get(cacheKey);

      if (cached[cacheKey]) {
        const { analysis, domData, timestamp, chat, competitors: cachedCompetitors } = cached[cacheKey];
        const age = Date.now() - timestamp;

        if (age < CACHE_TTL) {
          currentAnalysis = analysis;
          currentDomData = domData;
          chatHistory = chat || [];
          competitors = cachedCompetitors || null;
          displayResults(analysis, domData);
          displayChatHistory();
          if (competitors) {
            displayCompetitors(competitors);
          }
          showContent();
          elements.statusBadge.textContent = 'Из кэша';
          elements.statusBadge.style.background = '#4a9eff';
          return;
        }
      }

      analyze();

    } catch (error) {
      showError(error.message);
    }
  }

  async function analyze() {
    showLoading();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url) {
        throw new Error('Не удалось получить URL страницы');
      }

      if (isSystemPage(tab.url)) {
        throw new Error('Расширение не работает на системных страницах браузера');
      }

      const domain = new URL(tab.url).hostname;
      elements.domain.textContent = domain;
      currentDomain = domain;

      // Шаг 1: Анализ DOM
      elements.step1.classList.add('active');
      const domData = await analyzePage(tab.id);
      elements.step1.classList.add('completed');
      elements.step1.classList.remove('active');

      // Шаг 2: Вызов Gemini
      elements.step2.classList.add('active');
      const analysis = await getAnalysis(domData, domain);
      elements.step2.classList.add('completed');
      elements.step2.classList.remove('active');

      // Сохранить данные
      currentAnalysis = analysis;
      currentDomData = domData;
      chatHistory = [];
      competitors = null;

      displayResults(analysis, domData);

      // Сохранить в кэш + почистить старое
      const cacheKey = `analysis_${domain}`;
      await chrome.storage.local.set({
        [cacheKey]: {
          analysis,
          domData,
          timestamp: Date.now(),
          chat: chatHistory,
          competitors: null
        }
      });
      pruneCache();

      showContent();

    } catch (error) {
      showError(error.message);
    }
  }

  async function getAnalysis(domData, domain) {
    const prompt = `Ты — эксперт по digital-маркетингу. Проанализируй сайт ${domain} и дай рекомендации для менеджера по продажам.

ДАННЫЕ САЙТА:
${JSON.stringify(domData, null, 2)}

УСЛУГИ для анализа:
${SERVICES_BRIEF}

Верни JSON в формате:
{
  "opener": "1-2 персонализированные фразы с конкретной проблемой сайта для холодного звонка",
  "offer": [
    {
      "service": "название услуги",
      "priority": "HOT" или "normal",
      "reason": "почему предлагать"
    }
  ],
  "avoid": [
    {
      "service": "название услуги",
      "reason": "почему НЕ предлагать"
    }
  ],
  "strengths": ["сильная сторона 1", "сильная сторона 2"],
  "weaknesses": ["слабая сторона 1", "слабая сторона 2"]
}`;

    const text = await callGemini({ prompt, json: true });
    try {
      return extractJson(text);
    } catch (e) {
      console.error('Ошибка парсинга JSON:', text);
      throw new Error('Не удалось обработать ответ ИИ');
    }
  }

  async function analyzePage(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Самодостаточная функция анализа DOM
        const data = {
          url: window.location.href,
          title: document.title,
          meta: {},
          headings: {},
          technical: {},
          content: {},
          commercial: {}
        };

        // Title
        const titleTag = document.querySelector('title');
        data.meta.title = titleTag ? titleTag.textContent.trim() : '';
        data.meta.titleLength = data.meta.title.length;

        // Meta Description
        const metaDesc = document.querySelector('meta[name="description"]');
        data.meta.description = metaDesc ? metaDesc.content.trim() : '';
        data.meta.descriptionLength = data.meta.description.length;

        // Headings
        data.headings.h1 = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim());
        data.headings.h2 = Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim());
        data.headings.h1Count = data.headings.h1.length;
        data.headings.h2Count = data.headings.h2.length;

        // Technical
        data.technical.https = window.location.protocol === 'https:';
        data.technical.viewport = !!document.querySelector('meta[name="viewport"]');
        data.technical.canonical = document.querySelector('link[rel="canonical"]')?.href || null;
        data.technical.robotsMeta = document.querySelector('meta[name="robots"]')?.content || null;

        // Analytics
        data.technical.googleAnalytics = !!document.querySelector('script[src*="google-analytics.com"], script[src*="googletagmanager.com"]');
        data.technical.yandexMetrika = !!document.querySelector('script[src*="mc.yandex.ru"]');

        // Schema.org
        const schemas = document.querySelectorAll('script[type="application/ld+json"]');
        data.technical.schemaCount = schemas.length;
        data.technical.schemaTypes = Array.from(schemas).map(s => {
          try {
            const json = JSON.parse(s.textContent);
            return json['@type'] || 'Unknown';
          } catch {
            return 'Invalid';
          }
        });

        // Images without alt
        const images = document.querySelectorAll('img');
        data.technical.imagesTotal = images.length;
        data.technical.imagesWithoutAlt = Array.from(images).filter(img => !img.alt).length;

        // Forms and CTA
        data.content.forms = document.querySelectorAll('form').length;
        data.content.phones = (document.body.textContent.match(/\+?\d[\d\s\-\(\)]{7,}/g) || []).length;
        data.content.ctaButtons = document.querySelectorAll('button, a[class*="btn"], a[class*="button"]').length;

        // Reviews
        data.content.reviews = document.querySelectorAll('[itemtype*="Review"], [class*="review"], [class*="отзыв"]').length;

        // Online chat
        data.content.onlineChat = !!(
          document.querySelector('[class*="jivo"], [class*="carrot"], [class*="chat"]') ||
          window.jivo || window.carrotquest
        );

        // Social links
        const socialDomains = ['facebook.com', 'vk.com', 'instagram.com', 'twitter.com', 'linkedin.com', 'youtube.com', 'telegram.org', 't.me'];
        data.content.socialLinks = Array.from(document.querySelectorAll('a[href]'))
          .filter(a => socialDomains.some(d => a.href.includes(d)))
          .map(a => a.href);

        // Commercial signals
        data.commercial.hasPrices = !!(document.body.textContent.match(/\d+\s*(руб|₽|rub|usd|\$|€)/gi));
        data.commercial.hasCatalog = !!(document.querySelector('[class*="catalog"], [class*="каталог"], [class*="product"]'));
        data.commercial.hasCart = !!(document.querySelector('[class*="cart"], [class*="корзин"]'));

        return data;
      }
    });

    return results[0].result;
  }

  function displayResults(analysis, domData) {
    // Открывашка
    elements.openerText.textContent = analysis.opener || 'Не удалось сгенерировать открывашку';

    // Услуги для предложения
    const offerServices = analysis.offer || [];
    elements.servicesOffer.innerHTML = offerServices.map(s => `
      <div class="service-card" style="border-left-color: ${SERVICE_COLORS[s.service] || '#999'}">
        <div class="service-header">
          <span class="service-icon">${SERVICE_ICONS[s.service] || '📋'}</span>
          <span class="service-name">${escapeHtml(s.service || 'Услуга')}</span>
          ${s.priority === 'HOT' ? '<span class="badge-hot">HOT</span>' : ''}
        </div>
        <p class="service-reason">${escapeHtml(s.reason || '')}</p>
      </div>
    `).join('') || '<p style="color: #888;">Нет рекомендаций</p>';

    // Услуги для избегания
    const avoidServices = analysis.avoid || [];
    elements.servicesAvoid.innerHTML = avoidServices.map(s => `
      <div class="service-card dimmed" style="border-left-color: ${SERVICE_COLORS[s.service] || '#999'}">
        <div class="service-header">
          <span class="service-icon">${SERVICE_ICONS[s.service] || '📋'}</span>
          <span class="service-name">${escapeHtml(s.service || 'Услуга')}</span>
        </div>
        <p class="service-reason">${escapeHtml(s.reason || '')}</p>
      </div>
    `).join('') || '<p style="color: #888;">Нет ограничений</p>';

    // Сильные стороны
    const strengths = analysis.strengths || [];
    elements.strengths.innerHTML = strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li style="color: #888;">Не определены</li>';

    // Слабые стороны
    const weaknesses = analysis.weaknesses || [];
    elements.weaknesses.innerHTML = weaknesses.map(s => `<li>${escapeHtml(s)}</li>`).join('') || '<li style="color: #888;">Не определены</li>';

    // Техническая сводка
    elements.techData.textContent = JSON.stringify(domData, null, 2);

    elements.statusBadge.textContent = 'Готово';
    elements.statusBadge.style.background = '#1a4d2e';
  }

  function showLoading() {
    elements.loading.style.display = 'flex';
    elements.content.style.display = 'none';
    elements.error.style.display = 'none';
    elements.step1.classList.remove('active', 'completed');
    elements.step2.classList.remove('active', 'completed');
    elements.statusBadge.textContent = 'Анализ...';
    elements.statusBadge.style.background = '#4a9eff';
  }

  function showContent() {
    elements.loading.style.display = 'none';
    elements.content.style.display = 'block';
    elements.error.style.display = 'none';
  }

  function showError(message) {
    elements.loading.style.display = 'none';
    elements.content.style.display = 'none';
    elements.error.style.display = 'flex';
    elements.errorMessage.textContent = message;
    elements.statusBadge.textContent = 'Ошибка';
    elements.statusBadge.style.background = '#7f1d1d';
  }

  function isSystemPage(url) {
    return url.startsWith('edge://') || url.startsWith('chrome://') ||
      url.startsWith('about:') || url.startsWith('chrome-extension://') ||
      url.startsWith('https://chromewebstore.google.com') ||
      url.startsWith('https://microsoftedge.microsoft.com');
  }

  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Скопировано';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
      }
    } catch (error) {
      console.error('Copy failed:', error);
    }
  }

  function displayChatHistory() {
    elements.chatMessages.innerHTML = '';
    chatHistory.forEach(msg => {
      addChatMessage(msg.role, msg.content, false);
    });
  }

  function addChatMessage(role, content, scroll = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;

    if (role === 'ai') {
      // Ответ ИИ рендерим как markdown (внутри всё экранируется)
      messageDiv.innerHTML = renderMarkdown(content);

      // Кнопка копирования ответа
      const copyBtn = document.createElement('button');
      copyBtn.className = 'chat-copy';
      copyBtn.title = 'Скопировать ответ';
      copyBtn.textContent = '⧉';
      copyBtn.addEventListener('click', () => copyToClipboard(content, copyBtn));
      messageDiv.appendChild(copyBtn);
    } else {
      messageDiv.textContent = content;
    }

    elements.chatMessages.appendChild(messageDiv);

    if (scroll) {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }
  }

  async function sendChatMessage() {
    const message = elements.chatInput.value.trim();

    if (!message) return;

    if (!currentAnalysis || !currentDomData) {
      addChatMessage('ai', 'Сначала необходимо выполнить анализ сайта');
      return;
    }

    addChatMessage('user', message);
    chatHistory.push({ role: 'user', content: message });

    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';
    elements.sendBtn.disabled = true;

    // Индикатор загрузки
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'chat-message loading';
    loadingMsg.textContent = 'ИИ печатает...';
    loadingMsg.id = 'loading-msg';
    elements.chatMessages.appendChild(loadingMsg);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    try {
      const prompt = `Ты — эксперт по digital-маркетингу. Ты уже проанализировал сайт ${currentDomain}.

РЕЗУЛЬТАТЫ АНАЛИЗА:
${JSON.stringify(currentAnalysis, null, 2)}

ТЕХНИЧЕСКИЕ ДАННЫЕ:
${JSON.stringify(currentDomData, null, 2)}

ИСТОРИЯ ДИАЛОГА:
${chatHistory.slice(0, -1).map(m => `${m.role === 'user' ? 'Пользователь' : 'Ты'}: ${m.content}`).join('\n')}

Ответь на вопрос пользователя в контексте этого сайта. Будь конкретным и полезным.

ВОПРОС: ${message}`;

      const response = await callGemini({ prompt });

      document.getElementById('loading-msg')?.remove();

      addChatMessage('ai', response);
      chatHistory.push({ role: 'ai', content: response });

      // Сохранить историю чата в кэш
      const cacheKey = `analysis_${currentDomain}`;
      const cached = await chrome.storage.local.get(cacheKey);
      if (cached[cacheKey]) {
        cached[cacheKey].chat = chatHistory;
        await chrome.storage.local.set(cached);
      }

    } catch (error) {
      document.getElementById('loading-msg')?.remove();
      addChatMessage('ai', `Ошибка: ${error.message}`);
    } finally {
      elements.sendBtn.disabled = false;
    }
  }

  async function findCompetitors() {
    const btn = document.getElementById('findCompetitorsBtn');
    const container = document.getElementById('competitorsContainer');

    if (!currentAnalysis || !currentDomData) {
      container.innerHTML = '<p class="competitors-hint">Сначала необходимо выполнить анализ сайта</p>';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Поиск...';
    container.innerHTML = '<div class="competitors-loading">Ищем конкурентов в Google...</div>';

    try {
      const prompt = `Найди топ-5 конкурентов для сайта ${currentDomain} в поисковой выдаче Google.

ИНФОРМАЦИЯ О САЙТЕ:
- Название: ${currentDomData.meta.title}
- Описание: ${currentDomData.meta.description}
- Основные заголовки: ${currentDomData.headings.h1.join(', ')}

Найди реальные сайты-конкуренты, которые занимают высокие позиции в Google по схожей тематике.

ВАЖНО: Используй Google Search для поиска реальных конкурентов. Не придумывай сайты.

Верни ТОЛЬКО JSON (без дополнительного текста) в формате:
{
  "competitors": [
    {
      "name": "Название компании/сайта",
      "url": "полный URL сайта",
      "description": "краткое описание (1-2 предложения) - чем занимается и почему конкурент"
    }
  ]
}`;

      // При поиске нельзя задавать responseMimeType=json, парсим текст вручную
      const text = await callGemini({ prompt, useSearch: true });

      let response;
      try {
        response = extractJson(text);
      } catch (e) {
        throw new Error('Не удалось обработать список конкурентов');
      }

      competitors = response.competitors || [];
      displayCompetitors(competitors);

      // Обновить кэш
      const cacheKey = `analysis_${currentDomain}`;
      const cached = await chrome.storage.local.get(cacheKey);
      if (cached[cacheKey]) {
        cached[cacheKey].competitors = competitors;
        await chrome.storage.local.set(cached);
      }

    } catch (error) {
      container.innerHTML = `<p class="competitors-hint" style="color: #f87171;">Ошибка: ${escapeHtml(error.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Обновить';
    }
  }

  function displayCompetitors(competitorsList) {
    const container = document.getElementById('competitorsContainer');

    if (!competitorsList || competitorsList.length === 0) {
      container.innerHTML = '<p class="competitors-hint">Конкуренты не найдены</p>';
      return;
    }

    container.innerHTML = `
      <div class="competitors-list">
        ${competitorsList.map((comp, index) => {
          const url = safeUrl(comp.url);
          const urlText = escapeHtml(comp.url || '');
          const linkHtml = url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="competitor-url" title="${urlText}">${urlText}</a>`
            : `<span class="competitor-url" title="${urlText}">${urlText}</span>`;
          return `
          <div class="competitor-card">
            <div class="competitor-header">
              <span class="competitor-name">${index + 1}. ${escapeHtml(comp.name || 'Без названия')}</span>
            </div>
            ${linkHtml}
            <p class="competitor-description">${escapeHtml(comp.description || 'Описание отсутствует')}</p>
          </div>
        `;
        }).join('')}
      </div>
    `;
  }

  // Очистка кэша: удаляем записи старше CACHE_MAX_AGE и держим не более CACHE_MAX_ENTRIES
  async function pruneCache() {
    try {
      const all = await chrome.storage.local.get(null);
      const now = Date.now();
      const entries = Object.keys(all)
        .filter(k => k.startsWith('analysis_'))
        .map(k => ({ key: k, ts: all[k]?.timestamp || 0 }));

      const toRemove = [];

      // Слишком старые
      for (const e of entries) {
        if (now - e.ts > CACHE_MAX_AGE) toRemove.push(e.key);
      }

      // Перебор по количеству (оставляем самые свежие)
      const fresh = entries
        .filter(e => !toRemove.includes(e.key))
        .sort((a, b) => b.ts - a.ts);
      if (fresh.length > CACHE_MAX_ENTRIES) {
        fresh.slice(CACHE_MAX_ENTRIES).forEach(e => toRemove.push(e.key));
      }

      if (toRemove.length) {
        await chrome.storage.local.remove(toRemove);
      }
    } catch (e) {
      console.warn('Не удалось почистить кэш:', e);
    }
  }
});
