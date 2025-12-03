import React, { useState, useEffect, useRef } from 'react';
import { User, ChatMessage, ChatSession, AppMode, SUPPORTED_LANGUAGES } from './types';
import { Auth } from './components/Auth';
import { geminiService } from './services/geminiService';
import { openaiService } from './services/openaiService';
import { 
  Flame, MessageSquare, Mic, Image as ImageIcon, 
  Send, Paperclip, Settings, LogOut, Moon, Sun, X, MicOff,
  User as UserIcon, Calendar, MapPin, Camera, Video, ChevronLeft, ChevronRight, Upload, PhoneOff, VideoOff, Play, Key, Globe, File as FileIcon, Plus, MessageCircle, Menu, Aperture, Activity, Hexagon, Sparkles
} from 'lucide-react';
import { PLACEHOLDER_AVATAR, BURNIT_LOGO_URL } from './constants';

const CONTINENTS = [
  "Asia", "Africa", "North America", "South America", "Antarctica", "Europe", "Australia", "Other"
];

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  // Multi-session State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  
  // Computed current messages based on session
  const messages = sessions.find(s => s.id === currentSessionId)?.messages || [];

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [language, setLanguage] = useState('English');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  
  // Profile Form State
  const [profileForm, setProfileForm] = useState({
      displayName: '',
      region: '',
      dob: '',
  });

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const liveCleanupRef = useRef<{ disconnect: () => void; toggleMute: (mute: boolean) => void; sendVideoFrame: (data: string) => void } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoIntervalRef = useRef<number | null>(null);

  // --- Initialization & Data Migration ---
  useEffect(() => {
    // 1. Try load sessions
    const savedSessions = localStorage.getItem('burnit_sessions');
    const savedHistory = localStorage.getItem('burnit_history'); // Legacy single chat
    
    let loadedSessions: ChatSession[] = [];

    if (savedSessions) {
        try {
            loadedSessions = JSON.parse(savedSessions);
        } catch (e) { console.error("Error parsing sessions", e); }
    } else if (savedHistory) {
        try {
            const legacyMsgs = JSON.parse(savedHistory);
            if (legacyMsgs.length > 0) {
                const newSession: ChatSession = {
                    id: Date.now().toString(),
                    title: 'Previous Conversation',
                    messages: legacyMsgs,
                    lastUpdated: Date.now()
                };
                loadedSessions = [newSession];
                localStorage.setItem('burnit_sessions', JSON.stringify(loadedSessions));
            }
        } catch (e) { console.error("Error migrating history", e); }
    }

    if (loadedSessions.length === 0) {
        const initialSession: ChatSession = {
            id: Date.now().toString(),
            title: 'New Chat',
            messages: [],
            lastUpdated: Date.now()
        };
        loadedSessions = [initialSession];
    }

    setSessions(loadedSessions);
    if (loadedSessions.length > 0) {
        setCurrentSessionId(loadedSessions[0].id);
    }
  }, []);

  const handleLogin = (loggedInUser: User) => {
      const completeUser = {
          ...loggedInUser,
          joinedDate: Date.now(),
          region: 'Asia',
          dob: ''
      };
      setUser(completeUser);
      setProfileForm({
          displayName: completeUser.displayName || '',
          region: completeUser.region || 'Asia',
          dob: completeUser.dob || ''
      });
  };

  useEffect(() => {
    if (sessions.length > 0) {
        localStorage.setItem('burnit_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Handle Video Stream for Live Mode
  useEffect(() => {
      if (mode === AppMode.LIVE && isLiveConnected && isVideoEnabled) {
          navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    videoIntervalRef.current = window.setInterval(() => {
                        if (videoRef.current && liveCleanupRef.current && ctx) {
                            canvas.width = videoRef.current.videoWidth || 640;
                            canvas.height = videoRef.current.videoHeight || 480;
                            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                            const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                            liveCleanupRef.current.sendVideoFrame(base64Data);
                        }
                    }, 500);
                }
            })
            .catch(err => {
                console.error("Camera denied", err);
                setIsVideoEnabled(false);
            });
      } else {
          if (videoRef.current && videoRef.current.srcObject) {
              const stream = videoRef.current.srcObject as MediaStream;
              stream.getTracks().forEach(track => track.stop());
              videoRef.current.srcObject = null;
          }
          if (videoIntervalRef.current) {
              clearInterval(videoIntervalRef.current);
              videoIntervalRef.current = null;
          }
      }
      return () => {
           if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
      };
  }, [mode, isLiveConnected, isVideoEnabled]);

  const handleFileClick = () => {
      alert("Coming Soon Bero!");
  };

  const createNewChat = () => {
      const newSession: ChatSession = {
          id: Date.now().toString(),
          title: 'New Chat',
          messages: [],
          lastUpdated: Date.now()
      };
      setSessions(prev => [newSession, ...prev]); 
      setCurrentSessionId(newSession.id);
      setMode(AppMode.CHAT);
      setIsSidebarOpen(false); 
  };

  const switchSession = (sessionId: string) => {
      setCurrentSessionId(sessionId);
      setMode(AppMode.CHAT);
      setIsSidebarOpen(false); 
  };

  const updateCurrentSession = (newMessages: ChatMessage[]) => {
      setSessions(prev => prev.map(session => {
          if (session.id === currentSessionId) {
              let title = session.title;
              if (session.title === 'New Chat' && newMessages.length > 0) {
                  const firstMsg = newMessages[0].text;
                  title = firstMsg.slice(0, 30) + (firstMsg.length > 30 ? '...' : '');
              }
              return { ...session, messages: newMessages, title, lastUpdated: Date.now() };
          }
          return session;
      }));
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now(),
      type: 'text'
    };

    const updatedMessages = [...messages, newMessage];
    updateCurrentSession(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      if (mode === AppMode.IMAGE) {
        // Use Gemini for Image Generation
        const result = await geminiService.generateImage(newMessage.text);
        if (result.url) {
             const botMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: result.text || "Here is your generated image 🔥",
                image: result.url,
                timestamp: Date.now(),
                type: 'image_generated'
            };
            updateCurrentSession([...updatedMessages, botMsg]);
        }
      } else {
        // Use OpenAI/ChatGPT for Text Chat
        const responseText = await openaiService.sendMessage(updatedMessages);
        
        const botMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            text: responseText || "No response received.",
            timestamp: Date.now(),
            type: 'text'
        };
        updateCurrentSession([...updatedMessages, botMsg]);
      }
    } catch (error: any) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: `Error: ${error.message || "Failed to connect to API."}`,
        timestamp: Date.now(),
        type: 'text'
      };
      updateCurrentSession([...updatedMessages, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const startLiveSession = async () => {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const controls = await geminiService.connectLive(
            (buffer) => {}, 
            () => {
                setIsLiveConnected(false);
                setIsVideoEnabled(false);
                setIsMicMuted(false);
                if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
            }
        );
        liveCleanupRef.current = controls;
        setIsLiveConnected(true);
        setIsVideoEnabled(true); 
    } catch (err) {
        console.error(err);
        alert("Failed to connect to Burnit Live. Check console for details.");
    }
  };

  const endLiveSession = () => {
      if (liveCleanupRef.current) {
        liveCleanupRef.current.disconnect();
        liveCleanupRef.current = null;
      }
      setIsLiveConnected(false);
      setIsVideoEnabled(false);
      setIsMicMuted(false);
  };

  const toggleMic = () => {
      if (liveCleanupRef.current) {
          const newMuteState = !isMicMuted;
          liveCleanupRef.current.toggleMute(newMuteState);
          setIsMicMuted(newMuteState);
      }
  };

  const handleUpdateProfile = () => {
      if (user) {
          const updatedUser = { 
              ...user, 
              displayName: profileForm.displayName,
              region: profileForm.region,
              dob: profileForm.dob
          };
          setUser(updatedUser);
          alert("Profile Updated Successfully!");
      }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && user) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setUser({ ...user, photoURL: reader.result as string });
          };
          reader.readAsDataURL(file);
      }
  };

  // --- UNIQUE VISUALS ---

  const renderUniqueAiVisual = (sizeClass: string = "w-32 h-32") => (
      <div className={`relative flex items-center justify-center p-8 ${sizeClass}`}>
         {/* Cyber Hexagon HUD */}
         <div className="absolute inset-0 border-2 border-burnit-cyan/30 hexagon-clip animate-hex-pulse"></div>
         <div className="absolute inset-2 border border-dashed border-burnit-red/40 hexagon-clip animate-spin-slow"></div>
         <div className="absolute inset-4 border border-burnit-cyan/20 hexagon-clip animate-spin-reverse-slow"></div>

         {/* Scanning Line */}
         <div className="absolute inset-0 hexagon-clip overflow-hidden opacity-30 pointer-events-none">
            <div className="absolute w-full h-[5px] bg-white/80 blur-sm animate-scan-line shadow-[0_0_15px_rgba(255,255,255,0.8)]"></div>
         </div>

         {/* Core Logo */}
         <div className="hexagon-clip overflow-hidden relative z-10 w-full h-full bg-black flex items-center justify-center border-2 border-burnit-cyan shadow-[0_0_40px_rgba(0,240,255,0.4)]">
             <img 
                src={BURNIT_LOGO_URL} 
                className="w-full h-full object-cover" 
                onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} 
             />
         </div>
         
         {/* Tech Badges */}
         <div className="absolute -bottom-6 bg-black text-[10px] text-burnit-cyan px-3 py-1 border border-burnit-cyan/50 font-mono tracking-widest whitespace-nowrap">
            BURNIT AI::ONLINE
         </div>
      </div>
  );

  // --- RENDERERS ---

  if (!user) {
    return <Auth onLogin={handleLogin} />;
  }

  const renderSidebar = () => (
    <>
      {isSidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-[90] md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}
      
      <div className={`fixed inset-y-0 left-0 z-[100] w-72 bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl border-r border-gray-200 dark:border-white/10 transition-transform duration-300 md:relative md:translate-x-0 flex flex-col h-full shadow-2xl md:shadow-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        
        <div className="p-5 flex flex-col gap-6 shrink-0 mt-12 md:mt-0"> 
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
               <img src={BURNIT_LOGO_URL} alt="Logo" className="w-10 h-10 rounded-full animate-flame border-2 border-burnit-cyan object-cover" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
               <span className="font-display font-bold text-2xl tracking-wide bg-gradient-to-r from-burnit-cyan to-burnit-red bg-clip-text text-transparent">Burnit</span>
            </div>
            <button className="md:hidden text-gray-500 hover:text-white" onClick={() => setIsSidebarOpen(false)}>
                <X size={28} />
            </button>
          </div>

          <nav className="flex flex-col gap-2">
            <button 
              onClick={createNewChat}
              className="flex items-center justify-start gap-3 p-3.5 rounded-xl transition-all bg-gradient-to-r from-burnit-cyan/20 to-burnit-red/20 border border-burnit-cyan/30 hover:border-burnit-cyan text-black dark:text-white group"
            >
              <Plus size={22} className="text-burnit-cyan group-hover:scale-110 transition-transform" />
              <span className="font-bold text-base">New Chat</span>
            </button>

            <button 
              onClick={() => { setMode(AppMode.CHAT); setIsSidebarOpen(false); }}
              className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.CHAT ? 'bg-burnit-cyan/20 text-burnit-cyan' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}
            >
              <MessageSquare size={20} />
              <span className="font-medium">Chat</span>
            </button>
            <button 
              onClick={() => { setMode(AppMode.IMAGE); setIsSidebarOpen(false); }}
              className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.IMAGE ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}
            >
              <ImageIcon size={20} />
              <span className="font-medium">Image Gen</span>
            </button>
            <button 
              onClick={() => { setMode(AppMode.LIVE); setIsSidebarOpen(false); }}
              className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.LIVE ? 'bg-burnit-red/20 text-burnit-red' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}
            >
              <Flame size={20} className={mode === AppMode.LIVE ? 'animate-pulse' : ''} />
              <span className="font-medium">Burnit Live</span>
            </button>
          </nav>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-2">
           <div className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Recent History</div>
           <div className="flex flex-col gap-1">
               {sessions.map(session => (
                   <button
                      key={session.id}
                      onClick={() => switchSession(session.id)}
                      className={`flex items-center justify-start gap-3 p-2.5 rounded-lg transition-all text-sm truncate w-full ${currentSessionId === session.id && mode === AppMode.CHAT ? 'bg-black/5 dark:bg-white/10 text-black dark:text-white border border-gray-200 dark:border-white/5' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'}`}
                   >
                       <MessageCircle size={16} className="shrink-0 opacity-70" />
                       <span className="truncate">{session.title}</span>
                   </button>
               ))}
           </div>
        </div>

        <div className="p-5 flex flex-col gap-2 shrink-0 border-t border-gray-200 dark:border-white/10 mt-auto bg-gray-50/50 dark:bg-black/20">
           <button 
              onClick={() => { setMode(AppMode.PROFILE); setIsSidebarOpen(false); }}
              className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.PROFILE ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}
           >
              <img src={user.photoURL || PLACEHOLDER_AVATAR} alt="User" className="w-9 h-9 rounded-full border border-gray-300 dark:border-white/20 object-cover" />
               <div className="flex flex-col items-start overflow-hidden">
                  <span className="text-sm font-bold truncate w-full">{user.displayName || 'User'}</span>
                  <span className="text-xs text-gray-500">Edit Profile</span>
               </div>
           </button>

           <button 
              onClick={() => { setMode(AppMode.SETTINGS); setIsSidebarOpen(false); }}
              className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.SETTINGS ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}
            >
              <Settings size={20} />
              <span className="font-medium">Settings</span>
           </button>
        </div>
      </div>
    </>
  );

  const renderProfile = () => (
      <div className="flex-1 flex flex-col h-full bg-white/50 dark:bg-black/50 overflow-hidden relative z-10">
          <div className="h-16 shrink-0 flex items-center px-4 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur-md z-40 gap-4">
               <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-black dark:text-white">
                    <Menu size={24} />
               </button>
               <h2 className="text-xl font-display font-bold text-black dark:text-white">Edit Profile</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-24 min-h-0">
            <div className="max-w-2xl bg-white dark:bg-[#111] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-white/10 shadow-xl mx-auto">
                <div className="flex flex-col items-center mb-8">
                    <div className="relative group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
                        <img 
                            src={user.photoURL || PLACEHOLDER_AVATAR} 
                            alt="Avatar" 
                            className="w-32 h-32 rounded-full object-cover border-4 border-burnit-cyan group-hover:opacity-75 transition-opacity" 
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Camera className="text-white w-8 h-8 drop-shadow-lg" />
                        </div>
                    </div>
                    <input type="file" ref={avatarInputRef} onChange={handleAvatarChange} accept="image/*" className="hidden" />
                    <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Tap to change avatar</p>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Display Name</label>
                        <input 
                            type="text" 
                            value={profileForm.displayName} 
                            onChange={(e) => setProfileForm({...profileForm, displayName: e.target.value})}
                            className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-black dark:text-white focus:border-burnit-cyan outline-none" 
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Region</label>
                            <div className="relative">
                                <Globe className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                                <select
                                    value={profileForm.region}
                                    onChange={(e) => setProfileForm({...profileForm, region: e.target.value})}
                                    className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl p-3 pl-10 text-black dark:text-white focus:border-burnit-cyan outline-none appearance-none"
                                >
                                    <option value="" disabled>Select Region</option>
                                    {CONTINENTS.map(c => (
                                        <option key={c} value={c} className="bg-white dark:bg-black text-black dark:text-white">{c}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Date of Birth</label>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                                <input 
                                    type="date" 
                                    value={profileForm.dob} 
                                    onChange={(e) => setProfileForm({...profileForm, dob: e.target.value})}
                                    className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl p-3 pl-10 text-black dark:text-white focus:border-burnit-cyan outline-none" 
                                />
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleUpdateProfile}
                        className="w-full bg-gradient-to-r from-burnit-cyan to-blue-600 text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity mt-4"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
          </div>
      </div>
  );

  const renderSettings = () => (
      <div className="flex-1 flex flex-col h-full bg-white/50 dark:bg-black/50 overflow-hidden relative z-10">
          <div className="h-16 shrink-0 flex items-center px-4 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur-md z-40 gap-4">
               <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-black dark:text-white">
                    <Menu size={24} />
               </button>
               <h2 className="text-xl font-display font-bold text-black dark:text-white">Settings</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-24 min-h-0">
            <div className="max-w-2xl space-y-6 mx-auto">
                <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 text-burnit-cyan">Account Details</h3>
                    <div className="space-y-3 text-gray-600 dark:text-gray-300">
                        <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                            <span>Joined Date</span>
                            <span>{new Date(user.joinedDate || Date.now()).toLocaleDateString()}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                            <span>Born Date</span>
                            <span>{user.dob || 'Not set'}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                            <span>Name</span>
                            <span>{user.displayName}</span>
                        </div>
                        <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2">
                            <span>Email</span>
                            <span>{user.email || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg">
                    <h3 className="text-xl font-semibold mb-4 text-black dark:text-white">Preferences</h3>
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3 text-black dark:text-white">
                            {theme === 'dark' ? <Moon className="text-purple-400" /> : <Sun className="text-yellow-500" />}
                            <span>App Theme</span>
                        </div>
                        <button 
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            className="px-4 py-2 bg-gray-100 dark:bg-white/10 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-all text-sm text-black dark:text-white"
                        >
                            {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Key className="w-4 h-4 text-gray-400"/>
                            <label className="text-sm font-medium text-gray-400">Aree Ai Configurations</label>
                        </div>
                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-400/10 p-3 rounded-xl border border-green-200 dark:border-green-400/20">
                            <span className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full animate-pulse"></span>
                            <span className="text-sm font-medium">Auto Aree Ai Connected</span>
                        </div>
                    </div>
                </div>

                <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-2xl border border-red-200 dark:border-red-500/20 shadow-lg space-y-4">
                    <h3 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400 flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                        Danger Zone
                    </h3>
                    <button className="w-full flex justify-between items-center p-3 rounded-lg bg-white dark:bg-black/20 hover:bg-red-100 dark:hover:bg-red-500/10 text-gray-600 dark:text-gray-300 transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-500/30">
                        <span>Clear Chat History</span>
                        <span className="text-xs bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 rounded font-bold">COMING SOON</span>
                    </button>
                    <button className="w-full flex justify-between items-center p-3 rounded-lg bg-white dark:bg-black/20 hover:bg-red-100 dark:hover:bg-red-500/10 text-gray-600 dark:text-gray-300 transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-500/30">
                        <span>Delete Account</span>
                        <span className="text-xs bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 rounded font-bold">COMING SOON</span>
                    </button>
                    <button 
                        onClick={() => { setUser(null); }}
                        className="w-full flex items-center justify-center gap-3 p-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-all shadow-md hover:shadow-red-500/30 mt-2"
                    >
                        <LogOut size={18} />
                        Sign Out
                    </button>
                </div>
            </div>
          </div>
      </div>
  );

  const renderLiveLobby = () => (
      <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden h-full">
          {/* MENU BUTTON - ALWAYS VISIBLE */}
          <div className="absolute top-4 left-4 z-50">
                <button onClick={() => setIsSidebarOpen(true)} className="p-3 bg-white/10 rounded-full text-white backdrop-blur-md border border-white/20 hover:bg-white/20">
                    <Menu size={24} />
                </button>
          </div>
          
          <div className="absolute inset-0 z-0">
             <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-burnit-red/20 rounded-full blur-[120px] animate-pulse"></div>
             <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-burnit-cyan/20 rounded-full blur-[120px] animate-pulse delay-1000"></div>
          </div>
          <div className="z-10 text-center max-w-lg flex flex-col items-center">
              {renderUniqueAiVisual()}
              
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-4 mt-8 text-black dark:text-white">Burnit Live</h1>
              <p className="text-gray-500 dark:text-gray-400 text-lg mb-8">Enter the online class environment. Real-time voice and video interaction.</p>
              <button 
                  onClick={startLiveSession}
                  className="group relative px-8 py-4 bg-black dark:bg-white text-white dark:text-black font-bold text-xl rounded-full overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(255,42,42,0.3)] dark:hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]"
              >
                  <span className="relative z-10 flex items-center gap-3"><Play className="fill-white dark:fill-black" /> Start Conversation</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-burnit-cyan to-burnit-red opacity-0 group-hover:opacity-20 transition-opacity"></div>
              </button>
          </div>
      </div>
  );

  const renderLiveClass = () => (
      <div className="flex-1 flex flex-col h-full bg-gray-900 dark:bg-[#0a0a0a] p-2 md:p-4 gap-4 overflow-hidden relative">
          {/* MENU BUTTON - ALWAYS VISIBLE */}
          <button onClick={() => setIsSidebarOpen(true)} className="absolute top-6 left-6 z-[60] p-3 text-white bg-black/60 rounded-full border border-white/20 hover:bg-black/80">
              <Menu size={24} />
          </button>

          <div className="flex-1 flex flex-col md:flex-row gap-4 h-full overflow-hidden">
              <div className="flex-1 bg-black rounded-2xl border border-white/10 relative overflow-hidden flex flex-col items-center justify-center min-h-[40%]">
                  <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded-full text-xs font-bold text-burnit-cyan border border-burnit-cyan/20 flex items-center gap-2 z-20">
                      <div className="w-2 h-2 bg-burnit-cyan rounded-full animate-pulse"></div>
                      BURNIT AI (HOST)
                  </div>
                  <div className="relative flex flex-col items-center justify-center w-full h-full">
                       {/* UNIQUE VISUAL */}
                       {renderUniqueAiVisual("w-48 h-48 md:w-64 md:h-64")}
                  </div>
              </div>
              <div className="flex-1 bg-gray-800 dark:bg-[#111] rounded-2xl border border-white/10 relative overflow-hidden flex flex-col items-center justify-center group min-h-[40%]">
                  <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded-full text-xs font-bold text-white border border-white/10 z-20">YOU</div>
                  {isVideoEnabled ? (
                      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]" />
                  ) : (
                      <div className="flex flex-col items-center gap-4">
                          <img src={user.photoURL || PLACEHOLDER_AVATAR} className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-gray-600 dark:border-gray-700 opacity-50" />
                          <p className="text-gray-400 dark:text-gray-500">Camera Off</p>
                      </div>
                  )}
                  <div className="absolute bottom-4 right-4 text-xs text-white bg-black/40 px-2 py-1 rounded">{user.displayName}</div>
              </div>
          </div>
          <div className="h-20 shrink-0 bg-[#161616] rounded-2xl border border-white/10 flex items-center justify-center gap-6 px-6 z-20">
              <button onClick={toggleMic} className={`p-4 rounded-full transition-all ${isMicMuted ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                  {isMicMuted ? <MicOff /> : <Mic />}
              </button>
              <button onClick={endLiveSession} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all uppercase tracking-wider text-sm md:text-base whitespace-nowrap">End Class</button>
              <button onClick={() => setIsVideoEnabled(!isVideoEnabled)} className={`p-4 rounded-full transition-all ${!isVideoEnabled ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
                  {!isVideoEnabled ? <VideoOff /> : <Video />}
              </button>
          </div>
      </div>
  );

  return (
    <div className={`flex h-[100dvh] w-screen ${theme === 'light' ? 'bg-gray-100 text-black' : 'bg-black text-white'} font-sans overflow-hidden`}>
      {renderSidebar()}
      
      {mode === AppMode.SETTINGS ? renderSettings() : 
       mode === AppMode.PROFILE ? renderProfile() :
       mode === AppMode.LIVE ? (isLiveConnected ? renderLiveClass() : renderLiveLobby()) :
       (
        <div className="flex-1 flex flex-col h-full relative overflow-hidden">
          <header className="h-16 shrink-0 flex items-center justify-between px-4 md:px-6 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur-md z-10 transition-colors">
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-2 text-black dark:text-white"
                >
                    <Menu />
                </button>
                <h2 className="font-display font-bold text-base md:text-lg flex items-center gap-2">
                {mode === AppMode.IMAGE ? (
                    <>
                        <ImageIcon className="text-purple-500 dark:text-purple-400" size={18} />
                        <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Burnit Image Studio</span>
                    </>
                ) : (
                    <>
                        <MessageSquare className="text-burnit-cyan" size={18} />
                        <span className="bg-gradient-to-r from-burnit-cyan to-blue-500 bg-clip-text text-transparent">Burnit Chat</span>
                    </>
                )}
                </h2>
            </div>

            <div className="flex items-center gap-4">
              <select 
                value={language} 
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 text-sm outline-none focus:border-burnit-cyan max-w-[100px] md:max-w-none text-black dark:text-white"
              >
                {SUPPORTED_LANGUAGES.map(l => (
                  <option key={l.code} value={l.name} className="bg-white dark:bg-black text-black dark:text-white">{l.name}</option>
                ))}
              </select>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth min-h-0">
            {messages.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center opacity-40">
                   <div className="relative">
                       <img src={BURNIT_LOGO_URL} className="w-24 h-24 rounded-full border border-gray-300 dark:border-white/20 mb-4 grayscale" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
                   </div>
                   <p className="text-lg font-medium text-center px-4 text-black dark:text-white">How can I ignite your mind today?</p>
               </div>
            )}
            
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'model' && (
                    <div className="shrink-0 flex flex-col items-center gap-1">
                        <img src={BURNIT_LOGO_URL} alt="AI" className="w-10 h-10 rounded-full border border-burnit-cyan object-cover animate-flame" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
                        <span className="text-[10px] text-burnit-cyan font-bold tracking-widest">BURNIT</span>
                    </div>
                )}
                
                <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-white text-black rounded-tr-none shadow-md' : 'bg-white/80 dark:bg-white/5 border-l-4 border-l-burnit-cyan text-black dark:text-gray-100 rounded-tl-none shadow-sm'}`}>
                  {msg.image && msg.type !== 'image_generated' && (
                       <div className="mb-2">
                           <img src={msg.image} className="max-h-60 rounded-lg border border-gray-200 dark:border-white/10" alt="Attachment" />
                       </div>
                  )}
                  {msg.type === 'image_generated' && msg.image ? (
                    <div className="space-y-3">
                        <img src={msg.image} alt="Generated" className="rounded-xl w-full" />
                        <p>{msg.text}</p>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                  )}
                  <div className={`text-[10px] mt-2 opacity-50 ${msg.role === 'user' ? 'text-black' : 'text-black dark:text-white'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {msg.role === 'user' && (
                    <img src={user.photoURL || PLACEHOLDER_AVATAR} alt="User" className="w-10 h-10 rounded-full border border-gray-300 dark:border-white/20 shrink-0 object-cover" />
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-4">
                 <img src={BURNIT_LOGO_URL} className="w-10 h-10 rounded-full animate-bounce object-cover" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
                 <div className="bg-white/80 dark:bg-white/5 p-4 rounded-2xl rounded-tl-none flex gap-1 items-center h-12">
                    <div className="w-2 h-2 bg-burnit-cyan rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-burnit-cyan rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-burnit-cyan rounded-full animate-bounce delay-200"></div>
                 </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 p-4 md:p-6 bg-gradient-to-t from-gray-100 via-gray-100/80 to-transparent dark:from-black dark:via-black/80 dark:to-transparent">
            <div className="relative flex items-center gap-2 max-w-4xl mx-auto bg-white dark:bg-white/5 p-2 rounded-2xl border border-gray-200 dark:border-white/10 shadow-xl">
              <button 
                onClick={handleFileClick}
                className="p-3 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-colors"
              >
                <Paperclip size={20} />
              </button>
              
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={mode === AppMode.IMAGE ? "Describe an image to generate..." : "Ask Burnit AI anything..."}
                className="flex-1 bg-transparent text-black dark:text-white placeholder-gray-500 outline-none px-2 min-w-0"
              />

              <button 
                onClick={handleSendMessage}
                disabled={isLoading || !input.trim()}
                style={{
                    background: input.trim() ? 'linear-gradient(to right, #00f0ff, #ff2a2a)' : '#4B5563',
                    opacity: input.trim() ? 1 : 1,
                    cursor: input.trim() ? 'pointer' : 'default'
                }}
                className={`p-3 rounded-xl transition-all text-white hover:scale-105 active:scale-95`}
              >
                <Send size={20} fill={input.trim() ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="text-center mt-2">
                <p className="text-[10px] text-gray-500 dark:text-gray-600">Burnit AI can make mistakes. Consider checking important information.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;