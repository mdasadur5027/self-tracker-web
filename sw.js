const CACHE_NAME = 'life-tracker-v1';
const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
];

// Timer state storage
let activeTimers = new Map();

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      }
    )
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Handle timer operations
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  
  console.log('Service Worker: received message', { type, data });
  
  switch (type) {
    case 'START_TIMER':
      startBackgroundTimer(data);
      break;
    case 'PAUSE_TIMER':
      pauseBackgroundTimer(data.timerId, data.accumulatedTime);
      break;
    case 'STOP_TIMER':
      console.log('Service Worker: processing STOP_TIMER', data);
      stopBackgroundTimer(data.timerId);
      break;
    case 'GET_TIMER_STATE':
      getTimerState(event);
      break;
    case 'SYNC_STUDY_SESSION':
      syncStudySession(data);
      break;
    default:
      console.log('Service Worker: unknown message type', type);
  }
});

// Background timer functions
function startBackgroundTimer(timerData) {
  const { timerId, startTime, subject, userId, accumulatedTime = 0 } = timerData;
  
  // Store timer state
  activeTimers.set(timerId, {
    startTime,
    subject,
    userId,
    isActive: true,
    pausedTime: null,
    accumulatedTime
  });
  
  // Store in IndexedDB for persistence
  storeTimerState(timerId, activeTimers.get(timerId));
  
  // Send notification when timer reaches certain milestones
  scheduleTimerNotifications(timerId, startTime);
}

function pauseBackgroundTimer(timerId, accumulatedTime = 0) {
  const timer = activeTimers.get(timerId);
  if (timer) {
    timer.isActive = false;
    timer.pausedTime = Date.now();
    timer.accumulatedTime = accumulatedTime;
    storeTimerState(timerId, timer);
  }
}

function stopBackgroundTimer(timerId) {
  console.log('Service Worker: stopBackgroundTimer called', { timerId });
  
  const timer = activeTimers.get(timerId);
  if (timer) {
    console.log('Service Worker: found timer, stopping it', timer);
    timer.isActive = false;
    activeTimers.delete(timerId);
    removeTimerState(timerId);
    console.log('Service Worker: timer stopped and removed');
  } else {
    console.log('Service Worker: timer not found', { timerId, activeTimers: Array.from(activeTimers.keys()) });
  }
}

function getTimerState(event) {
  const timerId = event.data.timerId;
  const timer = activeTimers.get(timerId);
  
  if (timer) {
    const currentTime = Date.now();
    const elapsed = timer.isActive ? 
      (currentTime - timer.startTime) / 1000 : 
      (timer.pausedTime - timer.startTime) / 1000;
    
    event.ports[0].postMessage({
      type: 'TIMER_STATE',
      data: {
        timerId,
        elapsed,
        isActive: timer.isActive,
        subject: timer.subject,
        startTime: timer.startTime
      }
    });
  } else {
    event.ports[0].postMessage({
      type: 'TIMER_STATE',
      data: null
    });
  }
}

// IndexedDB operations for timer persistence
function storeTimerState(timerId, timerData) {
  const request = indexedDB.open('StudyTimerDB', 1);
  
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('timers')) {
      db.createObjectStore('timers', { keyPath: 'timerId' });
    }
  };
  
  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['timers'], 'readwrite');
    const store = transaction.objectStore('timers');
    store.put({ timerId, ...timerData });
  };
}

function removeTimerState(timerId) {
  const request = indexedDB.open('StudyTimerDB', 1);
  
  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['timers'], 'readwrite');
    const store = transaction.objectStore('timers');
    store.delete(timerId);
  };
}

// Schedule notifications for timer milestones
function scheduleTimerNotifications(timerId, startTime) {
  const milestones = [25 * 60 * 1000, 50 * 60 * 1000, 60 * 60 * 1000]; // 25min, 50min, 1hour
  
  milestones.forEach(milestone => {
    const notificationTime = startTime + milestone;
    const delay = notificationTime - Date.now();
    
    if (delay > 0) {
      setTimeout(() => {
        showTimerNotification(timerId, milestone / (60 * 1000));
      }, delay);
    }
  });
}

// Show notification
function showTimerNotification(timerId, minutes) {
  if ('Notification' in self && Notification.permission === 'granted') {
    new Notification('Study Timer', {
      body: `You've been studying for ${minutes} minutes! Great job!`,
      icon: '/manifest.json',
      badge: '/manifest.json',
      tag: `study-timer-${timerId}`
    });
  }
}

// Background sync for study sessions
function syncStudySession(sessionData) {
  // This would sync with your backend when online
  // For now, we'll just store it locally
  const request = indexedDB.open('StudyTimerDB', 1);
  
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains('study_sessions')) {
      db.createObjectStore('study_sessions', { keyPath: 'id', autoIncrement: true });
    }
  };
  
  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction(['study_sessions'], 'readwrite');
    const store = transaction.objectStore('study_sessions');
    store.add(sessionData);
  };
}

// Background sync event
self.addEventListener('sync', (event) => {
  if (event.tag === 'study-session-sync') {
    event.waitUntil(syncPendingSessions());
  }
});

async function syncPendingSessions() {
  // Sync pending study sessions with backend
  // This would be implemented based on your backend API
  console.log('Syncing pending study sessions...');
}