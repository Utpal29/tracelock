// Injected page script that hooks permission-related APIs and reports usage to the content script.
(function initTraceLockProbe() {
  const messageSource = 'TraceLockPermissionProbe';
  const reported = new Set();

  function notify(permission) {
    if (!permission || reported.has(permission)) {
      return;
    }
    reported.add(permission);
    try {
      window.postMessage({ source: messageSource, permission }, '*');
    } catch (error) {
      // Silently ignore postMessage failures inside the page context.
    }
  }

  (function patchGeolocation() {
    const geo = navigator.geolocation;
    if (!geo) {
      return;
    }

    const originalGetCurrentPosition = geo.getCurrentPosition && geo.getCurrentPosition.bind(geo);
    if (originalGetCurrentPosition) {
      geo.getCurrentPosition = function patchedGetCurrentPosition(...args) {
        notify('geolocation');
        return originalGetCurrentPosition(...args);
      };
    }

    const originalWatchPosition = geo.watchPosition && geo.watchPosition.bind(geo);
    if (originalWatchPosition) {
      geo.watchPosition = function patchedWatchPosition(...args) {
        notify('geolocation');
        return originalWatchPosition(...args);
      };
    }
  })();

  (function patchNotificationPermission() {
    if (typeof Notification === 'undefined' || !Notification.requestPermission) {
      return;
    }

    const originalRequestPermission = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function patchedRequestPermission(...args) {
      notify('notifications');
      return originalRequestPermission(...args);
    };
  })();

  (function patchMediaDevices() {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) {
      return;
    }

    const originalGetUserMedia = mediaDevices.getUserMedia && mediaDevices.getUserMedia.bind(mediaDevices);
    if (originalGetUserMedia) {
      mediaDevices.getUserMedia = function patchedGetUserMedia(constraints) {
        if (constraints && typeof constraints === 'object') {
          if (constraints.audio) {
            notify('microphone');
          }
          if (constraints.video) {
            notify('camera');
          }
        }
        return originalGetUserMedia(constraints);
      };
    }
  })();
})();
