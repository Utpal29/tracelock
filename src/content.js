// Content script that injects permission monitors into the page and forwards usage signals.

const MESSAGE_SOURCE = 'TraceLockPermissionProbe';
const reportedPermissions = new Set();

function reportPermission(permission) {
  if (!permission || reportedPermissions.has(permission)) {
    return;
  }
  reportedPermissions.add(permission);
  try {
    chrome.runtime.sendMessage({
      type: 'PERMISSION_USED',
      permission
    });
  } catch (error) {
    console.warn('TraceLock: failed to report permission usage', permission, error);
  }
}

function handlePageMessage(event) {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  if (!data || data.source !== MESSAGE_SOURCE || typeof data.permission !== 'string') {
    return;
  }
  reportPermission(data.permission);
}

window.addEventListener('message', handlePageMessage, false);
requestPermissionProbe();

function requestPermissionProbe() {
  try {
    chrome.runtime.sendMessage({ type: 'INJECT_PERMISSION_PROBE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('TraceLock: failed to inject permission probe', chrome.runtime.lastError);
        return;
      }
      if (response && response.error) {
        console.warn('TraceLock: permission probe injection error', response.error);
      }
    });
  } catch (error) {
    console.warn('TraceLock: unexpected error requesting probe injection', error);
  }
}

// TODO: Make permission detection work in Firefox/Edge specific APIs.
