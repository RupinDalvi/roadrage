// Firebase Configuration
// Replace these values with your actual Firebase project configuration
// You can find these values in your Firebase Console > Project Settings > General > Your apps

  const firebaseConfig = {
    apiKey: "AIzaSyBEFLwtNYNL9u2tEgN0f8aWYHl4GJajH5Q",
    authDomain: "roadrage-6de0b.firebaseapp.com",
    projectId: "roadrage-6de0b",
    storageBucket: "roadrage-6de0b.firebasestorage.app",
    messagingSenderId: "135144834800",
    appId: "1:135144834800:web:caea78b11e18328dee2435",
    measurementId: "G-799WZ0B7LS"
  };

// Instructions:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project or select an existing one
// 3. Go to Project Settings (gear icon) > General tab
// 4. Scroll down to "Your apps" section
// 5. If you haven't added a web app, click "Add app" and select Web
// 6. Copy the configuration object and replace the values above
// 7. Enable Firestore Database in Firebase Console > Build > Firestore Database
// 8. Set up security rules for your Firestore database as needed

// Export for use in main application
if (typeof module !== 'undefined' && module.exports) {
    module.exports = firebaseConfig;
}
