import { initializeApp, getApps, getApp } from 'firebase/app'
import { getStorage } from 'firebase/storage'

// Values come from Vite env vars so no project credentials are hardcoded in source.
// Copy .env.example to .env.local and fill in the shared PunchRap Firebase project's config.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)
if (missingKeys.length) {
  console.error(
    `[Punchin] Firebase config is missing: ${missingKeys.join(', ')}. ` +
      'Create .env.local (copy .env.example) with the real web app config from the ' +
      'Firebase console, then restart the dev server. Preset fetches will silently ' +
      'return zero results until this is fixed.',
  )
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const storage = getStorage(firebaseApp)
