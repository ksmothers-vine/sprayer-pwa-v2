// Add these variables at the top
let currentSpraySession = null;

// Add this after your DOM elements
const startScreen = document.getElementById('start-screen');
const newSprayBtn = document.getElementById('new-spray');
const continueSprayBtn = document.getElementById('continue-spray');
const appContainer = document.querySelector('.app-container');

// Add these event listeners
newSprayBtn.addEventListener('click', startNewSpray);
continueSprayBtn.addEventListener('click', continueSpray);

// Add these functions
function startNewSpray() {
  // Hide start screen and show app
  startScreen.style.display = 'none';
  appContainer.style.display = 'flex';
  
  // Reset any existing data
  clearPath();
  sprayerData.history = [];
  flowChart.data.labels = [];
  flowChart.data.datasets[0].data = [];
  flowChart.update();
  
  // Create new spray session
  currentSpraySession = {
    id: Date.now(),
    startTime: new Date(),
    endTime: null,
    path: [],
    flowRates: []
  };
  
  // Start tracking automatically
  startTracking();
}

async function continueSpray() {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['spraySessions'], 'readonly');
    const store = transaction.objectStore('spraySessions');
    const request = store.getAll();
    
    request.onsuccess = () => {
      const sessions = request.result
        .filter(s => s.endTime === null)
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      
      if (sessions.length === 0) {
        alert('No active spray sessions found');
        return;
      }
      
      // Get the most recent unfinished session
      const session = sessions[0];
      currentSpraySession = session;
      
      // Hide start screen and show app
      startScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      
      // Load the session data
      if (session.path && session.path.length > 0) {
        sprayPath = session.path;
        pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
        map.setView(sprayPath[sprayPath.length - 1], 15);
      }
      
      if (session.flowRates && session.flowRates.length > 0) {
        flowChart.data.labels = session.flowRates.map((_, i) => i.toString());
        flowChart.data.datasets[0].data = session.flowRates.map(f => f.rate);
        flowChart.update();
      }
      
      // Start tracking
      isTracking = true;
      document.getElementById('start-tracking').disabled = true;
      document.getElementById('stop-tracking').disabled = false;
    };
  } catch (error) {
    console.error('Error continuing spray:', error);
    alert('Error loading spray session');
  }
}

// Modify your openDatabase function to include spray sessions
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SprayerDataDB', 3); // Version 3
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('sensorReadings')) {
        const readingsStore = db.createObjectStore('sensorReadings', { keyPath: 'timestamp' });
        readingsStore.createIndex('by_timestamp', 'timestamp', { unique: true });
      }
      
      if (!db.objectStoreNames.contains('sprayPaths')) {
        const pathsStore = db.createObjectStore('sprayPaths', { keyPath: 'timestamp' });
        pathsStore.createIndex('by_date', 'timestamp', { unique: true });
      }
      
      if (!db.objectStoreNames.contains('spraySessions')) {
        const sessionsStore = db.createObjectStore('spraySessions', { keyPath: 'id' });
        sessionsStore.createIndex('by_startTime', 'startTime');
        sessionsStore.createIndex('unfinished', 'endTime');
      }
    };
    
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Modify your stopTracking function to save the session
async function stopTracking() {
  isTracking = false;
  document.getElementById('start-tracking').disabled = false;
  document.getElementById('stop-tracking').disabled = true;
  
  if (currentSpraySession) {
    currentSpraySession.endTime = new Date();
    currentSpraySession.path = sprayPath;
    currentSpraySession.flowRates = sprayerData.history.map(entry => ({
      rate: entry.flowRate,
      time: entry.timestamp
    }));
    
    try {
      const db = await openDatabase();
      const transaction = db.transaction(['spraySessions'], 'readwrite');
      const store = transaction.objectStore('spraySessions');
      store.put(currentSpraySession);
    } catch (error) {
      console.error('Error saving spray session:', error);
    }
  }
  
  // Save the path separately as well
  if (sprayPath.length > 0) {
    saveSprayPath();
  }
}

// Update your showHistory function to show sessions
async function showHistory() {
  const modal = document.getElementById('history-modal');
  const pathList = document.getElementById('path-list');
  pathList.innerHTML = '';
  
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['spraySessions'], 'readonly');
    const store = transaction.objectStore('spraySessions');
    const request = store.index('by_startTime').getAll();
    
    request.onsuccess = () => {
      const sessions = request.result;
      
      if (sessions.length === 0) {
        pathList.innerHTML = '<li>No spray history found</li>';
        modal.style.display = 'block';
        return;
      }
      
      sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
      
      sessions.forEach(session => {
        const li = document.createElement('li');
        const startDate = new Date(session.startTime);
        const endDate = session.endTime ? new Date(session.endTime) : null;
        
        const duration = endDate 
          ? `${Math.round((endDate - startDate) / 60000)} minutes` 
          : 'Incomplete';
        
        li.innerHTML = `
          <div class="session-info">
            <strong>${startDate.toLocaleString()}</strong>
            <div>Duration: ${duration}</div>
            <div>Path Points: ${session.path ? session.path.length : 0}</div>
          </div>
          <div class="session-actions">
            <button class="view-session" data-id="${session.id}">View</button>
            ${!session.endTime ? `<button class="continue-session" data-id="${session.id}">Continue</button>` : ''}
            <button class="delete-session" data-id="${session.id}">Delete</button>
          </div>
        `;
        
        pathList.appendChild(li);
      });
      
      // Add event listeners to the new buttons
      document.querySelectorAll('.view-session').forEach(btn => {
        btn.addEventListener('click', (e) => viewSession(e.target.dataset.id));
      });
      
      document.querySelectorAll('.continue-session').forEach(btn => {
        btn.addEventListener('click', (e) => continueSession(e.target.dataset.id));
      });
      
      document.querySelectorAll('.delete-session').forEach(btn => {
        btn.addEventListener('click', (e) => deleteSession(e.target.dataset.id));
      });
      
      modal.style.display = 'block';
    };
  } catch (error) {
    console.error('Error loading history:', error);
    pathList.innerHTML = '<li>Error loading history</li>';
    modal.style.display = 'block';
  }
}

async function viewSession(sessionId) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['spraySessions'], 'readonly');
    const store = transaction.objectStore('spraySessions');
    const request = store.get(Number(sessionId));
    
    request.onsuccess = () => {
      const session = request.result;
      if (!session) return;
      
      // Hide start screen and show app
      startScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      
      // Stop any current tracking
      isTracking = false;
      document.getElementById('start-tracking').disabled = false;
      document.getElementById('stop-tracking').disabled = true;
      
      // Display the session data
      clearPath();
      if (session.path && session.path.length > 0) {
        sprayPath = session.path;
        pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
        map.setView(sprayPath[sprayPath.length - 1], 15);
      }
      
      if (session.flowRates && session.flowRates.length > 0) {
        flowChart.data.labels = session.flowRates.map((_, i) => i.toString());
        flowChart.data.datasets[0].data = session.flowRates.map(f => f.rate);
        flowChart.update();
      }
      
      // Update the display with the last recorded values
      if (session.flowRates && session.flowRates.length > 0) {
        const lastReading = session.flowRates[session.flowRates.length - 1];
        flowRateDisplay.textContent = lastReading.rate.toFixed(2);
      }
      
      hideHistory();
    };
  } catch (error) {
    console.error('Error viewing session:', error);
  }
}

async function continueSession(sessionId) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['spraySessions'], 'readwrite');
    const store = transaction.objectStore('spraySessions');
    const request = store.get(Number(sessionId));
    
    request.onsuccess = () => {
      const session = request.result;
      if (!session) return;
      
      currentSpraySession = session;
      
      // Hide start screen and show app
      startScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      
      // Load the session data
      if (session.path && session.path.length > 0) {
        sprayPath = session.path;
        pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
        map.setView(sprayPath[sprayPath.length - 1], 15);
      }
      
      if (session.flowRates && session.flowRates.length > 0) {
        flowChart.data.labels = session.flowRates.map((_, i) => i.toString());
        flowChart.data.datasets[0].data = session.flowRates.map(f => f.rate);
        flowChart.update();
      }
      
      // Start tracking
      isTracking = true;
      document.getElementById('start-tracking').disabled = true;
      document.getElementById('stop-tracking').disabled = false;
      
      hideHistory();
    };
  } catch (error) {
    console.error('Error continuing session:', error);
  }
}

async function deleteSession(sessionId) {
  if (!confirm('Delete this spray session?')) return;
  
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['spraySessions'], 'readwrite');
    const store = transaction.objectStore('spraySessions');
    store.delete(Number(sessionId));
    
    // Refresh the list
    showHistory();
  } catch (error) {
    console.error('Error deleting session:', error);
  }
}