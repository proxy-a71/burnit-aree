import React, { useState } from 'react';
import { User } from '../types';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import { FIREBASE_CONFIG, BURNIT_LOGO_URL } from '../constants';
import { User as UserIcon } from 'lucide-react';

// Initialize Firebase (safely)
if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}
const auth = firebase.auth();

interface AuthProps {
  onLogin: (user: User) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [error, setError] = useState<string | null>(null);

  const handleDemoLogin = () => {
    onLogin({
      uid: 'demo-user-123',
      displayName: 'Demo User',
      email: 'demo@burnit.ai',
      photoURL: null,
      isDemo: true
    });
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      onLogin({
        uid: result.user!.uid,
        displayName: result.user!.displayName,
        email: result.user!.email,
        photoURL: result.user!.photoURL
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to login with Google");
    }
  };

  const handleFacebookLogin = async () => {
    try {
        const provider = new firebase.auth.FacebookAuthProvider();
        const result = await auth.signInWithPopup(provider);
        onLogin({
            uid: result.user!.uid,
            displayName: result.user!.displayName,
            email: result.user!.email,
            photoURL: result.user!.photoURL
        });
    } catch (err: any) {
        setError("Facebook login not fully configured in this demo environment.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-burnit-cyan rounded-full mix-blend-screen filter blur-[100px] opacity-20 animate-pulse-slow"></div>
        <div className="absolute bottom-[-20%] left-[-10%] w-[600px] h-[600px] bg-burnit-red rounded-full mix-blend-screen filter blur-[100px] opacity-20 animate-pulse-slow"></div>
      </div>

      <div className="z-10 w-full max-w-md p-8 rounded-2xl glass-panel shadow-2xl border-t border-white/10">
        <div className="flex flex-col items-center mb-8">
            <div className="relative">
                <img 
                  src={BURNIT_LOGO_URL} 
                  alt="Burnit AI Logo" 
                  className="w-24 h-24 rounded-full border-2 border-burnit-cyan animate-flame drop-shadow-[0_0_25px_rgba(255,42,42,0.6)] object-cover" 
                  onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                />
                <div className="hidden w-24 h-24 rounded-full border-2 border-burnit-cyan animate-flame bg-black flex items-center justify-center">
                    <span className="text-burnit-red font-bold text-2xl">🔥</span>
                </div>
            </div>
            <h1 className="text-4xl font-display font-bold mt-4 bg-gradient-to-r from-burnit-cyan to-burnit-red bg-clip-text text-transparent">
                Burnit AI
            </h1>
            <p className="text-gray-400 mt-2">Ignite your creativity.</p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-black font-semibold py-3 px-6 rounded-xl hover:bg-gray-100 transition-all transform hover:scale-[1.02]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </button>

          <button 
            onClick={handleFacebookLogin}
            className="w-full flex items-center justify-center gap-3 bg-[#1877F2] text-white font-semibold py-3 px-6 rounded-xl hover:bg-[#166fe5] transition-all transform hover:scale-[1.02]"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036c-2.148 0-2.797 1.603-2.797 4.16v1.912h4.144l-.254 3.667h-3.89v7.98h-5.017z" /></svg>
            Continue with Facebook
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
            <div className="relative flex justify-center text-sm"><span className="px-2 bg-black text-gray-500">Or</span></div>
          </div>

          <button 
            onClick={handleDemoLogin}
            className="w-full flex items-center justify-center gap-3 bg-white/5 border border-white/10 text-white font-semibold py-3 px-6 rounded-xl hover:bg-white/10 transition-all"
          >
            <UserIcon className="w-5 h-5" />
            Try Demo Mode
          </button>

          {error && (
            <div className="mt-4 text-center text-red-500 text-sm bg-red-500/10 py-2 rounded-lg">
                {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};