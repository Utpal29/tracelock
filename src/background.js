// Background service worker for TraceLock. Tracks network activity, aggregates insights,
// persists lightweight history per site, and responds to popup data requests.
// TODO: Add Supabase sync.
// TODO: Add blocking (needs declarativeNetRequest).
// TODO: Add dashboard web app.

const tabData = {};
const injectedProbeTabs = new Set();
let trackerIndex = [];
let trackerListPromise = null;

const BASE_CATEGORIES = ['ads', 'analytics', 'cdn', 'social', 'api', 'media', 'other'];

function createEmptyTabData() {
  const categories = {};
  BASE_CATEGORIES.forEach((category) => {
    categories[category] = 0;
  });
  return {
    requests: [],
    trackerCount: 0,
    privacyScore: 100,
    permissionsUsed: [],
    riskLevel: 'Low',
    categories,
    trackerCategories: {},
    methodCounts: {},
    siteHost: null,
    lastUpdated: Date.now()
  };
}

function loadTrackerList() {
  if (!trackerListPromise) {
    const url = chrome.runtime.getURL('src/data/trackers.json');
    trackerListPromise = fetch(url)
      .then((response) => response.json())
      .then((entries) => {
        trackerIndex = Array.isArray(entries) ? entries : [];
      })
      .catch((error) => {
        console.error('TraceLock: failed to load tracker list', error);
        trackerIndex = [];
      });
  }
  return trackerListPromise;
}

loadTrackerList();

function ensureTabEntry(tabId) {
  if (!tabData[tabId]) {
    tabData[tabId] = createEmptyTabData();
  }
  return tabData[tabId];
}

function archiveTabData(tabId) {
  const data = tabData[tabId];
  if (!data || !data.siteHost || data.requests.length === 0) {
    return Promise.resolve();
  }
  updateRiskLevel(data);
  return persistSiteHistory(data).catch((error) => {
    console.warn('TraceLock: failed to archive tab data', error);
  });
}

function resetTab(tabId) {
  archiveTabData(tabId);
  tabData[tabId] = createEmptyTabData();
  injectedProbeTabs.delete(tabId);
}

function safeHostname(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch (error) {
    return null;
  }
}

function findTrackerInfo(hostname) {
  if (!hostname) {
    return null;
  }
  for (const tracker of trackerIndex) {
    if (hostname === tracker.domain || hostname.endsWith(`.${tracker.domain}`)) {
      return tracker;
    }
  }
  return null;
}

function determineCategory(requestType, trackerInfo) {
  if (trackerInfo && trackerInfo.category) {
    return trackerInfo.category;
  }
  const type = (requestType || 'other').toLowerCase();
  if (['image', 'imageset', 'font', 'stylesheet', 'script'].includes(type)) {
    return 'cdn';
  }
  if (['media', 'video', 'audio'].includes(type)) {
    return 'media';
  }
  if (['xmlhttprequest', 'fetch', 'websocket'].includes(type)) {
    return 'api';
  }
  return 'other';
}

function updateRiskLevel(data) {
  const totalRequests = data.requests.length;
  const trackerHits = data.trackerCount;
  const permissions = data.permissionsUsed.length;
  const trackerRatio = totalRequests > 0 ? trackerHits / totalRequests : 0;

  let risk = 'Low';
  if (trackerHits >= 5 || permissions >= 2 || trackerRatio >= 0.5 || data.privacyScore <= 60) {
    risk = 'High';
  } else if (trackerHits >= 1 || permissions >= 1 || trackerRatio >= 0.2 || data.privacyScore < 85) {
    risk = 'Medium';
  }

  data.riskLevel = risk;
}

function recordRequest(details) {
  if (details.tabId < 0) {
    return;
  }

  const data = ensureTabEntry(details.tabId);
  let hostname = '';

  try {
    hostname = new URL(details.url).hostname;
  } catch (error) {
    console.warn('TraceLock: could not parse URL', details.url, error);
  }

  if (!data.siteHost && details.type === 'main_frame') {
    data.siteHost = hostname;
  }

  const trackerInfo = findTrackerInfo(hostname);
  const category = determineCategory(details.type, trackerInfo);

  const requestRecord = {
    url: details.url,
    domain: hostname,
    method: details.method,
    type: details.type,
    isTracker: Boolean(trackerInfo),
    trackerCategory: trackerInfo?.category || null,
    trackerLabel: trackerInfo?.label || null,
    category,
    timestamp: Date.now()
  };

  data.requests.push(requestRecord);
  if (data.requests.length > 200) {
    data.requests.shift();
  }

  if (!Object.prototype.hasOwnProperty.call(data.categories, category)) {
    data.categories[category] = 0;
  }
  data.categories[category] += 1;

  if (trackerInfo) {
    data.trackerCount += 1;
    data.trackerCategories[trackerInfo.category] =
      (data.trackerCategories[trackerInfo.category] || 0) + 1;
    data.privacyScore = Math.max(0, data.privacyScore - 5);
  }

  const method = details.method || 'UNKNOWN';
  data.methodCounts[method] = (data.methodCounts[method] || 0) + 1;
  data.lastUpdated = Date.now();

  updateRiskLevel(data);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    loadTrackerList().then(() => recordRequest(details));
  },
  { urls: ['<all_urls>'] },
  []
);

chrome.tabs.onRemoved.addListener((tabId) => {
  archiveTabData(tabId).finally(() => {
    delete tabData[tabId];
    injectedProbeTabs.delete(tabId);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const host = safeHostname(changeInfo.url);
    if (host) {
      ensureTabEntry(tabId).siteHost = host;
    }
  }
  if (changeInfo.status === 'loading') {
    resetTab(tabId);
  }
});

function handlePermissionUsed(message, sender) {
  const tabId = message.tabId ?? sender.tab?.id;
  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }
  const data = ensureTabEntry(tabId);
  if (!data.permissionsUsed.includes(message.permission)) {
    data.permissionsUsed.push(message.permission);
    data.lastUpdated = Date.now();
    updateRiskLevel(data);
  }
}

function cloneTabData(data) {
  return {
    requests: data.requests.map((request) => ({ ...request })),
    trackerCount: data.trackerCount,
    privacyScore: data.privacyScore,
    permissionsUsed: [...data.permissionsUsed],
    riskLevel: data.riskLevel,
    categories: { ...data.categories },
    trackerCategories: { ...data.trackerCategories },
    methodCounts: { ...data.methodCounts },
    siteHost: data.siteHost,
    lastUpdated: data.lastUpdated
  };
}

function buildTabSnapshot(tabId) {
  const data = tabData[tabId];
  if (!data) {
    return {
      requests: [],
      trackerCount: 0,
      privacyScore: 100,
      permissionsUsed: [],
      riskLevel: 'Low',
      categories: createEmptyTabData().categories,
      trackerCategories: {},
      methodCounts: {},
      siteHost: null,
      lastUpdated: Date.now()
    };
  }
  updateRiskLevel(data);
  return cloneTabData(data);
}

async function persistSiteHistory(data) {
  if (!data.siteHost) {
    return;
  }
  const snapshot = {
    timestamp: Date.now(),
    riskLevel: data.riskLevel,
    trackerCount: data.trackerCount,
    requestCount: data.requests.length,
    permissions: [...data.permissionsUsed],
    categories: { ...data.categories },
    trackerCategories: { ...data.trackerCategories }
  };
  try {
    const { siteHistory = {} } = await chrome.storage.local.get('siteHistory');
    const existing = Array.isArray(siteHistory[data.siteHost]) ? siteHistory[data.siteHost] : [];
    existing.push(snapshot);
    siteHistory[data.siteHost] = existing.slice(-7);
    await chrome.storage.local.set({ siteHistory });
  } catch (error) {
    console.error('TraceLock: failed to persist site history', error);
  }
}

async function loadSiteHistoryForHost(host) {
  if (!host) {
    return [];
  }
  try {
    const { siteHistory = {} } = await chrome.storage.local.get('siteHistory');
    const history = siteHistory[host];
    if (!Array.isArray(history)) {
      return [];
    }
    return history.slice(-7);
  } catch (error) {
    console.error('TraceLock: failed to load site history', error);
    return [];
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  switch (message.type) {
    case 'GET_TAB_DATA': {
      const tabId = message.tabId;
      if (typeof tabId !== 'number') {
        sendResponse({ error: 'Missing tabId for GET_TAB_DATA' });
        return false;
      }
      loadTrackerList()
        .then(async () => {
          if (message.url) {
            const host = safeHostname(message.url);
            if (host) {
              ensureTabEntry(tabId).siteHost = host;
            }
          }
          const snapshot = buildTabSnapshot(tabId);
          const history = await loadSiteHistoryForHost(snapshot.siteHost);
          sendResponse({ data: snapshot, history });
        })
        .catch((error) => {
          console.error('TraceLock: failed to build tab snapshot', error);
          sendResponse({ error: 'Failed to load data' });
        });
      return true;
    }
    case 'INJECT_PERMISSION_PROBE': {
      const tabId = sender.tab?.id ?? message.tabId;
      if (typeof tabId !== 'number') {
        sendResponse({ error: 'Missing tabId for injection' });
        return false;
      }
      if (injectedProbeTabs.has(tabId)) {
        sendResponse({ ok: true, alreadyInjected: true });
        return false;
      }
      chrome.scripting
        .executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['src/page/probe.js']
        })
        .then(() => {
          injectedProbeTabs.add(tabId);
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error('TraceLock: failed to execute permission probe', error);
          sendResponse({ error: error?.message || 'Injection failed' });
        });
      return true;
    }
    case 'PERMISSION_USED':
      handlePermissionUsed(message, sender);
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});
