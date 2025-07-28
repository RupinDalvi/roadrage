// Milestone 5: Vibration Preview Graph for Upcoming Segment
// Enhanced with Firebase integration and real sensor data

// Debug and logging configuration
const DEBUG_MODE = true; // Set to false for production
const TEST_MODE = true; // Enables lower thresholds for testing

function logDebug(message, data = null) {
    if (DEBUG_MODE) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`, data || '');
    }
}

function showUserFeedback(message, type = 'info') {
    logDebug(`User feedback (${type}): ${message}`);
    if (type === 'error' || type === 'warning') {
        alert(message);
    }
    // You could also add UI notifications here instead of alerts
}

// Check HTTPS requirement for sensor access
function checkHTTPSRequirement() {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        const message = 'HTTPS is required for sensor access. Please serve this app over HTTPS or use localhost for development.';
        showUserFeedback(message, 'error');
        return false;
    }
    return true;
}

// Initialize Firebase
let db = null;
if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        logDebug('Firebase initialized successfully');
    } catch (error) {
        logDebug('Firebase initialization failed', error);
        showUserFeedback('Firebase initialization failed. Data will not be saved.', 'warning');
    }
} else {
    logDebug('Firebase or config not available');
    showUserFeedback('Firebase not configured. Data will not be saved.', 'warning');
}

// Real sensor data variables
let isRecording = false;
let accelerometerData = [];
let gpsData = [];
let recordingStartTime = null;
let watchId = null;
let currentPosition = null;
let recordedSegments = [];

// Permission states
let gpsPermissionGranted = false;
let motionPermissionGranted = false;
let gpsPermissionRequested = false;
let motionPermissionRequested = false;

let map;
let routePolyline;
let routeCoords = [];
let marker = null;
let simulationIndex = 0;
let simulationProgress = 0; // meters within segment
let simulationInterval = null;
const SIM_SPEED_MPS = 5.56; // 20 km/h

let segments = []; // Each: {startIdx, endIdx, coords, vibration: [], roughness: number}
let segmentPolylines = [];
let currentSegmentIdx = null;
// Reduced segment length for testing
const SEGMENT_LENGTH_M = TEST_MODE ? 50 : 200; // Use 50m for testing, 200m for production

let tableEl = null;

// Chart.js vibration graph
let vibrationChart = null;

function initMap() {
    logDebug('Initializing map and application');
    
    // Check HTTPS requirement first
    if (!checkHTTPSRequirement()) {
        document.getElementById('startRecordingBtn').disabled = true;
        return;
    }
    
    map = L.map('map').setView([19.0760, 72.8777], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OSM contributors'
    }).addTo(map);

    // Table
    tableEl = document.createElement('table');
    tableEl.id = 'segmentTable';
    tableEl.innerHTML = `<thead>
      <tr>
        <th>Segment</th>
        <th>Distance (m)</th>
        <th>Roughness (RMS)</th>
        <th>Samples</th>
      </tr>
    </thead><tbody></tbody>`;
    document.getElementById('mapSection').appendChild(tableEl);

    // Chart.js setup
    const ctx = document.getElementById('vibrationGraph').getContext('2d');
    vibrationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Vibration',
                data: [],
                backgroundColor: 'rgba(60, 125, 201, 0.2)',
                borderColor: '#3c7dc9',
                borderWidth: 2,
                pointRadius: 2,
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            animation: false,
            scales: {
                y: { beginAtZero: true, suggestedMax: 12 }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });

    // Load and display previous data from Firebase
    loadPreviousData().then(previousData => {
        if (previousData.length > 0) {
            displayPreviousData(previousData);
        }
    });

    // Check sensor availability and request permissions
    checkSensorAvailability();
}

// Check sensor availability and request permissions
async function checkSensorAvailability() {
    logDebug('Checking sensor availability');
    
    let gpsAvailable = false;
    let motionAvailable = false;
    
    // Check GPS availability
    if (!navigator.geolocation) {
        logDebug('Geolocation not supported');
        showUserFeedback('GPS/Geolocation is not supported on this device.', 'error');
    } else {
        logDebug('Geolocation API available');
        gpsAvailable = true;
    }
    
    // Check motion sensor availability
    if (!window.DeviceMotionEvent) {
        logDebug('Device motion not supported');
        showUserFeedback('Accelerometer (Device Motion) is not supported on this device.', 'error');
    } else {
        logDebug('Device Motion API available');
        motionAvailable = true;
    }
    
    // Enable recording button only if both sensors are available
    if (gpsAvailable && motionAvailable) {
        document.getElementById('startRecordingBtn').disabled = false;
        logDebug('Recording button enabled - sensors available');
    } else {
        document.getElementById('startRecordingBtn').disabled = true;
        logDebug('Recording button disabled - missing sensors');
    }
    
    // For simulation mode, only check if map libraries are available
    if (typeof L !== 'undefined') {
        document.getElementById('startBtn').disabled = false;
        logDebug('Simulation mode available');
    } else {
        logDebug('Map libraries not available - simulation disabled');
    }
}

// Request GPS permission explicitly
async function requestGPSPermission() {
    logDebug('Requesting GPS permission');
    
    if (gpsPermissionRequested) {
        logDebug('GPS permission already requested');
        return gpsPermissionGranted;
    }
    
    return new Promise((resolve) => {
        gpsPermissionRequested = true;
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                logDebug('GPS permission granted', position.coords);
                gpsPermissionGranted = true;
                showUserFeedback('GPS access granted successfully!', 'info');
                resolve(true);
            },
            (error) => {
                logDebug('GPS permission denied or failed', error);
                gpsPermissionGranted = false;
                
                let message = 'GPS access denied or failed: ';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        message += 'Permission denied. Please enable location access for this website.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message += 'Position unavailable. Please check your GPS settings.';
                        break;
                    case error.TIMEOUT:
                        message += 'Request timeout. Please try again.';
                        break;
                    default:
                        message += 'Unknown error occurred.';
                        break;
                }
                
                showUserFeedback(message, 'error');
                resolve(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}

// Request motion sensor permission explicitly
async function requestMotionPermission() {
    logDebug('Requesting motion sensor permission');
    
    if (motionPermissionRequested) {
        logDebug('Motion permission already requested');
        return motionPermissionGranted;
    }
    
    motionPermissionRequested = true;
    
    // For iOS 13+ devices, explicit permission is required
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        logDebug('iOS-style permission request required');
        
        try {
            const response = await DeviceMotionEvent.requestPermission();
            if (response === 'granted') {
                logDebug('iOS motion permission granted');
                motionPermissionGranted = true;
                showUserFeedback('Motion sensor access granted!', 'info');
                return true;
            } else {
                logDebug('iOS motion permission denied');
                motionPermissionGranted = false;
                showUserFeedback('Motion sensor permission denied. Road quality detection will not work properly.', 'error');
                return false;
            }
        } catch (error) {
            logDebug('iOS motion permission request failed', error);
            motionPermissionGranted = false;
            showUserFeedback('Motion sensor permission request failed.', 'error');
            return false;
        }
    } else {
        // For non-iOS devices, test if motion events work
        logDebug('Testing motion sensor availability (non-iOS)');
        
        return new Promise((resolve) => {
            let testCount = 0;
            let hasMotionData = false;
            
            function testMotionHandler(event) {
                testCount++;
                const acc = event.accelerationIncludingGravity;
                
                if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
                    hasMotionData = true;
                    logDebug('Motion sensor test successful', acc);
                }
                
                if (testCount >= 3) {
                    window.removeEventListener('devicemotion', testMotionHandler);
                    
                    if (hasMotionData) {
                        motionPermissionGranted = true;
                        showUserFeedback('Motion sensor access working!', 'info');
                        resolve(true);
                    } else {
                        motionPermissionGranted = false;
                        showUserFeedback('Motion sensors appear to be blocked or unavailable. Please check your browser settings.', 'error');
                        resolve(false);
                    }
                }
            }
            
            window.addEventListener('devicemotion', testMotionHandler);
            
            // Timeout after 3 seconds
            setTimeout(() => {
                window.removeEventListener('devicemotion', testMotionHandler);
                if (testCount === 0) {
                    motionPermissionGranted = false;
                    showUserFeedback('Motion sensors not responding. Please ensure you are on a mobile device and motion access is allowed.', 'error');
                    resolve(false);
                }
            }, 3000);
        });
    }
}
function parseGPX(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "application/xml");
    const trkpts = xmlDoc.getElementsByTagName("trkpt");
    let coordinates = [];
    for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute("lat"));
        const lon = parseFloat(trkpts[i].getAttribute("lon"));
        coordinates.push([lat, lon]);
    }
    return coordinates;
}

function drawRoute(coords) {
    if (routePolyline) {
        map.removeLayer(routePolyline);
    }
    routePolyline = L.polyline(coords, { color: 'blue', weight: 5 }).addTo(map);
    map.fitBounds(routePolyline.getBounds());
}

// Create segments of ~SEGMENT_LENGTH_M along routeCoords
function segmentRoute(coords) {
    segments = [];
    let startIdx = 0;
    while (startIdx < coords.length - 1) {
        let endIdx = startIdx + 1;
        let dist = 0;
        while (endIdx < coords.length) {
            dist += latLonDistance(coords[endIdx - 1], coords[endIdx]);
            if (dist >= SEGMENT_LENGTH_M) break;
            endIdx++;
        }
        segments.push({
            startIdx,
            endIdx,
            coords: coords.slice(startIdx, endIdx + 1),
            vibration: [],
            roughness: 0,
            distance: dist
        });
        startIdx = endIdx;
    }
}

function drawSegments() {
    segmentPolylines.forEach(poly => map.removeLayer(poly));
    segmentPolylines = [];
    let roughnessArr = segments.map(s => s.roughness);
    let minR = Math.min(...roughnessArr.filter(x => x > 0));
    let maxR = Math.max(...roughnessArr);
    if (!isFinite(minR)) minR = 1;
    if (!isFinite(maxR)) maxR = 10;
    segments.forEach((seg, idx) => {
        let color = '#8888ff';
        if (seg.roughness > 0) color = roughnessColor(seg.roughness, minR, maxR);
        if (idx === currentSegmentIdx) color = 'red';
        let poly = L.polyline(seg.coords, { color, weight: (idx === currentSegmentIdx ? 8 : 4), opacity: (idx === currentSegmentIdx ? 0.9 : 0.6) }).addTo(map);
        segmentPolylines.push(poly);
    });
}

function roughnessColor(val, min, max) {
    let ratio = (val - min) / (max - min);
    if (ratio <= 0.4) return '#3c7dc9';
    else if (ratio <= 0.7) return '#ffe066';
    else return '#d90429';
}

function startSimulation() {
    if (routeCoords.length < 2) return;
    simulationIndex = 0;
    simulationProgress = 0;
    currentSegmentIdx = null;
    segments.forEach(seg => { seg.vibration = []; seg.roughness = 0; });
    drawSegments();
    updateTable();
    updateVibrationPreview();

    if (marker) {
        map.removeLayer(marker);
    }
    marker = L.marker(routeCoords[0]).addTo(map);
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;

    simulationInterval = setInterval(() => {
        moveMarker();
    }, 1000);
}

function stopSimulation() {
    if (simulationInterval) clearInterval(simulationInterval);
    simulationInterval = null;
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
}

function moveMarker() {
    let distanceToTravel = SIM_SPEED_MPS;
    while (distanceToTravel > 0 && simulationIndex < routeCoords.length - 1) {
        const curr = routeCoords[simulationIndex];
        const next = routeCoords[simulationIndex + 1];
        const segDist = latLonDistance(curr, next);

        if (simulationProgress + distanceToTravel < segDist) {
            const frac = (simulationProgress + distanceToTravel) / segDist;
            const interp = [
                curr[0] + (next[0] - curr[0]) * frac,
                curr[1] + (next[1] - curr[1]) * frac
            ];
            marker.setLatLng(interp);
            simulationProgress += distanceToTravel;
            distanceToTravel = 0;
        } else {
            distanceToTravel -= (segDist - simulationProgress);
            simulationIndex++;
            simulationProgress = 0;
            marker.setLatLng(next);
        }
    }

    updateCurrentSegment();

    // Simulate vibration data for this step, append to segment
    if (currentSegmentIdx != null) {
        let vibrationReading = simulateVibration();
        segments[currentSegmentIdx].vibration.push(vibrationReading);
        segments[currentSegmentIdx].roughness = computeRMS(segments[currentSegmentIdx].vibration);
    }
    drawSegments();
    updateTable();
    updateVibrationPreview();

    if (simulationIndex >= routeCoords.length - 1) {
        stopSimulation();
    }
}

function simulateVibration() {
    let bias = Math.random();
    if (bias < 0.33) return Math.random() * 2 + 1;
    if (bias < 0.66) return Math.random() * 2 + 4;
    return Math.random() * 3 + 7;
}

function computeRMS(arr) {
    if (!arr.length) return 0;
    let sumSq = arr.reduce((acc, x) => acc + x * x, 0);
    return Math.sqrt(sumSq / arr.length);
}

function updateCurrentSegment() {
    const markerLatLng = marker.getLatLng();
    let closestIdx = null;
    let closestDist = Infinity;
    segments.forEach((seg, idx) => {
        seg.coords.forEach(pt => {
            const d = latLonDistance([markerLatLng.lat, markerLatLng.lng], pt);
            if (d < closestDist) {
                closestDist = d;
                closestIdx = idx;
            }
        });
    });
    if (closestIdx !== currentSegmentIdx) {
        currentSegmentIdx = closestIdx;
        drawSegments();
    }
}

function updateTable() {
    let tbody = tableEl.querySelector('tbody');
    tbody.innerHTML = '';
    segments.forEach((seg, idx) => {
        let tr = document.createElement('tr');
        if (idx === currentSegmentIdx) tr.style.background = '#ffe0e0';
        tr.innerHTML = `
          <td>${idx+1}</td>
          <td>${seg.distance.toFixed(1)}</td>
          <td>${seg.roughness ? seg.roughness.toFixed(2) : '-'}</td>
          <td>${seg.vibration.length}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Vibration preview for next segment (or next 200m)
function updateVibrationPreview() {
    let nextIdx = currentSegmentIdx != null ? currentSegmentIdx + 1 : 0;
    let data = [];
    let labels = [];
    if (nextIdx < segments.length) {
        let vib = segments[nextIdx].vibration;
        if (!vib.length) {
            // Not yet traversed, so simulate placeholder (gray line)
            data = Array(6).fill(null).map(() => simulateVibration());
            labels = data.map((_, i) => `t+${i+1}`);
        } else {
            data = vib.slice(); // previously recorded
            labels = data.map((_, i) => `t+${i+1}`);
        }
    }
    // Show empty if at end
    if (!data.length) {
        data = [];
        labels = [];
    }

    vibrationChart.data.labels = labels;
    vibrationChart.data.datasets[0].data = data;
    vibrationChart.data.datasets[0].backgroundColor = (nextIdx < segments.length && !segments[nextIdx].vibration.length) ? 'rgba(128,128,128,0.1)' : 'rgba(60, 125, 201, 0.2)';
    vibrationChart.data.datasets[0].borderColor = (nextIdx < segments.length && !segments[nextIdx].vibration.length) ? '#888' : '#3c7dc9';
    vibrationChart.update();
}

// Real sensor data collection functions
async function startRealRecording() {
    logDebug('Starting real recording');
    
    if (!navigator.geolocation || !window.DeviceMotionEvent) {
        showUserFeedback('GPS or accelerometer not supported on this device', 'error');
        return;
    }

    // Request permissions explicitly
    logDebug('Requesting GPS permission...');
    const gpsOk = await requestGPSPermission();
    
    if (!gpsOk) {
        logDebug('GPS permission failed, aborting recording');
        return;
    }
    
    logDebug('Requesting motion sensor permission...');
    const motionOk = await requestMotionPermission();
    
    if (!motionOk) {
        logDebug('Motion permission failed, aborting recording');
        return;
    }

    // Both permissions granted, start recording
    isRecording = true;
    recordingStartTime = Date.now();
    accelerometerData = [];
    gpsData = [];
    recordedSegments = [];
    currentPosition = null;

    logDebug('Starting sensor listeners with both permissions granted');
    startSensorListeners();

    document.getElementById('startRecordingBtn').disabled = true;
    document.getElementById('stopRecordingBtn').disabled = false;
    document.getElementById('startBtn').disabled = true;
    
    showUserFeedback('Recording started! Move to collect road quality data.', 'info');
    
    // Set up a timer to check for data collection
    setTimeout(() => {
        if (isRecording) {
            checkDataCollection();
        }
    }, 10000); // Check after 10 seconds
}

function checkDataCollection() {
    logDebug(`Data collection check: GPS=${gpsData.length}, Accelerometer=${accelerometerData.length}`);
    
    if (gpsData.length === 0) {
        showUserFeedback('No GPS data received yet. Please ensure location services are enabled and you are outdoors.', 'warning');
    }
    
    if (accelerometerData.length === 0) {
        showUserFeedback('No motion sensor data received. Please ensure you are moving the device.', 'warning');
    }
    
    if (gpsData.length > 0 && accelerometerData.length > 0) {
        logDebug('Data collection is working properly');
    }
}

function startSensorListeners() {
    logDebug('Starting GPS and motion sensor listeners');
    
    // Start GPS tracking
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const timestamp = Date.now();
            currentPosition = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                timestamp: timestamp,
                accuracy: position.coords.accuracy
            };
            gpsData.push(currentPosition);
            
            logDebug(`GPS update: ${currentPosition.lat.toFixed(6)}, ${currentPosition.lng.toFixed(6)}, accuracy: ${currentPosition.accuracy}m`);
            
            // Update map marker if available
            if (map && marker) {
                marker.setLatLng([currentPosition.lat, currentPosition.lng]);
            } else if (map) {
                marker = L.marker([currentPosition.lat, currentPosition.lng]).addTo(map);
                map.setView([currentPosition.lat, currentPosition.lng], 16);
                logDebug('Map marker created and centered');
            }
            
            processRealTimeData();
        },
        (error) => {
            logDebug('GPS error occurred', error);
            let message = 'GPS error: ';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    message += 'Permission denied';
                    break;
                case error.POSITION_UNAVAILABLE:
                    message += 'Position unavailable';
                    break;
                case error.TIMEOUT:
                    message += 'Request timeout';
                    break;
                default:
                    message += 'Unknown error';
                    break;
            }
            showUserFeedback(message, 'error');
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        }
    );

    // Start accelerometer tracking
    window.addEventListener('devicemotion', handleMotionEvent);
    logDebug('Motion event listener added');
}

function handleMotionEvent(event) {
    if (!isRecording) return;
    
    const timestamp = Date.now();
    const acc = event.accelerationIncludingGravity;
    
    if (acc && acc.x !== null && acc.y !== null && acc.z !== null) {
        const rawMagnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
        const filteredMagnitude = filterVibration(rawMagnitude, timestamp);
        
        accelerometerData.push({
            timestamp: timestamp,
            raw: rawMagnitude,
            filtered: filteredMagnitude,
            x: acc.x,
            y: acc.y,
            z: acc.z
        });
        
        // Log every 50th sample to avoid spam
        if (accelerometerData.length % 50 === 0) {
            logDebug(`Accelerometer data: ${accelerometerData.length} samples, latest: ${rawMagnitude.toFixed(2)} (filtered: ${filteredMagnitude.toFixed(2)})`);
        }
    } else {
        // Log null accelerometer readings occasionally
        if (Math.random() < 0.01) { // 1% chance to log
            logDebug('Accelerometer returned null values', acc);
        }
    }
}

// Vibration filtering to remove non-road movements
function filterVibration(magnitude, timestamp) {
    // Simple high-pass filter to remove gravity and low-frequency movements
    // This filters out slow movements like braking/accelerating
    const baseline = 9.8; // approximate gravity
    const deviation = Math.abs(magnitude - baseline);
    
    // Filter out extreme values that might be from phone handling
    if (deviation > 15) return 0; // likely phone handling
    
    // Apply simple moving average filter
    const windowSize = 5;
    const recentData = accelerometerData.slice(-windowSize);
    if (recentData.length > 0) {
        const avgRecent = recentData.reduce((sum, d) => sum + d.raw, 0) / recentData.length;
        // High-pass filter: only keep vibrations above the recent average
        const filtered = Math.max(0, deviation - (Math.abs(avgRecent - baseline) * 0.7));
        return filtered;
    }
    
    return deviation;
}

function processRealTimeData() {
    if (!currentPosition || gpsData.length < 2) return;
    
    // Group accelerometer data into 200m segments based on GPS
    const segmentData = groupDataIntoSegments();
    updateRealTimeDisplay(segmentData);
}

function groupDataIntoSegments() {
    if (gpsData.length < 2) return [];
    
    const segments = [];
    let currentSegment = {
        startPos: gpsData[0],
        endPos: null,
        distance: 0,
        vibrationData: [],
        roughness: 0
    };
    
    for (let i = 1; i < gpsData.length; i++) {
        const dist = latLonDistance(
            [currentSegment.startPos.lat, currentSegment.startPos.lng],
            [gpsData[i].lat, gpsData[i].lng]
        );
        
        // Use the configured segment length (50m for testing, 200m for production)
        if (dist >= SEGMENT_LENGTH_M) {
            // Complete current segment
            currentSegment.endPos = gpsData[i];
            currentSegment.distance = dist;
            
            // Get vibration data for this time period
            const startTime = currentSegment.startPos.timestamp;
            const endTime = currentSegment.endPos.timestamp;
            currentSegment.vibrationData = accelerometerData.filter(
                d => d.timestamp >= startTime && d.timestamp <= endTime
            ).map(d => d.filtered);
            
            if (currentSegment.vibrationData.length > 0) {
                currentSegment.roughness = computeRMS(currentSegment.vibrationData);
            }
            
            logDebug(`Segment completed: ${dist.toFixed(1)}m, ${currentSegment.vibrationData.length} vibration samples, roughness: ${currentSegment.roughness.toFixed(2)}`);
            segments.push(currentSegment);
            
            // Start new segment
            currentSegment = {
                startPos: gpsData[i],
                endPos: null,
                distance: 0,
                vibrationData: [],
                roughness: 0
            };
        }
    }
    
    return segments;
}

function updateRealTimeDisplay(segmentData) {
    // Update the map with new segments
    if (segmentData.length > recordedSegments.length) {
        const newSegments = segmentData.slice(recordedSegments.length);
        newSegments.forEach(segment => {
            const coords = [
                [segment.startPos.lat, segment.startPos.lng],
                [segment.endPos.lat, segment.endPos.lng]
            ];
            const color = roughnessColor(segment.roughness, 0, 10);
            const polyline = L.polyline(coords, { color: color, weight: 6 }).addTo(map);
            segmentPolylines.push(polyline);
        });
        recordedSegments = segmentData;
        updateRealTimeTable();
    }
}

function updateRealTimeTable() {
    let tbody = tableEl.querySelector('tbody');
    tbody.innerHTML = '';
    recordedSegments.forEach((seg, idx) => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx+1}</td>
          <td>${seg.distance.toFixed(1)}</td>
          <td>${seg.roughness ? seg.roughness.toFixed(2) : '-'}</td>
          <td>${seg.vibrationData.length}</td>
        `;
        tbody.appendChild(tr);
    });
}

function stopRealRecording() {
    logDebug('Stopping real recording');
    isRecording = false;
    
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        logDebug('GPS watch cleared');
    }
    
    window.removeEventListener('devicemotion', handleMotionEvent);
    logDebug('Motion event listener removed');
    
    document.getElementById('startRecordingBtn').disabled = false;
    document.getElementById('stopRecordingBtn').disabled = true;
    document.getElementById('startBtn').disabled = false;
    
    // Process final segments and export to Firebase
    const finalSegments = groupDataIntoSegments();
    logDebug(`Recording stopped. Collected ${gpsData.length} GPS points, ${accelerometerData.length} accelerometer samples, ${finalSegments.length} segments`);
    
    if (finalSegments.length === 0) {
        showUserFeedback('No road segments were recorded. Try recording over a longer distance or moving more.', 'warning');
    } else {
        showUserFeedback(`Recording completed! ${finalSegments.length} road segments will be uploaded.`, 'info');
    }
    
    exportToFirebase(finalSegments);
}

// Firebase functions
async function exportToFirebase(segments) {
    logDebug(`Attempting to export ${segments.length} segments to Firebase`);
    
    if (!db) {
        logDebug('Firebase not initialized, cannot export data');
        showUserFeedback('Firebase not available. Data cannot be saved to cloud.', 'warning');
        return;
    }
    
    if (segments.length === 0) {
        logDebug('No segments to export');
        showUserFeedback('No road segments to save.', 'info');
        return;
    }
    
    try {
        const batch = db.batch();
        let validSegments = 0;
        
        for (const segment of segments) {
            if (segment.endPos) {
                const docId = `${segment.startPos.lat.toFixed(6)}_${segment.startPos.lng.toFixed(6)}_${Date.now()}`;
                const docRef = db.collection('roadQuality').doc(docId);
                
                const data = {
                    startLat: segment.startPos.lat,
                    startLng: segment.startPos.lng,
                    endLat: segment.endPos.lat,
                    endLng: segment.endPos.lng,
                    roughness: segment.roughness,
                    distance: segment.distance,
                    timestamp: new Date(),
                    vibrationSamples: segment.vibrationData.length,
                    testMode: TEST_MODE // Mark if this was recorded in test mode
                };
                
                batch.set(docRef, data, { merge: true });
                validSegments++;
                logDebug(`Prepared segment ${validSegments} for upload: ${segment.distance.toFixed(1)}m, roughness: ${segment.roughness.toFixed(2)}`);
            }
        }
        
        if (validSegments === 0) {
            logDebug('No valid segments to upload');
            showUserFeedback('No valid road segments to save.', 'warning');
            return;
        }
        
        logDebug(`Uploading ${validSegments} segments to Firebase...`);
        await batch.commit();
        
        logDebug('Data exported to Firebase successfully');
        showUserFeedback(`Recording completed! ${validSegments} road segments saved successfully.`, 'info');
    } catch (error) {
        logDebug('Error exporting to Firebase', error);
        showUserFeedback(`Error saving data: ${error.message}. Please check your internet connection and try again.`, 'error');
    }
}

async function loadPreviousData() {
    if (!db) {
        logDebug('Firebase not initialized, cannot load previous data');
        return [];
    }
    
    try {
        logDebug('Loading previous road quality data from Firebase...');
        const snapshot = await db.collection('roadQuality').get();
        const previousData = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            previousData.push(data);
        });
        
        logDebug(`Loaded ${previousData.length} previous road quality records`);
        return previousData;
    } catch (error) {
        logDebug('Error loading previous data', error);
        showUserFeedback('Could not load previous road data from Firebase.', 'warning');
        return [];
    }
}

// GPX parsing (only extracts <trkpt lat="..." lon="..."> from first <trk>)
function parseGPX(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "application/xml");
    const trkpts = xmlDoc.getElementsByTagName("trkpt");
    let coordinates = [];
    for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute("lat"));
        const lon = parseFloat(trkpts[i].getAttribute("lon"));
        coordinates.push([lat, lon]);
    }
    return coordinates;
}

function displayPreviousData(previousData) {
    // Clear existing previous data polylines
    // (You might want to store these separately from current recording polylines)
    
    let minRoughness = Math.min(...previousData.map(d => d.roughness).filter(r => r > 0));
    let maxRoughness = Math.max(...previousData.map(d => d.roughness));
    if (!isFinite(minRoughness)) minRoughness = 1;
    if (!isFinite(maxRoughness)) maxRoughness = 10;
    
    previousData.forEach(data => {
        const coords = [
            [data.startLat, data.startLng],
            [data.endLat, data.endLng]
        ];
        const color = roughnessColor(data.roughness, minRoughness, maxRoughness);
        L.polyline(coords, { 
            color: color, 
            weight: 3, 
            opacity: 0.7,
            dashArray: '5, 5' // Dashed line to distinguish from current recording
        }).addTo(map);
    });
}

function latLonDistance(a, b) {
    const R = 6371000;
    const lat1 = a[0] * Math.PI / 180, lat2 = b[0] * Math.PI / 180;
    const dLat = lat2 - lat1, dLon = (b[1] - a[1]) * Math.PI / 180;
    const x = dLat;
    const y = dLon * Math.cos((lat1 + lat2) / 2);
    return Math.sqrt(x * x + y * y) * R;
}

document.getElementById('gpxInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        const gpxText = evt.target.result;
        routeCoords = parseGPX(gpxText);
        if (routeCoords.length > 0) {
            drawRoute(routeCoords);
            segmentRoute(routeCoords);
            drawSegments();
            updateTable();
            updateVibrationPreview();
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
        } else {
            alert("No route found in GPX file.");
        }
    };
    reader.readAsText(file);
});

document.getElementById('startBtn').addEventListener('click', startSimulation);
document.getElementById('stopBtn').addEventListener('click', stopSimulation);
document.getElementById('startRecordingBtn').addEventListener('click', startRealRecording);
document.getElementById('stopRecordingBtn').addEventListener('click', stopRealRecording);

window.onload = initMap;