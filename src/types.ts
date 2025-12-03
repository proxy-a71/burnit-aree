
export interface User {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  isDemo?: boolean;
  region?: string;
  dob?: string;
  joinedDate?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  image?: string;
  type: 'text' | 'image_generated';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastUpdated: number;
}

export enum AppMode {
  CHAT = 'CHAT',
  LIVE = 'LIVE',
  IMAGE = 'IMAGE',
  PROFILE = 'PROFILE',
  SETTINGS = 'SETTINGS'
}

export type Theme = 'dark' | 'light';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ne', name: 'Nepali' }
];
