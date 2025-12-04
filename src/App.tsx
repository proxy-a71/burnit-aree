import React, { useState, useEffect, useRef } from 'react';
import { User, ChatMessage, ChatSession, AppMode, SUPPORTED_LANGUAGES } from './types';
import { Auth } from './components/Auth';
import { geminiService } from './services/geminiService';
import { 
  Flame, MessageSquare, Mic, Image as ImageIcon, 
  Send, Paperclip, Settings, LogOut, Moon, Sun, X, MicOff,
  User as UserIcon, Calendar, MapPin, Camera, Video, ChevronLeft, ChevronRight, Upload, PhoneOff, VideoOff, Play, Key, Globe, File as FileIcon, Plus, MessageCircle, Menu, Link as LinkIcon
} from 'lucide-react';
import { PLACEHOLDER_AVATAR, BURNIT_LOGO_URL } from './constants';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

const CONTINENTS = [
  "Asia", "Africa", "North America", "South America", "Antarctica", "Europe", "Australia", "Other"
];

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  
  const messages = sessions.find(s => s.id === currentSessionId)?.messages || [];

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);

  const [language, setLanguage] = useState('English');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  
  const [profileForm, setProfileForm] = useState({
      displayName: '',
      region: '',
      dob: '',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveCleanupRef = useRef<{ disconnect: () => void; toggleMute: (mute: boolean) => void; sendVideoFrame: (data: string) => void } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoIntervalRef = useRef<number | null>(null);

  // New State for Attachment
  const [attachment, setAttachment] = useState<{ file: File; preview: string; type: 'image' | 'pdf' } | null>(null);

  useEffect(() => {
    const savedSessions = localStorage.getItem('burnit_sessions');
    let loadedSessions: ChatSession[] = [];
    if (savedSessions) {
        try { loadedSessions = JSON.parse(savedSessions); } catch (e) {}
    }
    if (loadedSessions.length === 0) {
        loadedSessions = [{ id: Date.now().toString(), title: 'New Chat', messages: [], lastUpdated: Date.now() }];
    }
    setSessions(loadedSessions);
    if (loadedSessions.length > 0) setCurrentSessionId(loadedSessions[0].id);
  }, []);

  const handleLogin = (loggedInUser: User) => {
      let storedProfile: Partial<User> = {};
      try {
          const storedData = localStorage.getItem(`burnit_user_profile_${loggedInUser.uid}`);
          if (storedData) {
              storedProfile = JSON.parse(storedData);
          }
      } catch (e) { console.error("Failed to load profile", e); }

      const completeUser = { 
          ...loggedInUser, 
          joinedDate: storedProfile.joinedDate || Date.now(), 
          region: storedProfile.region || 'Asia', 
          dob: storedProfile.dob || '',
          displayName: storedProfile.displayName || loggedInUser.displayName,
          photoURL: storedProfile.photoURL || loggedInUser.photoURL
      };

      setUser(completeUser);
      setProfileForm({ 
          displayName: completeUser.displayName || '', 
          region: completeUser.region || 'Asia', 
          dob: completeUser.dob || '' 
      });
  };

  useEffect(() => { if (sessions.length > 0) localStorage.setItem('burnit_sessions', JSON.stringify(sessions)); }, [sessions]);
  
  useEffect(() => { 
      if (chatContainerRef.current) {
          const { scrollHeight, clientHeight } = chatContainerRef.current;
          chatContainerRef.current.scrollTo({
              top: scrollHeight - clientHeight,
              behavior: 'smooth'
          });
      }
  }, [messages, isLoading]);

  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  // Video Stream Effect
  useEffect(() => {
      let activeStream: MediaStream | null = null;
      const setupStream = async () => {
          if (mode !== AppMode.LIVE || !isLiveConnected || !isVideoEnabled) return;
          try {
              activeStream = await navigator.mediaDevices.getUserMedia({ video: true });
          } catch (e) {
              console.error("Camera denied", e);
              setIsVideoEnabled(false);
              return;
          }
          if (videoRef.current) {
              if (activeStream) {
                   videoRef.current.srcObject = activeStream;
                   if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
                   const canvas = document.createElement('canvas');
                   const ctx = canvas.getContext('2d');
                   
                   videoIntervalRef.current = window.setInterval(() => {
                        if (videoRef.current && liveCleanupRef.current && ctx) {
                            // OPTIMIZATION: Send low-res frames to prevent lag/disconnect
                            // 320x240 is sufficient for AI vision and drastically improves speed
                            canvas.width = 320; 
                            canvas.height = 240;
                            ctx.drawImage(videoRef.current, 0, 0, 320, 240);
                            // Quality 0.4 compressed JPEG
                            const base64Data = canvas.toDataURL('image/jpeg', 0.4).split(',')[1];
                            liveCleanupRef.current.sendVideoFrame(base64Data);
                        }
                    }, 500); 
              }
          }
      };
      setupStream();
      return () => {
          if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
          if (activeStream) activeStream.getTracks().forEach(t => t.stop());
      };
  }, [mode, isLiveConnected, isVideoEnabled]);

  const createNewChat = () => {
      const newSession: ChatSession = { id: Date.now().toString(), title: 'New Chat', messages: [], lastUpdated: Date.now() };
      setSessions(prev => [newSession, ...prev]); 
      setCurrentSessionId(newSession.id);
      setMode(AppMode.CHAT);
      setIsSidebarOpen(false); 
      setAttachment(null);
  };

  const switchSession = (sessionId: string) => {
      setCurrentSessionId(sessionId);
      setMode(AppMode.CHAT);
      setIsSidebarOpen(false); 
      setAttachment(null);
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

  // --- File Handling ---
  const handleFileClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const isPdf = file.type === 'application/pdf';
          const reader = new FileReader();
          reader.onloadend = () => setAttachment({ file, preview: reader.result as string, type: isPdf ? 'pdf' : 'image' });
          reader.readAsDataURL(file);
      }
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && !attachment) || isLoading) return;
    
    let attachData = null;
    if (attachment) {
        attachData = { mimeType: attachment.file.type, data: attachment.preview.split(',')[1] };
    }

    const newMessage: ChatMessage = { 
        id: Date.now().toString(), role: 'user', text: input, timestamp: Date.now(), 
        type: 'text', image: attachment ? attachment.preview : undefined 
    };

    const updatedMessages = [...messages, newMessage];
    updateCurrentSession(updatedMessages);
    setInput('');
    setAttachment(null);
    setIsLoading(true);

    try {
      if (mode === AppMode.IMAGE) {
        const result = await geminiService.generateImage(newMessage.text);
        if (result.url) {
             const botMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: result.text || "Here is your generated image 🔥", image: result.url, timestamp: Date.now(), type: 'image_generated' };
            updateCurrentSession([...updatedMessages, botMsg]);
        }
      } else {
        const historyForApi = updatedMessages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
        // Destructure text and groundingMetadata
        const response = await geminiService.sendMessage(historyForApi, newMessage.text, attachData, language);
        
        const botMsg: ChatMessage = { 
            id: (Date.now() + 1).toString(), 
            role: 'model', 
            text: response.text || "No response received.", 
            timestamp: Date.now(), 
            type: 'text',
            groundingMetadata: response.groundingMetadata 
        };
        updateCurrentSession([...updatedMessages, botMsg]);
      }
    } catch (error: any) {
      console.error(error);
      const errorText = "⚠️ Error: Failed to process request.";
      const errorMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: errorText, timestamp: Date.now(), type: 'text' };
      updateCurrentSession([...updatedMessages, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const startLiveSession = async () => {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); 
        const controls = await geminiService.connectLive(
            (buffer) => {}, 
            () => {
                setIsLiveConnected(false); setIsVideoEnabled(false); setIsMicMuted(false);
                setIsAiSpeaking(false);
                if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
            },
            (speaking) => {
                setIsAiSpeaking(speaking);
            }
        );
        liveCleanupRef.current = controls;
        setIsLiveConnected(true); 
        setIsVideoEnabled(false); 
    } catch (err) {
        console.error(err);
        alert("Failed to connect to Live API. Please check your API Key and Permissions.");
    }
  };

  const endLiveSession = () => {
      if (liveCleanupRef.current) { liveCleanupRef.current.disconnect(); liveCleanupRef.current = null; }
      setIsLiveConnected(false); setIsVideoEnabled(false); setIsMicMuted(false); setIsAiSpeaking(false);
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
          const updatedUser = { ...user, displayName: profileForm.displayName, region: profileForm.region, dob: profileForm.dob };
          setUser(updatedUser);
          try {
             const dataToSave = {
                 displayName: updatedUser.displayName,
                 region: updatedUser.region,
                 dob: updatedUser.dob,
                 photoURL: updatedUser.photoURL,
                 joinedDate: updatedUser.joinedDate
             };
             localStorage.setItem(`burnit_user_profile_${user.uid}`, JSON.stringify(dataToSave));
             alert("Profile Updated Successfully!");
          } catch(e) {
             console.error("Save failed", e);
             alert("Profile Updated (Local Session Only) - Storage Full?");
          }
      }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && user) {
          const reader = new FileReader();
          reader.onloadend = () => { setUser({ ...user, photoURL: reader.result as string }); };
          reader.readAsDataURL(file);
      }
  };
  
  const handleClearHistory = () => {
      if (window.confirm("Are you sure you want to delete all chat history? This cannot be undone.")) {
          const newSession: ChatSession = {
              id: Date.now().toString(),
              title: 'New Chat',
              messages: [],
              lastUpdated: Date.now()
          };
          setSessions([newSession]);
          setCurrentSessionId(newSession.id);
          localStorage.removeItem('burnit_sessions');
          alert("Cleared Chat History!");
      }
  };

  const renderBurnitFace = () => (
    <div className="relative flex flex-col items-center justify-center w-full h-full bg-black">
         <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
            <div className={`absolute inset-0 border-2 border-burnit-cyan/30 rounded-full ${isAiSpeaking ? 'animate-spin' : 'animate-spin-slow'} duration-[10s]`}></div>
            <div className="absolute inset-4 border border-burnit-red/30 rounded-full animate-pulse"></div>
            <div className="relative z-10 w-32 h-32 md:w-40 md:h-40 bg-black rounded-full border-2 border-burnit-cyan flex flex-col items-center justify-center overflow-hidden shadow-[0_0_30px_rgba(0,240,255,0.5)]">
                 <img src={BURNIT_LOGO_URL} className="absolute inset-0 w-full h-full object-cover opacity-30 animate-pulse-slow" alt="Burnit Logo Background" onError={(e) => e.currentTarget.style.display = 'none'} />
                 <div className="relative z-20 flex flex-col items-center justify-center gap-3">
                    <div className="flex gap-4">
                        <div className="w-6 h-1 bg-burnit-cyan rounded-full shadow-[0_0_10px_#00f0ff] drop-shadow-md"></div>
                        <div className="w-6 h-1 bg-burnit-cyan rounded-full shadow-[0_0_10px_#00f0ff] drop-shadow-md"></div>
                    </div>
                    <div className={`w-6 bg-burnit-cyan rounded-full shadow-[0_0_10px_#00f0ff] drop-shadow-md transition-all duration-100 ease-in-out ${isAiSpeaking ? 'h-3' : 'h-1'}`}></div>
                 </div>
            </div>
         </div>
    </div>
  );

  if (!user) return <Auth onLogin={handleLogin} />;

  return (
    <div className={`flex h-[100dvh] w-screen ${theme === 'light' ? 'bg-gray-100 text-black' : 'bg-black text-white'} font-sans overflow-hidden`}>
      {/* Sidebar */}
      {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-[90] md:hidden" onClick={() => setIsSidebarOpen(false)}></div>}
      <div className={`fixed inset-y-0 left-0 z-[100] w-72 bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl border-r border-gray-200 dark:border-white/10 transition-transform duration-300 md:relative md:translate-x-0 flex flex-col h-full shadow-2xl md:shadow-none ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 flex flex-col gap-6 shrink-0 mt-12 md:mt-0"> 
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
               <img src={BURNIT_LOGO_URL} alt="Logo" className="w-10 h-10 rounded-full animate-flame border-2 border-burnit-cyan object-cover" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
               <span className="font-display font-bold text-2xl tracking-wide bg-gradient-to-r from-burnit-cyan to-burnit-red bg-clip-text text-transparent">Burnit AI</span>
            </div>
            <button type="button" className="md:hidden text-gray-500 hover:text-white" onClick={() => setIsSidebarOpen(false)}><X size={28} /></button>
          </div>
          <nav className="flex flex-col gap-2">
            <button type="button" onClick={createNewChat} className="flex items-center justify-start gap-3 p-3.5 rounded-xl transition-all bg-gradient-to-r from-burnit-cyan/20 to-burnit-red/20 border border-burnit-cyan/30 hover:border-burnit-cyan text-black dark:text-white group">
              <Plus size={22} className="text-burnit-cyan group-hover:scale-110 transition-transform" /><span className="font-bold text-base">New Chat</span>
            </button>
            <button type="button" onClick={() => { setMode(AppMode.CHAT); setIsSidebarOpen(false); }} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.CHAT ? 'bg-burnit-cyan/20 text-burnit-cyan' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <MessageSquare size={20} /><span className="font-medium">Chat</span>
            </button>
            <button type="button" onClick={() => { setMode(AppMode.IMAGE); setIsSidebarOpen(false); }} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.IMAGE ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <ImageIcon size={20} /><span className="font-medium">Image Gen</span>
            </button>
            <button type="button" onClick={() => { setMode(AppMode.LIVE); setIsSidebarOpen(false); }} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.LIVE ? 'bg-burnit-red/20 text-burnit-red' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <Flame size={20} className={mode === AppMode.LIVE ? 'animate-pulse' : ''} /><span className="font-medium">Burnit Live</span>
            </button>
          </nav>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-2">
           <div className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Recent History</div>
           <div className="flex flex-col gap-1">
               {sessions.map(session => (
                   <button type="button" key={session.id} onClick={() => switchSession(session.id)} className={`flex items-center justify-start gap-3 p-2.5 rounded-lg transition-all text-sm truncate w-full ${currentSessionId === session.id && mode === AppMode.CHAT ? 'bg-black/5 dark:bg-white/10 text-black dark:text-white border border-gray-200 dark:border-white/5' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'}`}>
                       <MessageCircle size={16} className="shrink-0 opacity-70" /><span className="truncate">{session.title}</span>
                   </button>
               ))}
           </div>
        </div>
        <div className="p-5 flex flex-col gap-2 shrink-0 border-t border-gray-200 dark:border-white/10 mt-auto bg-gray-50/50 dark:bg-black/20">
           <button type="button" onClick={() => { setMode(AppMode.PROFILE); setIsSidebarOpen(false); }} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.PROFILE ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <img src={user.photoURL || PLACEHOLDER_AVATAR} alt="User" className="w-9 h-9 rounded-full border border-gray-300 dark:border-white/20 object-cover" />
               <div className="flex flex-col items-start overflow-hidden"><span className="text-sm font-bold truncate w-full">{user.displayName || 'User'}</span><span className="text-xs text-gray-500">Edit Profile</span></div>
           </button>
           <button type="button" onClick={() => { setMode(AppMode.SETTINGS); setIsSidebarOpen(false); }} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.SETTINGS ? 'bg-black/10 dark:bg-white/10 text-black dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <Settings size={20} /><span className="font-medium">Settings</span>
           </button>
        </div>
      </div>

      {/* Main Content Areas */}
      {mode === AppMode.SETTINGS ? (
          <div className="flex-1 flex flex-col h-full bg-white/50 dark:bg-black/50 overflow-hidden relative z-10">
              <div className="h-16 shrink-0 flex items-center px-4 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur-md z-40 gap-4">
                   <button type="button" onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-burnit-red"><Menu size={24} /></button>
                   <h2 className="text-xl font-display font-bold text-black dark:text-white">Settings</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-24 min-h-0">
                <div className="max-w-2xl space-y-6 mx-auto">
                    <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg">
                        <h3 className="text-xl font-semibold mb-4 text-burnit-cyan">Account Details</h3>
                        <div className="space-y-3 text-gray-600 dark:text-gray-300">
                            <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2"><span>Joined Date</span><span>{new Date(user.joinedDate || Date.now()).toLocaleDateString()}</span></div>
                            <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2"><span>Born Date</span><span>{user.dob || 'Not set'}</span></div>
                            <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2"><span>Name</span><span>{user.displayName}</span></div>
                            <div className="flex justify-between border-b border-gray-100 dark:border-white/5 pb-2"><span>Email</span><span>{user.email || 'N/A'}</span></div>
                        </div>
                    </div>
                    
                    <div className="bg-white dark:bg-[#111] p-6 rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg">
                        <h3 className="text-xl font-semibold mb-4 text-black dark:text-white">Preferences</h3>
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3 text-black dark:text-white">
                                {theme === 'dark' ? <Moon className="text-purple-400" /> : <Sun className="text-yellow-500" />}
                                <span>App Theme</span>
                            </div>
                            <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="px-4 py-2 bg-gray-100 dark:bg-white/10 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-all text-sm text-black dark:text-white">
                                {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
                            </button>
                        </div>
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3 text-black dark:text-white">
                                <Globe className="text-blue-500" />
                                <span>Language</span>
                            </div>
                            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-burnit-cyan text-black dark:text-white appearance-none">
                                {SUPPORTED_LANGUAGES.map(l => (<option key={l.code} value={l.name} className="bg-white dark:bg-black text-black dark:text-white">{l.name}</option>))}
                            </select>
                        </div>
                    </div>

                    <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-2xl border border-red-200 dark:border-red-500/20 shadow-lg space-y-4">
                        <h3 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400 flex items-center gap-2"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>Danger Zone</h3>
                        <button type="button" onClick={handleClearHistory} className="w-full flex justify-between items-center p-3 rounded-lg bg-white dark:bg-black/20 hover:bg-red-100 dark:hover:bg-red-500/10 text-gray-600 dark:text-gray-300 transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-500/30"><span>Clear Chat History</span><span className="text-xs bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 rounded font-bold">CLEAR</span></button>
                        <button type="button" onClick={() => alert("Coming Soon!!")} className="w-full flex justify-between items-center p-3 rounded-lg bg-white dark:bg-black/20 hover:bg-red-100 dark:hover:bg-red-500/10 text-gray-600 dark:text-gray-300 transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-500/30"><span>Delete Account</span><span className="text-xs bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 rounded font-bold">COMING SOON</span></button>
                        <button type="button" onClick={() => { setUser(null); }} className="w-full flex items-center justify-center gap-3 p-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition-all shadow-md hover:shadow-red-500/30 mt-2"><LogOut size={18} /> Sign Out</button>
                    </div>
                </div>
              </div>
          </div>
      ) : mode === AppMode.PROFILE ? (
          <div className="flex-1 flex flex-col h-full bg-white/50 dark:bg-black/50 overflow-hidden relative z-10">
               <div className="h-16 shrink-0 flex items-center px-4 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur-md z-40 gap-4">
                   <button type="button" onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-burnit-red"><Menu size={24} /></button>
                   <h2 className="text-xl font-display font-bold text-black dark:text-white">Edit Profile</h2>
                   <div className="ml-auto">
                       <button type="button" onClick={() => setMode(AppMode.CHAT)} className="text-sm text-burnit-cyan hover:underline">Back to Chat</button>
                   </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-24 min-h-0">
                <div className="max-w-2xl bg-white dark:bg-[#111] p-6 md:p-8 rounded-2xl border border-gray-200 dark:border-white/10 shadow-xl mx-auto">
                    <div className="flex flex-col items-center mb-8">
                        <div className="relative group cursor-pointer" onClick={() => avatarInputRef.current?.click()}>
                            <img src={user.photoURL || PLACEHOLDER_AVATAR} alt="Avatar" className="w-32 h-32 rounded-full object-cover border-4 border-burnit-cyan group-hover:opacity-75 transition-opacity" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 rounded-full"><Camera className="text-white w-8 h-8 drop-shadow-lg" /></div>
                        </div>
                        <input type="file" ref={avatarInputRef} onChange={handleAvatarChange} accept="image/*" className="hidden" />
                        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Tap to change avatar</p>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Display Name</label>
                            <input type="text" value={profileForm.displayName} onChange={(e) => setProfileForm({...profileForm, displayName: e.target.value})} className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-black dark:text-white focus:border-burnit-cyan outline-none" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Region</label>
                                <div className="relative">
                                    <Globe className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                                    <select value={profileForm.region} onChange={(e) => setProfileForm({...profileForm, region: e.target.value})} className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl p-3 pl-10 text-black dark:text-white focus:border-burnit-cyan outline-none appearance-none">
                                        <option value="" disabled>Select Region</option>
                                        {CONTINENTS.map(c => (<option key={c} value={c} className="bg-white dark:bg-black text-black dark:text-white">{c}</option>))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Date of Birth</label>
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-3.5 text-gray-400 w-5 h-5" />
                                    <input type="date" value={profileForm.dob} onChange={(e) => setProfileForm({...profileForm, dob: e.target.value})} className="w-full bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-xl p-3 pl-10 text-black dark:text-white focus:border-burnit-cyan outline-none" />
                                </div>
                            </div>
                        </div>
                        <button type="button" onClick={handleUpdateProfile} className="w-full bg-gradient-to-r from-burnit-cyan to-blue-600 text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity mt-4">Save Changes</button>
                    </div>
                </div>
              </div>
          </div>
      ) : mode === AppMode.LIVE ? (
          isLiveConnected ? (
             <div className="flex-1 flex flex-col h-full bg-gray-900 dark:bg-[#0a0a0a] p-2 md:p-4 gap-4 overflow-hidden relative">
                <button type="button" onClick={() => setIsSidebarOpen(true)} className="absolute top-6 left-6 z-[60] p-3 text-white bg-black/60 rounded-full border border-white/20 hover:bg-black/80"><Menu size={24} /></button>
                <div className="flex-1 flex flex-col md:flex-row gap-4 h-full overflow-hidden">
                    <div className="flex-1 bg-black rounded-2xl border border-white/10 relative overflow-hidden flex flex-col items-center justify-center min-h-[40%]">
                        <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded-full text-xs font-bold text-burnit-cyan border border-burnit-cyan/20 flex items-center gap-2 z-20"><div className="w-2 h-2 bg-burnit-cyan rounded-full animate-pulse"></div>BURNIT AI (HOST)</div>
                        {renderBurnitFace()}
                    </div>
                    <div className="flex-1 bg-gray-800 dark:bg-[#111] rounded-2xl border border-white/10 relative overflow-hidden flex flex-col items-center justify-center group min-h-[40%]">
                        <div className="absolute top-4 right-4 bg-black/60 px-3 py-1 rounded-full text-xs font-bold text-white border border-white/10 z-20">YOU</div>
                        {isMicMuted && (<div className="absolute top-14 left-4 z-30 pointer-events-none"><div className="bg-black/60 p-2 rounded-full backdrop-blur-md border border-red-500/50 animate-pulse"><MicOff className="w-5 h-5 text-red-500" /></div></div>)}
                        {isVideoEnabled ? <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" /> : <div className="flex flex-col items-center gap-4"><img src={user.photoURL || PLACEHOLDER_AVATAR} className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-gray-600 dark:border-gray-700 opacity-50" /><p className="text-gray-400 dark:text-gray-500">Camera Off</p></div>}
                    </div>
                </div>
                <div className="h-20 shrink-0 bg-[#161616] rounded-2xl border border-white/10 flex items-center justify-center gap-4 md:gap-6 px-4 z-20">
                    <button type="button" onClick={toggleMic} className={`p-4 rounded-full transition-all ${isMicMuted ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>{isMicMuted ? <MicOff /> : <Mic />}</button>
                    <button type="button" onClick={endLiveSession} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all uppercase tracking-wider text-sm md:text-base whitespace-nowrap">End Class</button>
                    <button type="button" onClick={() => setIsVideoEnabled(!isVideoEnabled)} className={`p-4 rounded-full transition-all ${!isVideoEnabled ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>{!isVideoEnabled ? <VideoOff /> : <Video />}</button>
                </div>
             </div>
          ) : (
             <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden h-full">
                <div className="absolute top-4 left-4 z-50"><button type="button" onClick={() => setIsSidebarOpen(true)} className="p-3 bg-white/10 rounded-full text-white backdrop-blur-md border border-white/20 hover:bg-white/20"><Menu size={24} /></button></div>
                <div className="absolute inset-0 z-0"><div className="absolute top-1/4 left-1/4 w-96 h-96 bg-burnit-red/20 rounded-full blur-[120px] animate-pulse"></div><div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-burnit-cyan/20 rounded-full blur-[120px] animate-pulse delay-1000"></div></div>
                <div className="z-10 text-center max-w-lg flex flex-col items-center">
                    <div className="relative flex items-center justify-center p-8 w-32 h-32 mb-8">
                         <div className="absolute inset-0 border-2 border-burnit-cyan/30 hexagon-clip animate-hex-pulse"></div>
                         <div className="absolute inset-2 border border-dashed border-burnit-red/40 hexagon-clip animate-spin-slow"></div>
                         <div className="absolute inset-4 border border-burnit-cyan/20 hexagon-clip animate-spin-reverse-slow"></div>
                         <div className="absolute inset-0 hexagon-clip overflow-hidden opacity-30 pointer-events-none"><div className="absolute w-full h-[5px] bg-white/80 blur-sm animate-scan-line shadow-[0_0_15px_rgba(255,255,255,0.8)]"></div></div>
                         <div className="hexagon-clip overflow-hidden relative z-10 w-full h-full bg-black flex items-center justify-center border-2 border-burnit-cyan shadow-[0_0_40px_rgba(0,240,255,0.4)]">
                             <img src={BURNIT_LOGO_URL} className="w-full h-full object-cover" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
                         </div>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display font-bold mb-4 text-black dark:text-white">Burnit Live</h1>
                    <button type="button" onClick={startLiveSession} className="group relative px-8 py-4 bg-black dark:bg-white text-white dark:text-black font-bold text-xl rounded-full overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(255,42,42,0.3)] dark:hover:shadow-[0_0_40px_rgba(255,255,255,0.3)]">
                        <span className="relative z-10 flex items-center gap-3"><Play className="fill-white dark:fill-black" /> Start Conversation</span>
                    </button>
                </div>
             </div>
          )
      ) : (
        <div className="flex-1 flex flex-col h-full relative overflow-hidden">
          <header className="h-16 shrink-0 flex items-center justify-between px-4 md:px-6 border-b border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur-md z-10 transition-colors">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="md:hidden p-2 text-burnit-red"><Menu /></button>
                <h2 className="font-display font-bold text-base md:text-lg flex items-center gap-2">
                {mode === AppMode.IMAGE ? <><ImageIcon className="text-purple-500 dark:text-purple-400" size={18} /><span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Burnit Image Studio</span></> : <><MessageSquare className="text-burnit-cyan" size={18} /><span className="bg-gradient-to-r from-burnit-cyan to-blue-500 bg-clip-text text-transparent">Burnit Chat</span></>}
                </h2>
            </div>
            <div className="flex items-center gap-4">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 text-sm outline-none focus:border-burnit-cyan max-w-[100px] md:max-w-none text-black dark:text-white">
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.name} className="bg-white dark:bg-black text-black dark:text-white">{l.name}</option>)}
              </select>
            </div>
          </header>
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth min-h-0">
            {messages.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center opacity-40">
                   <div className="relative"><img src={BURNIT_LOGO_URL} className="w-24 h-24 rounded-full border border-gray-300 dark:border-white/20 mb-4 grayscale" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} /></div>
                   <p className="text-lg font-medium text-center px-4 text-black dark:text-white">How can I ignite your mind today?</p>
               </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'model' && <div className="shrink-0 flex flex-col items-center gap-1"><img src={BURNIT_LOGO_URL} alt="AI" className="w-10 h-10 rounded-full border border-burnit-cyan object-cover animate-flame" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} /><span className="text-[10px] text-burnit-cyan font-bold tracking-widest">BURNIT</span></div>}
                <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-2xl ${msg.role === 'user' ? 'bg-white text-black dark:bg-white dark:text-black rounded-tr-none shadow-md' : 'bg-white/80 dark:bg-white/5 border-l-4 border-l-burnit-cyan text-black dark:text-gray-100 rounded-tl-none shadow-sm'}`}>
                  {msg.image && msg.type !== 'image_generated' && <div className="mb-2"><img src={msg.image} className="max-h-60 rounded-lg border border-gray-200 dark:border-white/10" alt="Attachment" /></div>}
                  {msg.type === 'image_generated' && msg.image ? <div className="space-y-3"><img src={msg.image} alt="Generated" className="rounded-xl w-full" /><p>{msg.text}</p></div> : 
                    <div className="leading-relaxed overflow-x-auto max-w-full">
                        <ReactMarkdown className={`prose max-w-none break-words ${msg.role === 'model' ? 'dark:prose-invert' : ''}`} remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{msg.text}</ReactMarkdown>
                    </div>
                  }
                  {msg.groundingMetadata?.groundingChunks && (
                      <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10 flex flex-wrap gap-2">
                        {msg.groundingMetadata.groundingChunks.map((chunk: any, i: number) => {
                            if (chunk.web?.uri) {
                                return (<a key={i} href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2 py-1 bg-black/5 dark:bg-white/10 rounded-md text-xs hover:bg-black/10 dark:hover:bg-white/20 transition-colors text-blue-600 dark:text-blue-400"><LinkIcon size={10} /><span className="truncate max-w-[150px]">{chunk.web.title || chunk.web.uri}</span></a>);
                            }
                            return null;
                        })}
                      </div>
                  )}
                  <div className={`text-[10px] mt-2 opacity-50 ${msg.role === 'user' ? 'text-black' : 'text-black dark:text-white'}`}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                {msg.role === 'user' && <img src={user.photoURL || PLACEHOLDER_AVATAR} alt="User" className="w-10 h-10 rounded-full border border-gray-300 dark:border-white/20 shrink-0 object-cover" />}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-4">
                 <img src={BURNIT_LOGO_URL} className="w-10 h-10 rounded-full animate-bounce object-cover" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} />
                 <div className="bg-white/80 dark:bg-white/5 p-4 rounded-2xl rounded-tl-none flex gap-1 items-center h-12">
                    <div className="w-2 h-2 bg-burnit-cyan rounded-full animate-bounce"></div><div className="w-2 h-2 bg-burnit-cyan rounded-full animate-bounce delay-100"></div><div className="w-2 h-2 bg-burnit-cyan rounded-full animate-bounce delay-200"></div>
                 </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="shrink-0 p-4 md:p-6 bg-gradient-to-t from-gray-100 via-gray-100/80 to-transparent dark:from-black dark:via-black/80 dark:to-transparent">
            {attachment && (
                <div className="max-w-4xl mx-auto mb-2 flex items-center gap-2 px-2 animate-in fade-in slide-in-from-bottom-2">
                    <div className="relative group">
                        {attachment.type === 'pdf' ? (
                            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center border border-red-200 dark:border-red-500/30 text-red-500"><FileIcon size={24} /></div>
                        ) : (
                            <img src={attachment.preview} className="w-12 h-12 rounded-lg object-cover border border-gray-300 dark:border-white/20" />
                        )}
                        <button type="button" onClick={() => setAttachment(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 shadow-md"><X size={12} /></button>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-black/50 px-2 py-1 rounded-md">{attachment.file.name}</div>
                </div>
            )}
            <div className="relative flex items-center gap-2 max-w-4xl mx-auto bg-white dark:bg-white/5 p-2 rounded-2xl border border-gray-200 dark:border-white/10 shadow-xl">
              <button type="button" onClick={handleFileClick} className="p-3 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-colors"><Paperclip size={20} /></button>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" />
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder={mode === AppMode.IMAGE ? "Describe an image to generate..." : "Ask Burnit AI anything..."} className="flex-1 bg-transparent text-black dark:text-white placeholder-gray-500 outline-none px-2 min-w-0" />
              <button type="button" onClick={handleSendMessage} disabled={isLoading || (!input.trim() && !attachment)} style={{ background: (input.trim() || attachment) ? 'linear-gradient(to right, #00f0ff, #ff2a2a)' : '#4B5563', opacity: (input.trim() || attachment) ? 1 : 1, cursor: (input.trim() || attachment) ? 'pointer' : 'default' }} className={`p-3 rounded-xl transition-all text-white hover:scale-105 active:scale-95`}><Send size={20} fill={(input.trim() || attachment) ? "currentColor" : "none"} /></button>
            </div>
            <div className="text-center mt-2"><p className="text-[10px] text-gray-500 dark:text-gray-600">Burnit AI can make mistakes. Consider checking important information.</p></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;