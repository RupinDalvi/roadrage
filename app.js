// Milestone 5: Vibration Preview Graph for Upcoming Segment

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
const SEGMENT_LENGTH_M = 50;

let tableEl = null;

// Chart.js vibration graph
let vibrationChart = null;

function initMap() {
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

// Vibration preview for next segment (or next 50m)
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

window.onload = initMap;