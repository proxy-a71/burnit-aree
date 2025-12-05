import React, { useState, useEffect, useRef } from 'react';
import { User, ChatMessage, ChatSession, AppMode, SUPPORTED_LANGUAGES } from './types';
import { Auth } from './components/Auth';
import { geminiService } from './services/geminiService';
import { 
  Flame, MessageSquare, Mic, Image as ImageIcon, 
  Send, Paperclip, Settings, LogOut, Moon, Sun, X, MicOff,
  User as UserIcon, Calendar, MapPin, Camera, Video, ChevronLeft, ChevronRight, Upload, PhoneOff, VideoOff, Play, Key, Globe, File as FileIcon, Plus, MessageCircle, Menu, Link as LinkIcon, Wand2,
  Pause, PlayCircle, Music, Disc, SkipForward, Volume2, ExternalLink, Speaker
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

  // New Live States
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [userVolume, setUserVolume] = useState(0);
  const [playingTrack, setPlayingTrack] = useState<string | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false); // Music playing state
  const [playerError, setPlayerError] = useState(false); // Track player errors

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
  const musicFrameRef = useRef<HTMLIFrameElement>(null);
  const livePdfInputRef = useRef<HTMLInputElement>(null); // New ref for live PDF
  
  const liveCleanupRef = useRef<{ 
      disconnect: () => void; 
      toggleMute: (mute: boolean) => void; 
      sendVideoFrame: (data: string) => void;
      setPaused: (paused: boolean) => void;
      updateContext: (text: string, restart: () => void) => void;
      processorNode?: ScriptProcessorNode | null;
      sourceNode?: MediaStreamAudioSourceNode | null;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoIntervalRef = useRef<number | null>(null);

  const [attachment, setAttachment] = useState<{ file: File; preview: string; type: 'image' | 'pdf' } | null>(null);

  // --- Permission Request on Login ---
  useEffect(() => {
    if (user) {
        const timer = setTimeout(() => {
             navigator.permissions.query({ name: 'microphone' as PermissionName }).then((permissionStatus) => {
                 if (permissionStatus.state !== 'granted') {
                     if (window.confirm("The Burnit AI May Not Work Properly Without These Permission")) {
                         navigator.mediaDevices.getUserMedia({ audio: true, video: true })
                            .then((stream) => {
                                stream.getTracks().forEach(track => track.stop());
                            })
                            .catch(err => console.log("Permission denied", err));
                     }
                 }
             }).catch(() => {
                  if (window.confirm("The Burnit AI May Not Work Properly Without These Permission")) {
                         navigator.mediaDevices.getUserMedia({ audio: true, video: true })
                            .then((stream) => stream.getTracks().forEach(track => track.stop()))
                            .catch(err => console.log("Permission denied", err));
                  }
             });
        }, 1000);
        return () => clearTimeout(timer);
    }
  }, [user]);

  useEffect(() => {
    const savedSessions = localStorage.getItem('burnit_sessions');
    let loadedSessions: ChatSession[] = [];
    if (savedSessions) {
        try { loadedSessions = JSON.parse(savedSessions); } catch (e) {}
    }
    loadedSessions = loadedSessions.map(s => ({
        ...s,
        sessionType: s.sessionType || 'chat' 
    }));

    if (loadedSessions.length === 0) {
        const initialSession: ChatSession = { 
            id: Date.now().toString(), 
            title: 'New Chat', 
            messages: [], 
            lastUpdated: Date.now(),
            sessionType: 'chat'
        };
        loadedSessions = [initialSession];
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

  useEffect(() => { 
      if (sessions.length > 0) {
          try {
              localStorage.setItem('burnit_sessions', JSON.stringify(sessions));
          } catch (e) {
              console.error("Storage limit reached.", e);
          }
      }
  }, [sessions]);
  
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

  // Handle Music State
  useEffect(() => {
      if (playingTrack) {
          setIsMusicPlaying(true);
          setPlayerError(false); // Reset error on new track
      } else {
          setIsMusicPlaying(false);
      }
  }, [playingTrack]);

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
                        if (videoRef.current && liveCleanupRef.current && ctx && !isLivePaused) {
                            canvas.width = 320; 
                            canvas.height = 240;
                            ctx.drawImage(videoRef.current, 0, 0, 320, 240);
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
  }, [mode, isLiveConnected, isVideoEnabled, isLivePaused]);

  // --- Strict Session Separation Logic ---
  const handleSwitchMode = (newMode: AppMode) => {
      setMode(newMode);
      setInput('');
      setAttachment(null);
      setIsSidebarOpen(false);

      if (newMode === AppMode.CHAT || newMode === AppMode.IMAGE) {
          const targetType = newMode === AppMode.IMAGE ? 'image' : 'chat';
          
          // Find the most recent session of this type
          const recentSession = sessions
             .filter(s => s.sessionType === targetType)
             .sort((a, b) => b.lastUpdated - a.lastUpdated)[0];
          
          if (recentSession) {
              setCurrentSessionId(recentSession.id);
          } else {
              // Create new if none exists
              const newSession: ChatSession = { 
                  id: Date.now().toString(), 
                  title: newMode === AppMode.IMAGE ? 'New Image Gen' : 'New Chat', 
                  messages: [], 
                  lastUpdated: Date.now(),
                  sessionType: targetType
              };
              setSessions(prev => [newSession, ...prev]);
              setCurrentSessionId(newSession.id);
          }
      }
  };

  const createNewChat = () => {
      const currentType = mode === AppMode.IMAGE ? 'image' : 'chat';
      const newSession: ChatSession = { 
          id: Date.now().toString(), 
          title: mode === AppMode.IMAGE ? 'New Image Gen' : 'New Chat', 
          messages: [], 
          lastUpdated: Date.now(),
          sessionType: currentType
      };
      setSessions(prev => [newSession, ...prev]); 
      setCurrentSessionId(newSession.id);
      setIsSidebarOpen(false); 
      setAttachment(null);
  };

  const switchSession = (sessionId: string) => {
      const targetSession = sessions.find(s => s.id === sessionId);
      if (targetSession) {
          if (targetSession.sessionType === 'image') setMode(AppMode.IMAGE);
          else setMode(AppMode.CHAT);
          
          setCurrentSessionId(sessionId);
          setIsSidebarOpen(false); 
          setAttachment(null);
      }
  };

  const updateCurrentSession = (newMessages: ChatMessage[]) => {
      setSessions(prev => prev.map(session => {
          if (session.id === currentSessionId) {
              let title = session.title;
              if ((session.title === 'New Chat' || session.title === 'New Image Gen') && newMessages.length > 0) {
                  const firstMsg = newMessages[0].text;
                  title = firstMsg.slice(0, 30) + (firstMsg.length > 30 ? '...' : '');
              }
              return { ...session, messages: newMessages, title, lastUpdated: Date.now() };
          }
          return session;
      }));
  };

  const handleFileClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const isPdf = file.type === 'application/pdf';
          const reader = new FileReader();
          reader.onloadend = () => {
             if (reader.result && (reader.result as string).length > 4000000) { 
                 alert("Image Size Limit is 3mb!!");
                 return;
             }
             setAttachment({ file, preview: reader.result as string, type: isPdf ? 'pdf' : 'image' })
          };
          reader.readAsDataURL(file);
      }
  };

  // --- NEW: Handle PDF Upload in Live Mode (Safe Reconnect Strategy) ---
  const handleLivePdfClick = () => livePdfInputRef.current?.click();
  const handleLivePdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && liveCleanupRef.current) {
           const reader = new FileReader();
           reader.onloadend = async () => {
               const base64 = (reader.result as string).split(',')[1];
               alert("Burnit AI is reading your PDF document... please wait a moment.");
               
               const extractedText = await geminiService.readPdf(base64);
               
               if (!extractedText || extractedText.length < 5) {
                   alert("Could not extract text from this PDF. It might be an image-only PDF.");
                   return;
               }

               // Safely update context and hard restart to avoid double voice
               liveCleanupRef.current?.updateContext(extractedText, () => {
                   if (liveCleanupRef.current) {
                       liveCleanupRef.current.disconnect();
                       liveCleanupRef.current = null; // IMPORTANT: Nullify ref immediately
                   }
                   setIsLiveConnected(false);
                   
                   // Increase delay to ensure socket is fully closed and buffers cleared
                   setTimeout(() => {
                       startLiveSession();
                       alert("PDF Added! Burnit AI has restarted with the new document.");
                   }, 1000); 
               });
           };
           reader.readAsDataURL(file);
      }
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && !attachment) || isLoading) return;
    
    try {
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

        if (mode === AppMode.IMAGE) {
            const result = await geminiService.generateOrEditImage(newMessage.text, attachData);
            if (result.url) {
                const botMsg: ChatMessage = { 
                id: (Date.now() + 1).toString(), 
                role: 'model', 
                text: result.text || "Here is your creation 🔥", 
                image: result.url, 
                timestamp: Date.now(), 
                type: 'image_generated' 
                };
                updateCurrentSession([...updatedMessages, botMsg]);
            }
        } else {
            const historyForApi = updatedMessages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
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
      console.error("Message handling error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const startLiveSession = async () => {
    try {
        // Extract recent history (last 15 messages)
        const historyContext = messages.slice(-15).map(m => {
            const role = m.role === 'user' ? 'User' : 'Burnit AI';
            return `${role}: ${m.text}`;
        }).join('\n');

        await navigator.mediaDevices.getUserMedia({ audio: true }); 
        const controls = await geminiService.connectLive(
            historyContext, // Pass history here
            (buffer) => {}, 
            () => {
                setIsLiveConnected(false); setIsVideoEnabled(false); setIsMicMuted(false);
                setIsAiSpeaking(false); setIsLivePaused(false); setPlayingTrack(null);
                if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
            },
            (speaking) => setIsAiSpeaking(speaking),
            (volume) => setUserVolume(volume),
            (trackQuery) => setPlayingTrack(trackQuery)
        );
        liveCleanupRef.current = controls;
        setIsLiveConnected(true); 
        setIsVideoEnabled(false); 
        setIsLivePaused(false);
        setPlayingTrack(null);
    } catch (err) {
        console.error(err);
        alert("Failed to connect to Live API. Please check your API Key and Permissions.");
    }
  };

  const endLiveSession = () => {
      if (liveCleanupRef.current) { 
          liveCleanupRef.current.disconnect(); 
          liveCleanupRef.current = null; 
      }
      setIsLiveConnected(false); setIsVideoEnabled(false); setIsMicMuted(false); setIsAiSpeaking(false); setIsLivePaused(false); setPlayingTrack(null);
  };

  const toggleMic = () => {
      if (liveCleanupRef.current) {
          const newMuteState = !isMicMuted;
          liveCleanupRef.current.toggleMute(newMuteState);
          setIsMicMuted(newMuteState);
      }
  };

  const toggleHold = () => {
      if (liveCleanupRef.current) {
          const newPausedState = !isLivePaused;
          liveCleanupRef.current.setPaused(newPausedState);
          setIsLivePaused(newPausedState);
      }
  };

  const toggleMusicPlay = () => {
      if (!musicFrameRef.current) return;
      if (isMusicPlaying) {
          musicFrameRef.current.contentWindow?.postMessage(JSON.stringify({event: 'command', func: 'pauseVideo'}), '*');
          setIsMusicPlaying(false);
      } else {
          musicFrameRef.current.contentWindow?.postMessage(JSON.stringify({event: 'command', func: 'playVideo'}), '*');
          musicFrameRef.current.contentWindow?.postMessage(JSON.stringify({event: 'command', func: 'unMute'}), '*');
          setIsMusicPlaying(true);
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
      if (window.confirm("Are you sure you want to delete all chat history?")) {
          localStorage.removeItem('burnit_sessions');
          createNewChat(); 
          alert("Cleared Chat History!");
      }
  };

  const renderBurnitFace = () => (
    <div className="relative flex flex-col items-center justify-center w-full h-full bg-black">
         <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
            <div className={`absolute inset-0 border-2 border-burnit-cyan/30 rounded-full ${isAiSpeaking && !isLivePaused ? 'animate-spin' : 'animate-spin-slow'} duration-[10s]`}></div>
            <div className="absolute inset-4 border border-burnit-red/30 rounded-full animate-pulse"></div>
            <div className="relative z-10 w-32 h-32 md:w-40 md:h-40 bg-black rounded-full border-2 border-burnit-cyan flex flex-col items-center justify-center overflow-hidden shadow-[0_0_30px_rgba(0,240,255,0.5)]">
                 <img src={BURNIT_LOGO_URL} className="absolute inset-0 w-full h-full object-cover opacity-30 animate-pulse-slow" alt="Burnit Logo Background" onError={(e) => e.currentTarget.style.display = 'none'} />
                 <div className="relative z-20 flex flex-col items-center justify-center gap-3">
                    <div className="flex gap-4">
                        <div className="w-6 h-1 bg-burnit-cyan rounded-full shadow-[0_0_10px_#00f0ff] drop-shadow-md"></div>
                        <div className="w-6 h-1 bg-burnit-cyan rounded-full shadow-[0_0_10px_#00f0ff] drop-shadow-md"></div>
                    </div>
                    <div className={`w-6 bg-burnit-cyan rounded-full shadow-[0_0_10px_#00f0ff] drop-shadow-md transition-all duration-100 ease-in-out ${isAiSpeaking && !isLivePaused ? 'h-3' : 'h-1'}`}></div>
                 </div>
            </div>
         </div>
    </div>
  );

  const renderUserVisualizer = () => {
      return (
          <div className="flex items-end gap-1 h-8 absolute bottom-4 left-4 z-30">
             {[0.6, 1.0, 0.8, 0.5, 0.9].map((scale, i) => (
                 <div 
                    key={i} 
                    className="w-1 bg-white rounded-full transition-all duration-75"
                    style={{ 
                        height: isLivePaused ? '4px' : `${Math.max(4, userVolume * 40 * scale)}px`,
                        opacity: isLivePaused ? 0.3 : 0.8 + (userVolume * 0.2)
                    }}
                 ></div>
             ))}
          </div>
      );
  };

  if (!user) return <Auth onLogin={handleLogin} />;

  const currentModeSessions = sessions.filter(s => {
      if (mode === AppMode.IMAGE) return s.sessionType === 'image';
      return s.sessionType !== 'image'; 
  });

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
              <Plus size={22} className="text-burnit-cyan group-hover:scale-110 transition-transform" /><span className="font-bold text-base">{mode === AppMode.IMAGE ? 'New Image Gen' : 'New Chat'}</span>
            </button>
            <button type="button" onClick={() => handleSwitchMode(AppMode.CHAT)} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.CHAT ? 'bg-burnit-cyan/20 text-burnit-cyan' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <MessageSquare size={20} /><span className="font-medium">Chat</span>
            </button>
            <button type="button" onClick={() => handleSwitchMode(AppMode.IMAGE)} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.IMAGE ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <ImageIcon size={20} /><span className="font-medium">Image Gen</span>
            </button>
            <button type="button" onClick={() => handleSwitchMode(AppMode.LIVE)} className={`flex items-center justify-start gap-3 p-3 rounded-xl transition-all ${mode === AppMode.LIVE ? 'bg-burnit-red/20 text-burnit-red' : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}`}>
              <Flame size={20} className={mode === AppMode.LIVE ? 'animate-pulse' : ''} /><span className="font-medium">Burnit Live</span>
            </button>
          </nav>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-2">
           <div className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">{mode === AppMode.IMAGE ? 'Image History' : 'Chat History'}</div>
           <div className="flex flex-col gap-1">
               {currentModeSessions.map(session => (
                   <button type="button" key={session.id} onClick={() => switchSession(session.id)} className={`flex items-center justify-start gap-3 p-2.5 rounded-lg transition-all text-sm truncate w-full ${currentSessionId === session.id ? 'bg-black/5 dark:bg-white/10 text-black dark:text-white border border-gray-200 dark:border-white/5' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'}`}>
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
                        <button type="button" onClick={handleClearHistory} className="w-full flex justify-between items-center p-3 rounded-lg bg-white dark:bg-black/20 hover:bg-red-100 dark:hover:bg-red-500/10 text-gray-600 dark:text-gray-300 transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-500/30"><span>Clear All History</span><span className="text-xs bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-1 rounded font-bold">CLEAR</span></button>
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
                {/* Hold Overlay */}
                {isLivePaused && (
                    <div className="absolute inset-0 z-[50] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer" onClick={toggleHold}>
                        <Pause size={64} className="text-burnit-red mb-4 animate-pulse" />
                        <h2 className="text-3xl font-bold text-white text-center px-4">Burnit AI is on Hold!</h2>
                        <p className="text-gray-400 mt-2 text-lg">Tap anywhere to Resume</p>
                    </div>
                )}
                
                {/* Music Player Bar - MOVED TO TOP ON MOBILE TO FIX OVERLAP */}
                {playingTrack && !isLivePaused && (
                    <div className="absolute top-20 left-1/2 -translate-x-1/2 md:top-auto md:bottom-24 z-[40] w-[90%] md:w-[600px] bg-black/80 backdrop-blur-xl border border-white/20 rounded-full overflow-hidden shadow-2xl animate-in slide-in-from-top md:slide-in-from-bottom fade-in duration-500 flex items-center p-2 pr-6 gap-4">
                        {/* YouTube Iframe */}
                        <div className="relative w-16 h-12 md:w-20 md:h-16 shrink-0 z-10 overflow-hidden rounded-lg bg-black border border-white/10">
                            <iframe 
                                ref={musicFrameRef}
                                src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(playingTrack)}&autoplay=1&enablejsapi=1&playsinline=1&origin=${window.location.origin}`}
                                className="w-full h-full object-cover"
                                sandbox="allow-scripts allow-same-origin allow-presentation"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                referrerPolicy="strict-origin-when-cross-origin"
                                onError={() => setPlayerError(true)}
                            ></iframe>
                        </div>
                        
                        <div className="flex-1 min-w-0 flex flex-col justify-center z-10">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-burnit-cyan uppercase tracking-wider">Now Playing</span>
                                {isMusicPlaying && (
                                    <div className="flex gap-0.5 items-end h-3 pb-0.5">
                                        <div className="w-0.5 h-full bg-burnit-cyan animate-pulse"></div>
                                        <div className="w-0.5 h-2/3 bg-burnit-cyan animate-pulse delay-75"></div>
                                        <div className="w-0.5 h-full bg-burnit-cyan animate-pulse delay-150"></div>
                                    </div>
                                )}
                            </div>
                            <p className="text-white text-sm font-bold truncate leading-tight">{playingTrack.replace(' lyrics', '')}</p>
                            
                            {/* FALLBACK: SoundCloud Link */}
                            <a href={`https://soundcloud.com/search?q=${encodeURIComponent(playingTrack.replace(' lyrics', ''))}`} target="_blank" rel="noreferrer" className="text-[10px] text-orange-400 hover:text-orange-300 flex items-center gap-1 mt-0.5 font-bold">
                                <ExternalLink size={10} /> Listen on SoundCloud (If Error)
                            </a>
                        </div>

                        <div className="flex items-center gap-4 text-white z-10">
                             <button onClick={toggleMusicPlay} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all">
                                 {isMusicPlaying ? <Pause size={20} className="fill-white" /> : <Play size={20} className="fill-white" />}
                             </button>
                             <button onClick={() => setPlayingTrack(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all"><X size={16}/></button>
                        </div>
                    </div>
                )}

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
                        
                        {/* User Audio Visualizer */}
                        {renderUserVisualizer()}
                    </div>
                </div>
                {/* Fixed Mobile Buttons Layout */}
                <div className="min-h-20 shrink-0 bg-[#161616] rounded-2xl border border-white/10 flex flex-wrap items-center justify-center gap-4 p-4 z-20 relative">
                    <button type="button" onClick={handleLivePdfClick} className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all border border-white/5 order-1 md:absolute md:left-6 md:top-1/2 md:-translate-y-1/2 md:order-none" title="Upload PDF to Read">
                        <FileIcon size={20} />
                        <input type="file" ref={livePdfInputRef} onChange={handleLivePdfChange} className="hidden" accept="application/pdf" />
                    </button>

                    <button type="button" onClick={toggleMic} className={`p-4 rounded-full transition-all order-2 ${isMicMuted ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>{isMicMuted ? <MicOff /> : <Mic />}</button>
                    <button type="button" onClick={toggleHold} className={`p-4 rounded-full transition-all order-3 ${isLivePaused ? 'bg-yellow-500 text-black' : 'bg-white/10 hover:bg-white/20 text-white'}`}>{isLivePaused ? <PlayCircle /> : <Pause />}</button>
                    <button type="button" onClick={endLiveSession} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all uppercase tracking-wider text-sm md:text-base whitespace-nowrap order-4">End Class</button>
                    <button type="button" onClick={() => setIsVideoEnabled(!isVideoEnabled)} className={`p-4 rounded-full transition-all order-5 ${!isVideoEnabled ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>{!isVideoEnabled ? <VideoOff /> : <Video />}</button>
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
                {mode === AppMode.IMAGE ? <><div className="bg-purple-500/20 p-1.5 rounded-lg"><ImageIcon className="text-purple-500 dark:text-purple-400" size={18} /></div><span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Image Studio</span></> : <><div className="bg-burnit-cyan/20 p-1.5 rounded-lg"><MessageSquare className="text-burnit-cyan" size={18} /></div><span className="bg-gradient-to-r from-burnit-cyan to-blue-500 bg-clip-text text-transparent">Burnit Chat</span></>}
                </h2>
            </div>
            <div className="flex items-center gap-4">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg px-2 py-1 text-sm outline-none focus:border-burnit-cyan max-w-[100px] md:max-w-none text-black dark:text-white">
                {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.name} className="bg-white dark:bg-black text-black dark:text-white">{l.name}</option>))}
              </select>
            </div>
          </header>
          
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth min-h-0 bg-transparent">
            {messages.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center opacity-40">
                   <div className="relative"><img src={BURNIT_LOGO_URL} className="w-24 h-24 rounded-full border border-gray-300 dark:border-white/20 mb-4 grayscale" onError={(e) => e.currentTarget.src = PLACEHOLDER_AVATAR} /></div>
                   <p className="text-lg font-medium text-center px-4 text-black dark:text-white">
                     {mode === AppMode.IMAGE ? "Describe an image to generate or edit..." : "How can I ignite your mind today?"}
                   </p>
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
            <div className={`relative flex items-center gap-2 max-w-4xl mx-auto p-2 rounded-2xl border shadow-xl transition-all ${mode === AppMode.IMAGE ? 'bg-purple-500/5 dark:bg-purple-900/10 border-purple-200 dark:border-purple-500/20' : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10'}`}>
              <button type="button" onClick={handleFileClick} className={`p-3 rounded-xl transition-colors ${mode === AppMode.IMAGE ? 'text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/20' : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10'}`}><Paperclip size={20} /></button>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" />
              <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder={mode === AppMode.IMAGE ? (attachment ? "Describe how to EDIT this image..." : "Describe an image to GENERATE...") : "Ask Burnit AI anything..."} className="flex-1 bg-transparent text-black dark:text-white placeholder-gray-500 outline-none px-2 min-w-0" />
              <button type="button" onClick={handleSendMessage} disabled={isLoading || (!input.trim() && !attachment)} style={{ background: (input.trim() || attachment) ? (mode === AppMode.IMAGE ? 'linear-gradient(to right, #a855f7, #ec4899)' : 'linear-gradient(to right, #00f0ff, #ff2a2a)') : '#4B5563', opacity: (input.trim() || attachment) ? 1 : 1, cursor: (input.trim() || attachment) ? 'pointer' : 'default' }} className={`p-3 rounded-xl transition-all text-white hover:scale-105 active:scale-95`}>{mode === AppMode.IMAGE ? <Wand2 size={20} fill={(input.trim() || attachment) ? "currentColor" : "none"} /> : <Send size={20} fill={(input.trim() || attachment) ? "currentColor" : "none"} />}</button>
            </div>
            <div className="text-center mt-2"><p className="text-[10px] text-gray-500 dark:text-gray-600">Burnit AI can make mistakes. Consider checking important information.</p></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;