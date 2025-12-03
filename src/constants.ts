
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAWFIhKBGgez5TXaMA9Nqg7tj3qx2qBg9g",
  authDomain: "burnit-ai.firebaseapp.com",
  projectId: "burnit-ai",
  storageBucket: "burnit-ai.firebasestorage.app",
  messagingSenderId: "90334674715",
  appId: "1:90334674715:web:c9e31cb67dff1329e51dbe",
  measurementId: "G-CG8BBMHNEG"
};

// ⚠️ API KEYS SETUP ⚠️
// We safely check both process.env (Node/System) and import.meta.env (Vite/Browser)
// to ensure the key is found regardless of the environment setup.
const getApiKey = () => {
  let key = "";
  
  // 1. Try standard process.env (if polyfilled or Node)
  try {
    if (typeof process !== "undefined" && process.env?.API_KEY) {
      key = process.env.API_KEY;
    }
  } catch (e) {}

  // 2. Try Vite's import.meta.env (Browser standard for Vite)
  if (!key) {
    try {
      // @ts-ignore
      if (import.meta.env?.VITE_API_KEY) {
        // @ts-ignore
        key = import.meta.env.VITE_API_KEY;
      }
      // @ts-ignore
      else if (import.meta.env?.API_KEY) {
         // @ts-ignore
        key = import.meta.env.API_KEY;
      }
    } catch (e) {}
  }
  
  return key;
};

export const GEMINI_API_KEY = getApiKey();

// Gemini Models
export const MODEL_TEXT = 'gemini-2.5-flash'; 
export const MODEL_IMAGE = 'gemini-2.5-flash-image'; 
export const MODEL_LIVE = 'gemini-2.5-flash-native-audio-preview-09-2025';

// Assets
export const BURNIT_LOGO_URL = "https://i.ibb.co/Vcs2YdYq/Burnit-logo.jpg";
export const PLACEHOLDER_AVATAR = "https://picsum.photos/100/100";
