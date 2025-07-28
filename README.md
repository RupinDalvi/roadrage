# Road Rage - Bike Road Quality Mapper

A web application for cataloging road quality during bike rides using smartphone sensors.

## Features

- **Real-time Recording**: Uses device GPS and accelerometer to record road quality
- **Route Simulation**: Test the app with GPX files for development/demo purposes
- **200m Segmentation**: Analyzes road quality in 200-meter segments
- **Vibration Filtering**: Filters out non-road movements (braking, phone handling, etc.)
- **Firebase Integration**: Stores and retrieves road quality data
- **Live Map Display**: Shows current route with color-coded quality indicators
- **Historical Data**: Displays previous road quality data from Firebase

## Setup Instructions

### 1. Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Navigate to Project Settings (gear icon) > General tab
4. Scroll down to "Your apps" section
5. Add a web app if you haven't already
6. Copy the configuration object
7. Edit `firebase-config.js` and replace the placeholder values with your actual Firebase config

### 2. Enable Firestore Database

1. In Firebase Console, go to Build > Firestore Database
2. Create database and set up security rules as needed
3. For testing, you can start in test mode (allows read/write for 30 days)

### 3. Run the Application

1. Serve the files using a local web server (required for sensor access):
   ```bash
   python3 -m http.server 8080
   ```
   or
   ```bash
   npx serve .
   ```

2. Access the app via `http://localhost:8080` (or your server URL)

3. **Important**: For sensor access, the app must be served over HTTPS in production or accessed via localhost for development

## Usage

### Real Recording Mode

1. Click "Start Recording" to begin collecting real sensor data
2. Move your device/bike along the route
3. The app will automatically segment the route into 200m chunks
4. Road quality is calculated based on filtered vibration data
5. Click "Stop Recording" to finish and save data to Firebase

### Simulation Mode

1. Upload a GPX file using the file input
2. Click "Start Simulation" to simulate movement along the route
3. Watch the marker move and see road quality analysis in real-time

## Technical Details

### Vibration Filtering

The app implements filtering to remove non-road movements:
- High-pass filtering to remove low-frequency movements (braking/acceleration)
- Magnitude thresholding to filter out extreme movements (phone handling)
- Moving average smoothing to reduce noise

### Data Structure

Road quality data is stored in Firebase with the following structure:
```javascript
{
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  roughness: number,    // RMS of filtered vibration data
  distance: number,     // Actual segment distance in meters
  timestamp: Date,
  vibrationSamples: number
}
```

### Segmentation

- Routes are divided into approximately 200-meter segments
- Each GPS point group that covers ~200m becomes one segment
- Road quality scores are calculated per segment using RMS of vibration data

## Browser Compatibility

- Requires modern browser with GPS and accelerometer support
- Works best on mobile devices (smartphones/tablets)
- Requires HTTPS for sensor access (except on localhost)

## Development

The application is built with vanilla HTML, CSS, and JavaScript using:
- Leaflet.js for mapping
- Chart.js for data visualization
- Firebase for data persistence
- Device motion and geolocation APIs for sensor data