// App state
let sprayerData = {
  flowRate: 0,
  location: { lat: 0, lng: 0 },
  history: []
};

let isTracking = false;
let sprayPath = [];
let pathPolyline = null;
let currentSpraySession = null;

// DOM elements
const startScreen = document.getElementById('start-screen');
const newSprayBtn = document.getElementById('new-spray');
const continueSprayBtn = document.getElementById('continue-spray');
const appContainer = document.querySelector('.app-container');
const connectBtn = document.getElementById('connect-btn');
const viewHistoryBtn = document.getElementById('view-history-btn');
const startTrackingBtn = document.getElementById('start-tracking');
const stopTrackingBtn = document.getElementById('stop-tracking');
const clearPathBtn = document.getElementById('clear-path');
const connectionStatus = document.getElementById('connection-status');
const flowRateDisplay = document.getElementById('flow-rate');

// Initialize map
const map = L.map('map').setView([38.6270, -90.1994], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
const sprayerMarker = L.marker([0, 0]).addTo(map);

// Initialize chart
const flowChart = new Chart(
  document.getElementById('flow-chart'),
  {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Flow Rate (L/min)',
        data: [],
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  }
);

// Event listeners
newSprayBtn.addEventListener('click', startNewSpray);
continueSprayBtn.addEventListener('click', continueSpray);
connectBtn.addEventListener('click', connectToSprayer);
viewHistoryBtn.addEventListener('click', showHistory);
startTrackingBtn.addEventListener('click', startTracking);
stopTrackingBtn.addEventListener('click', stopTracking);
clearPathBtn.addEventListener('click', clearPath);

// Start screen functions
function startNewSpray() {
  startScreen.style.display = 'none';
  appContainer.style.display = 'flex';
  
  // Reset data
  clearPath();
  sprayerData.history = [];
  flowChart.data.labels = [];
  flowChart.data.datasets[0].data = [];
  flowChart.update();
  
  // Create new session
  currentSpraySession = {
    id: Date.now(),
    startTime: new Date(),
    endTime: null,
    path: [],
    flowRates: []
  };
  
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
      
      const session = sessions[0];
      currentSpraySession = session;
      
      startScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      
      if (session.path?.length > 0) {
        sprayPath = session.path;
        pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
        map.setView(sprayPath[sprayPath.length - 1], 15);
      }
      
      if (session.flowRates?.length > 0) {
        flowChart.data.labels = session.flowRates.map((_, i) => i.toString());
        flowChart.data.datasets[0].data = session.flowRates.map(f => f.rate);
        flowChart.update();
      }
      
      isTracking = true;
      startTrackingBtn.disabled = true;
      stopTrackingBtn.disabled = false;
    };
  } catch (error) {
    console.error('Error continuing spray:', error);
    alert('Error loading spray session');
  }
}

// Bluetooth connection
async function connectToSprayer() {
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'VineyardSprayer' }],
      optionalServices: ['0000ff00-0000-1000-8000-00805f9b34fb']
    });
    
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('0000ff00-0000-1000-8000-00805f9b34fb');
    const characteristic = await service.getCharacteristic('0000ff01-0000-1000-8000-00805f9b34fb');
    
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'connected';
    
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', handleData);
    
    device.addEventListener('gattserverdisconnected', () => {
      connectionStatus.textContent = 'Disconnected';
      connectionStatus.className = 'disconnected';
    });
    
  } catch (error) {
    console.error('Bluetooth error:', error);
    connectionStatus.textContent = 'Connection Failed';
    connectionStatus.className = 'error';
  }
}

// Data handling
function handleData(event) {
  const value = event.target.value;
  const decoder = new TextDecoder('utf-8');
  const jsonString = decoder.decode(value);
  
  try {
    const data = JSON.parse(jsonString);
    updateDisplay(data);
    updateMap(data);
    updateChart(data);
    
    sprayerData = { ...sprayerData, ...data };
    sprayerData.history.push({ ...data, timestamp: new Date() });
    
    if (data.lat && data.lng) {
      updatePath(data.lat, data.lng);
    }
    
    storeDataLocally(data);
  } catch (e) {
    console.error('Error parsing data:', e);
  }
}

function updateDisplay(data) {
  if (data.flowRate !== undefined) {
    flowRateDisplay.textContent = data.flowRate.toFixed(2);
  }
}

function updateMap(data) {
  if (data.lat && data.lng) {
    sprayerMarker.setLatLng([data.lat, data.lng]);
    map.setView([data.lat, data.lng], 15);
  }
}

function updateChart(data) {
  if (data.flowRate !== undefined) {
    const labels = flowChart.data.labels;
    const dataset = flowChart.data.datasets[0].data;
    
    labels.push(new Date().toLocaleTimeString());
    dataset.push(data.flowRate);
    
    if (labels.length > 20) {
      labels.shift();
      dataset.shift();
    }
    
    flowChart.update();
  }
}

// Path tracking
function startTracking() {
  isTracking = true;
  startTrackingBtn.disabled = true;
  stopTrackingBtn.disabled = false;
  sprayPath = [];
  
  if (pathPolyline) {
    map.removeLayer(pathPolyline);
  }
  
  if (sprayerData.lat && sprayerData.lng) {
    sprayPath.push([sprayerData.lat, sprayerData.lng]);
    pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
  }
}

function stopTracking() {
  isTracking = false;
  startTrackingBtn.disabled = false;
  stopTrackingBtn.disabled = true;
  
  if (currentSpraySession) {
    currentSpraySession.endTime = new Date();
    currentSpraySession.path = sprayPath;
    currentSpraySession.flowRates = sprayerData.history.map(entry => ({
      rate: entry.flowRate,
      time: entry.timestamp
    }));
    
    saveSpraySession(currentSpraySession);
  }
  
  if (sprayPath.length > 0) {
    saveSprayPath();
  }
}

function clearPath() {
  if (pathPolyline) {
    map.removeLayer(pathPolyline);
    pathPolyline = null;
  }
  sprayPath = [];
}

function updatePath(lat, lng) {
  if (!isTracking) return;
  
  sprayPath.push([lat, lng]);
  
  if (!pathPolyline) {
    pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
  } else {
    pathPolyline.setLatLngs(sprayPath);
  }
  
  map.setView([lat, lng]);
}

// Database functions
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SprayerDataDB', 3);
    
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

async function storeDataLocally(data) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['sensorReadings'], 'readwrite');
    const store = transaction.objectStore('sensorReadings');
    
    const record = {
      ...data,
      timestamp: new Date().toISOString()
    };
    
    store.put(record);
  } catch (error) {
    console.error('Error storing data:', error);
  }
}

async function saveSprayPath() {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['sprayPaths'], 'readwrite');
    const store = transaction.objectStore('sprayPaths');
    
    const pathRecord = {
      timestamp: new Date().toISOString(),
      coordinates: sprayPath,
      flowRates: sprayerData.history.map(entry => ({
        lat: entry.lat,
        lng: entry.lng,
        flowRate: entry.flowRate,
        time: entry.timestamp
      }))
    };
    
    store.put(pathRecord);
  } catch (error) {
    console.error('Error saving spray path:', error);
  }
}

async function saveSpraySession(session) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['spraySessions'], 'readwrite');
    const store = transaction.objectStore('spraySessions');
    store.put(session);
  } catch (error) {
    console.error('Error saving session:', error);
  }
}

// History functions
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
            <div>Path Points: ${session.path?.length || 0}</div>
          </div>
          <div class="session-actions">
            <button class="view-session" data-id="${session.id}">View</button>
            ${!session.endTime ? `<button class="continue-session" data-id="${session.id}">Continue</button>` : ''}
            <button class="delete-session" data-id="${session.id}">Delete</button>
          </div>
        `;
        
        pathList.appendChild(li);
      });
      
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

function hideHistory() {
  document.getElementById('history-modal').style.display = 'none';
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
      
      startScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      
      isTracking = false;
      startTrackingBtn.disabled = false;
      stopTrackingBtn.disabled = true;
      
      clearPath();
      if (session.path?.length > 0) {
        sprayPath = session.path;
        pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
        map.setView(sprayPath[sprayPath.length - 1], 15);
      }
      
      if (session.flowRates?.length > 0) {
        flowChart.data.labels = session.flowRates.map((_, i) => i.toString());
        flowChart.data.datasets[0].data = session.flowRates.map(f => f.rate);
        flowChart.update();
        
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
      
      startScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      
      if (session.path?.length > 0) {
        sprayPath = session.path;
        pathPolyline = L.polyline(sprayPath, {color: 'blue'}).addTo(map);
        map.setView(sprayPath[sprayPath.length - 1], 15);
      }
      
      if (session.flowRates?.length > 0) {
        flowChart.data.labels = session.flowRates.map((_, i) => i.toString());
        flowChart.data.datasets[0].data = session.flowRates.map(f => f.rate);
        flowChart.update();
      }
      
      isTracking = true;
      startTrackingBtn.disabled = true;
      stopTrackingBtn.disabled = false;
      
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
    
    showHistory();
  } catch (error) {
    console.error('Error deleting session:', error);
  }
}

// Close modal when clicking outside
document.getElementById('history-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('history-modal')) {
    hideHistory();
  }
});

document.getElementById('close-modal').addEventListener('click', hideHistory);

// Load stored data when offline
async function loadStoredData() {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(['sensorReadings'], 'readonly');
    const store = transaction.objectStore('sensorReadings');
    const index = store.index('by_timestamp');
    const request = index.getAll();
    
    request.onsuccess = () => {
      const records = request.result;
      if (records.length > 0) {
        const latest = records[records.length - 1];
        updateDisplay(latest);
        updateMap(latest);
        
        const chartData = records.slice(-20);
        flowChart.data.labels = chartData.map(r => new Date(r.timestamp).toLocaleTimeString());
        flowChart.data.datasets[0].data = chartData.map(r => r.flowRate);
        flowChart.update();
      }
    };
  } catch (error) {
    console.error('Error loading stored data:', error);
  }
}

// Check if offline and load stored data
window.addEventListener('load', () => {
  if (!navigator.onLine) {
    loadStoredData();
  }
});

window.addEventListener('online', () => {
  connectionStatus.textContent = 'Online';
});

window.addEventListener('offline', () => {
  connectionStatus.textContent = 'Offline - Using cached data';
  loadStoredData();
});

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registration successful');
      })
      .catch(err => {
        console.log('ServiceWorker registration failed: ', err);
      });
  });
}