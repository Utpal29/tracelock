// Popup script for TraceLock. Fetches tab data from the background worker, maintains
// UI state for filters and insights, and renders an extended privacy dashboard.

const state = {
  tabId: null,
  tabUrl: '',
  requestCache: [],
  filters: {
    tracker: 'all',
    method: 'all',
    search: ''
  },
  methods: [],
  history: [],
  data: null
};

const CATEGORY_METADATA = {
  ads: {
    label: 'Ads',
    description: 'Advertising pixels, retargeting beacons, and monetization tags.'
  },
  analytics: {
    label: 'Analytics',
    description: 'Measurement, experimentation, and behavioral analytics SDKs.'
  },
  cdn: {
    label: 'CDNs',
    description: 'Content delivery networks serving scripts, fonts, or assets.'
  },
  social: {
    label: 'Social',
    description: 'Social media widgets and cross-site identity trackers.'
  },
  api: {
    label: 'APIs',
    description: 'XHR, fetch, and websocket requests reaching first or third parties.'
  },
  media: {
    label: 'Media',
    description: 'Audio, video, and streaming resources requested by the page.'
  },
  other: {
    label: 'Other',
    description: 'Traffic that does not map cleanly to the above classifications.'
  }
};

const PERMISSION_GUIDE = {
  geolocation: {
    label: 'Location',
    link: 'https://support.google.com/chrome/answer/142065',
    severity: 'high'
  },
  notifications: {
    label: 'Notifications',
    link: 'https://support.google.com/chrome/answer/3220216',
    severity: 'medium'
  },
  camera: {
    label: 'Camera',
    link: 'https://support.google.com/chrome/answer/2693767',
    severity: 'high'
  },
  microphone: {
    label: 'Microphone',
    link: 'https://support.google.com/chrome/answer/2693767',
    severity: 'high'
  }
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  bindStaticListeners();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      renderError(chrome.runtime.lastError.message);
      return;
    }
    const activeTab = tabs && tabs[0];
    if (!activeTab) {
      renderError('No active tab found.');
      return;
    }
    state.tabId = activeTab.id;
    state.tabUrl = activeTab.url;
    updateUrl(activeTab.url);
    requestTabData(activeTab.id, activeTab.url);
  });
}

function bindStaticListeners() {
  const trackerGroup = document.getElementById('tracker-filter-group');
  if (trackerGroup) {
    trackerGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter-tracker]');
      if (!button) {
        return;
      }
      const value = button.getAttribute('data-filter-tracker');
      if (value === state.filters.tracker) {
        return;
      }
      state.filters.tracker = value;
      trackerGroup.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.remove('is-active'));
      button.classList.add('is-active');
      renderRequests();
    });
  }

  const methodGroup = document.getElementById('method-filter-group');
  if (methodGroup) {
    methodGroup.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter-method]');
      if (!button) {
        return;
      }
      const value = button.getAttribute('data-filter-method');
      if (value === state.filters.method) {
        return;
      }
      state.filters.method = value;
      methodGroup.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.remove('is-active'));
      button.classList.add('is-active');
      renderRequests();
    });
  }

  const searchInput = document.getElementById('request-search');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.filters.search = event.target.value.trim().toLowerCase();
      renderRequests();
    });
  }

  const categoriesToggle = document.querySelector('[data-panel-toggle="categories"]');
  if (categoriesToggle) {
    categoriesToggle.addEventListener('click', (event) => {
      const button = event.currentTarget;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      const nextState = !expanded;
      button.setAttribute('aria-expanded', String(nextState));
      const panel = document.getElementById('categories-panel');
      if (panel) {
        panel.classList.toggle('panel--collapsed', !nextState);
      }
      button.textContent = nextState ? 'Collapse' : 'Expand';
    });
  }
}

function requestTabData(tabId, url) {
  chrome.runtime.sendMessage({ type: 'GET_TAB_DATA', tabId, url }, (response) => {
    if (chrome.runtime.lastError) {
      renderError(chrome.runtime.lastError.message);
      return;
    }
    if (!response || response.error) {
      renderError(response?.error || 'Failed to load data.');
      return;
    }
    renderData(response.data, response.history || []);
  });
}

function updateUrl(url) {
  const urlElement = document.getElementById('current-url');
  try {
    const parsed = new URL(url);
    urlElement.textContent = parsed.hostname;
  } catch (error) {
    urlElement.textContent = url;
  }
}

function renderData(data, history) {
  state.data = data;
  state.history = Array.isArray(history) ? history : [];
  state.requestCache = Array.isArray(data.requests) ? data.requests : [];
  state.methods = Object.keys(data.methodCounts || {});
  state.filters.method = 'all';

  updateRiskLevel(data.riskLevel, data);
  renderBreakdown(data);
  renderPermissions(data.permissionsUsed || []);
  renderCategories(data);
  renderHistory(state.history, data);
  renderGuidance(data, state.history);
  renderMethodFilters();
  renderRequests();
}

function renderMethodFilters() {
  const container = document.getElementById('method-filter-group');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const uniqueMethods = state.methods.filter(Boolean).sort();

  if (uniqueMethods.length <= 1) {
    container.classList.add('filters__chips--hidden');
    state.filters.method = 'all';
    return;
  }

  container.classList.remove('filters__chips--hidden');

  const methods = ['all', ...uniqueMethods];
  methods.forEach((method) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    button.setAttribute('data-filter-method', method);
    button.textContent = method === 'all' ? 'All Methods' : method.toUpperCase();
    if (method === state.filters.method) {
      button.classList.add('is-active');
    }
    container.appendChild(button);
  });
}

function renderBreakdown(data) {
  const totalRequests = Array.isArray(data.requests) ? data.requests.length : 0;
  const trackerHits = typeof data.trackerCount === 'number' ? data.trackerCount : 0;
  const permissionsCount = Array.isArray(data.permissionsUsed) ? data.permissionsUsed.length : 0;
  const trackerPercent = totalRequests > 0 ? Math.round((trackerHits / totalRequests) * 100) : 0;
  const topTracker = getTopTrackerDomain(data.requests || []);

  document.getElementById('breakdown-total').textContent = totalRequests.toString();
  const trackerValue = trackerHits > 0 ? `${trackerHits} (${trackerPercent}% of traffic)` : `${trackerHits}`;
  document.getElementById('breakdown-trackers').textContent = trackerValue;
  document.getElementById('breakdown-permissions').textContent = permissionsCount.toString();
  document.getElementById('breakdown-top-tracker').textContent = topTracker || 'None detected';
}

function renderPermissions(permissions) {
  const container = document.getElementById('permissions-list');
  if (!container) {
    return;
  }
  container.innerHTML = '';
  if (permissions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No permission usage detected yet.';
    container.appendChild(empty);
    return;
  }

  permissions.forEach((permission) => {
    const chip = document.createElement('span');
    const classes = [permissionToClass(permission)];
    if (isSensitivePermission(permission)) {
      classes.push('chip--alert');
    }
    chip.className = classes.join(' ');
    chip.textContent = formatPermissionLabel(permission);
    container.appendChild(chip);
  });
}

function renderCategories(data) {
  const panel = document.getElementById('categories-panel');
  const grid = document.getElementById('category-grid');
  if (!grid) {
    return;
  }
  grid.innerHTML = '';

  const categories = data.categories || {};
  const trackerCategories = data.trackerCategories || {};
  const total = Object.values(categories).reduce((sum, value) => sum + value, 0) || 1;

  Object.entries(CATEGORY_METADATA).forEach(([key, meta]) => {
    const totalCount = categories[key] || 0;
    const trackerCount = trackerCategories[key] || 0;
    const card = document.createElement('article');
    card.className = 'category-card';
    if (trackerCount > 0) {
      card.classList.add('category-card--tracker');
    }

    const header = document.createElement('header');
    header.className = 'category-card__header';
    const dot = document.createElement('span');
    dot.className = `category-card__dot category-card__dot--${key}`;
    const label = document.createElement('span');
    label.className = 'category-card__label';
    label.textContent = meta.label;
    header.appendChild(dot);
    header.appendChild(label);

    const count = document.createElement('div');
    count.className = 'category-card__count';
    count.textContent = totalCount.toString();

    const metaText = document.createElement('p');
    metaText.className = 'category-card__meta';
    metaText.textContent = meta.description;

    const footer = document.createElement('div');
    footer.className = 'category-card__footer';
    const trackerLabel = document.createElement('span');
    trackerLabel.textContent = `${trackerCount} tracker${trackerCount === 1 ? '' : 's'}`;
    const share = document.createElement('span');
    const percentage = Math.round((totalCount / total) * 100);
    share.textContent = `${Number.isFinite(percentage) ? percentage : 0}% of traffic`;

    footer.appendChild(trackerLabel);
    footer.appendChild(share);

    card.appendChild(header);
    card.appendChild(count);
    card.appendChild(metaText);
    card.appendChild(footer);

    grid.appendChild(card);
  });

  if (panel) {
    const hasTraffic = total > 1 || total === 1 && state.requestCache.length > 0;
    panel.classList.toggle('panel--empty', !hasTraffic);
  }
}

function renderHistory(history, currentData) {
  const sparkline = document.getElementById('history-sparkline');
  const list = document.getElementById('history-list');
  if (!sparkline || !list) {
    return;
  }
  sparkline.innerHTML = '';
  list.innerHTML = '';

  const entries = Array.isArray(history) ? [...history] : [];
  if (currentData && currentData.requests && currentData.requests.length > 0) {
    entries.push({
      timestamp: Date.now(),
      trackerCount: currentData.trackerCount,
      requestCount: currentData.requests.length,
      riskLevel: currentData.riskLevel,
      permissions: currentData.permissionsUsed,
      live: true
    });
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No historical data yet. Keep browsing to build a trend.';
    list.appendChild(empty);
    return;
  }

  const maxTrackers = Math.max(...entries.map((entry) => entry.trackerCount || 0), 1);
  entries.forEach((entry, index) => {
    const bar = document.createElement('div');
    const riskClass = (entry.riskLevel || 'low').toLowerCase();
    bar.className = `history__bar history__bar--${riskClass}`;
    const height = maxTrackers === 0 ? 10 : Math.max(8, Math.round((entry.trackerCount / maxTrackers) * 100));
    bar.style.height = `${height}%`;
    bar.title = `${entry.trackerCount || 0} tracker${entry.trackerCount === 1 ? '' : 's'}`;
    sparkline.appendChild(bar);

    const item = document.createElement('li');
    item.className = 'history__item';
    const label = document.createElement('div');
    label.className = 'history__meta';
    label.textContent = entry.live ? 'Current session' : formatRelativeDate(entry.timestamp, index === entries.length - 1);

    const stats = document.createElement('div');
    stats.className = 'history__stats';
    stats.textContent = `${entry.trackerCount || 0} trackers across ${entry.requestCount || 0} requests`;

    item.appendChild(label);
    item.appendChild(stats);
    list.appendChild(item);
  });
}

function renderGuidance(data, history) {
  const list = document.getElementById('guidance-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  const suggestions = buildGuidance(data, history);

  suggestions.forEach((suggestion) => {
    const item = document.createElement('li');
    item.className = `guidance-item guidance-item--${suggestion.severity}`;

    const title = document.createElement('h3');
    title.className = 'guidance-item__title';
    title.textContent = suggestion.title;

    const body = document.createElement('p');
    body.className = 'guidance-item__text';
    body.textContent = suggestion.description;

    item.appendChild(title);
    item.appendChild(body);

    if (suggestion.link) {
      const action = document.createElement('a');
      action.className = 'guidance-item__link';
      action.href = suggestion.link;
      action.target = '_blank';
      action.rel = 'noopener noreferrer';
      action.textContent = suggestion.cta || 'View instructions';
      item.appendChild(action);
    }

    list.appendChild(item);
  });
}

function renderRequests() {
  const list = document.getElementById('requests-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';

  const filtered = applyRequestFilters(state.requestCache);
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No requests match your filters. Adjust the filters or clear the search.';
    list.appendChild(empty);
    return;
  }

  filtered.forEach((request, index) => {
    const display = buildRequestDisplay(request);
    const item = document.createElement('li');
    item.className = request.isTracker ? 'timeline__item timeline__item--tracker' : 'timeline__item';

    const card = document.createElement('div');
    card.className = 'timeline__card';

    const header = document.createElement('div');
    header.className = 'timeline__header';

    const domain = document.createElement('span');
    domain.className = 'timeline__domain';
    domain.textContent = display.hostname;
    domain.title = display.fullUrl;

    const badge = document.createElement('span');
    badge.className = request.isTracker ? 'timeline__badge timeline__badge--tracker' : 'timeline__badge';
    badge.textContent = request.isTracker ? 'Tracker' : 'Request';
    if (request.trackerLabel) {
      badge.title = request.trackerLabel;
    }

    header.appendChild(domain);
    header.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'timeline__meta';

    const method = document.createElement('span');
    method.dataset.type = 'method';
    method.textContent = request.method || 'GET';

    const type = document.createElement('span');
    type.dataset.type = 'type';
    type.textContent = request.type || 'resource';

    const time = document.createElement('span');
    time.dataset.type = 'time';
    time.textContent = formatRequestTime(request.timestamp);

    meta.appendChild(method);
    meta.appendChild(type);
    meta.appendChild(time);

    card.appendChild(header);

    if (display.path && display.path !== '/') {
      const pathRow = document.createElement('div');
      pathRow.className = 'timeline__path-row';

      const summary = document.createElement('span');
      summary.className = 'timeline__path-summary';
      summary.textContent = display.path;
      summary.title = display.fullUrl;

      const pathLabel = document.createElement('button');
      pathLabel.className = 'timeline__path-toggle';
      pathLabel.type = 'button';
      pathLabel.textContent = 'Details';
      const uniqueId = `timeline-details-${request.timestamp}-${index}`;
      pathLabel.dataset.target = uniqueId;
      pathLabel.setAttribute('aria-expanded', 'false');

      pathRow.appendChild(summary);
      pathRow.appendChild(pathLabel);
      card.appendChild(pathRow);

      const details = document.createElement('div');
      details.id = uniqueId;
      details.className = 'timeline__details';
      details.textContent = display.fullUrl;
      details.hidden = true;
      card.appendChild(details);
    }

    card.appendChild(meta);
    item.appendChild(card);
    list.appendChild(item);
  });

  if (!list.dataset.bindToggle) {
    list.addEventListener('click', handleTimelineToggle);
    list.dataset.bindToggle = 'true';
  }
}

function applyRequestFilters(requests) {
  const { tracker, method, search } = state.filters;
  return requests.filter((request) => {
    if (tracker === 'tracker' && !request.isTracker) {
      return false;
    }
    if (tracker === 'normal' && request.isTracker) {
      return false;
    }
    if (method !== 'all') {
      const normalized = (request.method || 'GET').toLowerCase();
      if (normalized !== method.toLowerCase()) {
        return false;
      }
    }
    if (search) {
      const haystack = [request.domain, request.url, request.trackerLabel, request.trackerCategory]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

function renderError(message) {
  updateRiskLevel(null, {});
  renderBreakdown({ requests: [], trackerCount: 0, permissionsUsed: [] });
  renderPermissions([]);
  renderCategories({ categories: {}, trackerCategories: {} });
  renderHistory([], null);
  renderGuidance({ riskLevel: 'Low', permissionsUsed: [] }, []);

  const urlElement = document.getElementById('current-url');
  urlElement.textContent = 'Unavailable';
  const requestList = document.getElementById('requests-list');
  if (requestList) {
    requestList.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'empty-state';
    item.textContent = message || 'Unexpected error.';
    requestList.appendChild(item);
  }
}

function updateRiskLevel(riskLevel, data) {
  const popup = document.querySelector('.popup');
  const riskElement = document.getElementById('risk-level');
  const subtext = document.getElementById('risk-subtext');
  const classes = ['popup__risk-value--low', 'popup__risk-value--medium', 'popup__risk-value--high'];
  riskElement.classList.remove(...classes);

  if (!riskLevel) {
    riskElement.textContent = '--';
    subtext.textContent = 'Awaiting network activity';
    popup?.setAttribute('data-risk', 'unknown');
    return;
  }

  const normalized = riskLevel.toLowerCase();
  switch (normalized) {
    case 'low':
      riskElement.classList.add('popup__risk-value--low');
      riskElement.textContent = 'Low';
      subtext.textContent = generateRiskSubtext(normalized, data);
      popup?.setAttribute('data-risk', 'low');
      break;
    case 'medium':
    case 'moderate':
      riskElement.classList.add('popup__risk-value--medium');
      riskElement.textContent = 'Medium';
      subtext.textContent = generateRiskSubtext('medium', data);
      popup?.setAttribute('data-risk', 'medium');
      break;
    case 'high':
      riskElement.classList.add('popup__risk-value--high');
      riskElement.textContent = 'High';
      subtext.textContent = generateRiskSubtext('high', data);
      popup?.setAttribute('data-risk', 'high');
      break;
    default:
      riskElement.textContent = riskLevel;
      subtext.textContent = 'Analysis ongoing';
      popup?.setAttribute('data-risk', 'unknown');
      break;
  }
}

function generateRiskSubtext(riskLevel, data) {
  const total = Array.isArray(data?.requests) ? data.requests.length : 0;
  const trackers = typeof data?.trackerCount === 'number' ? data.trackerCount : 0;
  const permissions = Array.isArray(data?.permissionsUsed) ? data.permissionsUsed.length : 0;

  if (riskLevel === 'high') {
    if (trackers >= 5) {
      return 'Multiple trackers fired recently.';
    }
    if (permissions >= 2) {
      return 'Sensitive permissions requested in this session.';
    }
    return 'Elevated risk detected. Proceed with caution.';
  }

  if (riskLevel === 'medium') {
    if (trackers > 0) {
      return `${trackers} tracker${trackers > 1 ? 's' : ''} detected so far.`;
    }
    if (permissions > 0) {
      return 'This site requested extra permissions.';
    }
    return 'Some activity looks unusual.';
  }

  if (riskLevel === 'low') {
    if (total === 0) {
      return 'Monitoring in progress.';
    }
    return 'No suspicious activity spotted.';
  }

  return 'Analysis ongoing.';
}

function buildGuidance(data, history) {
  const suggestions = [];
  const trackerSurge = detectTrackerSurge(history, data);
  const sensitivePermissions = (data.permissionsUsed || []).filter(isSensitivePermission);

  if (data.riskLevel === 'High') {
    suggestions.push({
      severity: 'high',
      title: 'High risk detected',
      description: 'TraceLock spotted sustained tracker or permission activity. Consider tightening site permissions or using strict blocking mode.',
      link: 'https://support.google.com/chrome/answer/95647',
      cta: 'Review Chrome privacy settings'
    });
  }

  if (trackerSurge) {
    suggestions.push({
      severity: 'medium',
      title: 'Tracker activity is trending up',
      description: 'Compared to earlier visits, this session is firing more trackers. Refreshing with stricter content settings can reduce leakage.',
      link: 'https://support.google.com/chrome/answer/95647',
      cta: 'Tune site settings'
    });
  }

  sensitivePermissions.forEach((permission) => {
    const key = normalizePermission(permission);
    const guide = PERMISSION_GUIDE[key];
    if (!guide) {
      return;
    }
    suggestions.push({
      severity: guide.severity,
      title: `${guide.label} access requested`,
      description: `This site recently accessed ${guide.label.toLowerCase()} data. If this was not intentional, revoke it in Chrome settings.`,
      link: guide.link,
      cta: `Revoke ${guide.label}`
    });
  });

  if ((data.trackerCategories?.ads || 0) > 0 && (data.trackerCategories?.analytics || 0) > 0) {
    suggestions.push({
      severity: 'medium',
      title: 'Cross-network profiling in play',
      description: 'Both ad-tech and analytics trackers are active. Blocking third-party cookies can reduce profiling across sites.',
      link: 'https://support.google.com/chrome/answer/95647?hl=en#zippy=%2Cblock-third-party-cookies',
      cta: 'Block third-party cookies'
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      severity: 'low',
      title: 'All clear for now',
      description: 'TraceLock will keep watching this page. You can explore historical sessions below to spot any changes in behavior.'
    });
  }

  return suggestions;
}

function detectTrackerSurge(history, currentData) {
  if (!history || history.length === 0 || !currentData) {
    return false;
  }
  const lastEntry = history[history.length - 1];
  if (!lastEntry) {
    return false;
  }
  const previousTrackers = lastEntry.trackerCount || 0;
  return currentData.trackerCount > previousTrackers * 1.5 && currentData.trackerCount >= 3;
}

function normalizePermission(permission) {
  return (permission || '').toLowerCase();
}

function isSensitivePermission(permission) {
  const normalized = normalizePermission(permission);
  return Object.keys(PERMISSION_GUIDE).some((key) => normalized.includes(key));
}

function permissionToClass(permission) {
  const normalized = permission.toLowerCase();
  if (normalized.includes('microphone')) {
    return 'chip chip--microphone';
  }
  if (normalized.includes('camera')) {
    return 'chip chip--camera';
  }
  if (normalized.includes('notification')) {
    return 'chip chip--notifications';
  }
  if (normalized.includes('geo') || normalized.includes('location')) {
    return 'chip chip--geolocation';
  }
  return 'chip';
}

function formatPermissionLabel(permission) {
  return permission
    .split(/[_\s-]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function getTopTrackerDomain(requests) {
  if (!Array.isArray(requests)) {
    return null;
  }
  const counts = new Map();
  for (const request of requests) {
    if (!request || !request.isTracker) {
      continue;
    }
    let key = request.domain;
    if (!key) {
      key = safeHostname(request.url) || 'unknown';
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let topDomain = null;
  let topCount = 0;
  for (const [domain, count] of counts.entries()) {
    if (count > topCount) {
      topDomain = domain;
      topCount = count;
    }
  }
  return topDomain;
}

function safeHostname(url) {
  if (!url) {
    return '';
  }
  try {
    return new URL(url).hostname;
  } catch (error) {
    return '';
  }
}

function buildRequestDisplay(request) {
  const url = request.url || '';
  const hostname = request.domain || safeHostname(url) || shortUrl(url) || 'Unknown source';
  let path = '/';
  if (url) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || '/';
      const search = parsed.search || '';
      path = `${pathname}${search}`;
    } catch (error) {
      path = shortUrl(url);
    }
  }
  return {
    hostname,
    path,
    fullUrl: url || hostname
  };
}

function shortUrl(url) {
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch (error) {
    return url.length > 40 ? `${url.slice(0, 37)}...` : url;
  }
}

function formatRequestTime(timestamp) {
  if (!timestamp) {
    return 'time unknown';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'time unknown';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function handleTimelineToggle(event) {
  const button = event.target.closest('.timeline__path-toggle');
  if (!button) {
    return;
  }
  const targetId = button.dataset.target;
  const details = targetId ? document.getElementById(targetId) : null;
  if (!details) {
    return;
  }
  const expanded = button.getAttribute('aria-expanded') === 'true';
  const nextExpanded = !expanded;
  button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
  details.hidden = !nextExpanded;
}

function formatRelativeDate(timestamp, isLatest) {
  if (!timestamp) {
    return 'Earlier session';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Earlier session';
  }
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return isLatest ? 'Most recent visit' : 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString();
}
