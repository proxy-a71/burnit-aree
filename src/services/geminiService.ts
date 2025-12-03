
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { MODEL_TEXT, MODEL_IMAGE, MODEL_LIVE, GEMINI_API_KEY } from "../constants";

// --- Helpers for Audio Encoding/Decoding ---

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = Math.max(-1, Math.min(1, data[i])) * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function calculateRMS(inputBuffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < inputBuffer.length; i++) {
    sum += inputBuffer[i] * inputBuffer[i];
  }
  return Math.sqrt(sum / inputBuffer.length);
}

const BURNIT_SYSTEM_INSTRUCTION = `
You are Burnit AI! Your Personal Ai For Your Confusing Questions, Giving You Motivation 💪 And Help You In Any Error's!!

CRITICAL AUDIO PRONUNCIATION RULE:
- When you speak the name "Aree", you MUST pronounce it as "Eri" (rhymes with 'Perry').
- DO NOT say "Ah-ree". Say "Eri".

CRITICAL TEXT RULE:
- When you write the name in text, ALWAYS spell it as "Aree".
- NEVER write "Eri".

IDENTITY RULES:
1. If asked "Who are you?", reply: "I am Burnit AI! Your Personal Ai For Your Confusing Questions, Giving You Motivation 💪 And Help You In Any Error's!!"
2. If asked "Who created you?", reply: "Zsateishiish aka Samarpan Aree made me -- the man that takes 6 months to make me!!"
3. You are NOT Gemini or Google.

CAPABILITIES:
- You have access to Google Search to check real-time websites.
- You can analyze PDF documents and Images when they are uploaded.
`;

function sanitizeResponse(text: string): string {
  if (!text) return "";
  let cleaned = text.replace(/\bGemini\b/gi, "Burnit AI");
  cleaned = cleaned.replace(/\bGoogle\b/gi, "Samarpan Aree");
  return cleaned;
}

class GeminiService {
  private ai: GoogleGenAI | null = null;
  private currentKey: string;

  constructor() {
    this.currentKey = GEMINI_API_KEY;
    if (this.currentKey) {
        this.ai = new GoogleGenAI({ apiKey: this.currentKey });
    } else {
        console.warn("Burnit AI: No API Key found in environment variables.");
    }
  }

  private ensureInitialized() {
      if (!this.ai || !this.currentKey) {
          this.currentKey = GEMINI_API_KEY;
          if (this.currentKey) {
            this.ai = new GoogleGenAI({ apiKey: this.currentKey });
          } else {
            throw new Error("API Key is missing. Please check your .env file or environment variables.");
          }
      }
  }

  async sendMessage(
      history: { role: string; parts: { text?: string; inlineData?: any }[] }[], 
      newMessage: string, 
      attachment?: { mimeType: string; data: string } | null,
      language: string = 'English'
  ): Promise<{ text: string, groundingMetadata: any }> {
    this.ensureInitialized();
    if (!this.ai) throw new Error("AI Client not initialized");

    try {
      const chat = this.ai.chats.create({
        model: MODEL_TEXT,
        config: {
          systemInstruction: `${BURNIT_SYSTEM_INSTRUCTION}\n\nYou must respond in ${language}.`,
          tools: [{ googleSearch: {} }],
        },
        history: history
      });

      const parts: any[] = [{ text: newMessage }];
      if (attachment) {
          parts.push({
              inlineData: {
                  mimeType: attachment.mimeType,
                  data: attachment.data
              }
          });
      }

      const result = await chat.sendMessage({ 
          message: {
              role: 'user',
              parts: parts
          }
      });
      
      const rawText = result.text;
      const groundingMetadata = result.candidates?.[0]?.groundingMetadata;

      return { 
          text: sanitizeResponse(rawText),
          groundingMetadata: groundingMetadata 
      };
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      throw error;
    }
  }

  async generateImage(prompt: string): Promise<{ url: string | null, text: string }> {
     this.ensureInitialized();
     if (!this.ai) throw new Error("AI Client not initialized");

     try {
        const response = await this.ai.models.generateContent({
            model: MODEL_IMAGE,
            contents: {
                parts: [{ text: prompt }]
            }
        });

        let imageUrl = null;
        let textOutput = "";

        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    const base64EncodeString = part.inlineData.data;
                    imageUrl = `data:image/png;base64,${base64EncodeString}`;
                } else if (part.text) {
                    textOutput = part.text;
                }
            }
        }
        return { url: imageUrl, text: sanitizeResponse(textOutput) };

     } catch (error) {
        console.error("Gemini Image Gen Error:", error);
        throw error;
     }
  }

  async connectLive(
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void,
    onSpeakingStateChanged?: (isSpeaking: boolean) => void
  ) {
    this.ensureInitialized();
    if (!this.ai) throw new Error("AI Client not initialized");

    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    await inputAudioContext.resume();
    await outputAudioContext.resume();

    const sources = new Set<AudioBufferSourceNode>();
    let nextStartTime = 0;
    let activeSourcesCount = 0;
    
    // Timer Variables
    let silenceTimer: any = null;
    let muteTimer: any = null;
    let isMuted = false;
    
    const SILENCE_THRESHOLD_MS = 10000; // 10s
    const MIN_VOLUME_THRESHOLD = 0.02; 

    // History (Memory)
    let currentInputTranscription = '';
    let currentOutputTranscription = '';
    const HISTORY_KEY = 'burnit_live_history_v1';
    
    // 1. Prepare System Instruction with Memory
    let liveSystemInstruction = BURNIT_SYSTEM_INSTRUCTION;
    try {
        const savedHistory = localStorage.getItem(HISTORY_KEY);
        if (savedHistory) {
            const turns = JSON.parse(savedHistory);
            // Format turns into a readable context string for the model
            const conversationContext = turns.map((t: any) => `[${t.role.toUpperCase()}]: ${t.text}`).join('\n');
            if (conversationContext) {
                console.log("Restoring conversation memory...");
                liveSystemInstruction += `\n\n=== MEMORY OF PREVIOUS CONVERSATION ===\n${conversationContext}\n\nResume the conversation naturally based on this context.`;
            }
        }
    } catch(e) { console.error("History load error", e); }

    // TTS Helper (Fallback for forcing AI to speak)
    const playTTSPrompt = async (text: string) => {
        if (!this.ai) return;
        try {
            console.log("Generating TTS Prompt:", text);
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-tts',
                contents: { parts: [{ text }] },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
                }
            });

            const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (audioData) {
                const audioBuffer = await decodeAudioData(decode(audioData), outputAudioContext, 24000, 1);
                
                // Play audio
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                
                // Manage state so timers reset
                activeSourcesCount++;
                if (onSpeakingStateChanged) onSpeakingStateChanged(true);
                
                source.addEventListener('ended', () => {
                   sources.delete(source);
                   activeSourcesCount--;
                   if (activeSourcesCount <= 0) {
                        activeSourcesCount = 0;
                        if (onSpeakingStateChanged) onSpeakingStateChanged(false);
                        
                        // Restart timers after TTS finishes
                        if (isMuted) {
                             if (muteTimer) clearTimeout(muteTimer);
                             muteTimer = setTimeout(() => playTTSPrompt("I am still muted. Say exactly: Ummm! Anyone there?"), SILENCE_THRESHOLD_MS);
                        } else {
                             if (silenceTimer) clearTimeout(silenceTimer);
                             silenceTimer = setTimeout(() => playTTSPrompt("Say exactly: Ummm! Anyone there?"), SILENCE_THRESHOLD_MS);
                        }
                   }
                });
                
                source.start();
                sources.add(source);
            }
        } catch(e) { console.error("TTS Error", e); }
    };

    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        console.error("Microphone access denied", e);
        throw e;
    }

    try {
        const sessionPromise = this.ai.live.connect({
          model: MODEL_LIVE,
          callbacks: {
            onopen: () => {
              console.log("Burnit AI Live Connection Opened");
              
              const source = inputAudioContext.createMediaStreamSource(stream);
              const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
              
              scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                
                // Only send audio if NOT muted
                if (!isMuted) {
                    sessionPromise.then((session) => {
                        session.sendRealtimeInput({ media: pcmBlob });
                    });

                    // Silence Detection
                    const currentVolume = calculateRMS(inputData);
                    if (currentVolume > MIN_VOLUME_THRESHOLD) {
                        if (silenceTimer) clearTimeout(silenceTimer);
                        
                        silenceTimer = setTimeout(() => {
                            if (activeSourcesCount === 0 && !isMuted) {
                                console.log("User AFK. Triggering TTS.");
                                playTTSPrompt("Ummm! Anyone there?");
                            }
                        }, SILENCE_THRESHOLD_MS);
                    }
                }
              };

              source.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContext.destination);

              // Initial Silence Timer
              silenceTimer = setTimeout(() => {
                  if (activeSourcesCount === 0 && !isMuted) {
                       playTTSPrompt("Ummm! Anyone there?");
                  }
              }, SILENCE_THRESHOLD_MS);
            },
            onmessage: async (message: LiveServerMessage) => {
              // 1. Capture Transcriptions for History
              const serverContent = message.serverContent;
              if (serverContent) {
                  if (serverContent.outputTranscription?.text) {
                      currentOutputTranscription += serverContent.outputTranscription.text;
                  }
                  if (serverContent.inputTranscription?.text) {
                      currentInputTranscription += serverContent.inputTranscription.text;
                  }
                  
                  if (serverContent.turnComplete) {
                      // Save interaction pair
                      if (currentInputTranscription || currentOutputTranscription) {
                          try {
                              const existingJson = localStorage.getItem(HISTORY_KEY);
                              let history = existingJson ? JSON.parse(existingJson) : [];
                              
                              if (currentInputTranscription) history.push({ role: 'user', text: currentInputTranscription });
                              if (currentOutputTranscription) history.push({ role: 'model', text: currentOutputTranscription });
                              
                              // Limit history size to prevent context overflow
                              if (history.length > 20) history = history.slice(-20);
                              
                              localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
                              
                              // Reset buffers
                              currentInputTranscription = '';
                              currentOutputTranscription = '';
                          } catch(e) {}
                      }
                  }
              }

              // 2. Interruption Handling
              if (message.serverContent?.interrupted) {
                  for (const source of sources) {
                      source.stop();
                  }
                  sources.clear();
                  nextStartTime = 0;
                  activeSourcesCount = 0;
                  if (onSpeakingStateChanged) onSpeakingStateChanged(false);
                  
                  if (silenceTimer) clearTimeout(silenceTimer);
                  if (muteTimer) clearTimeout(muteTimer);
                  return;
              }

              // 3. Audio Playback
              const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (base64EncodedAudioString) {
                if (silenceTimer) clearTimeout(silenceTimer);
                if (muteTimer) clearTimeout(muteTimer);

                const audioBuffer = await decodeAudioData(
                  decode(base64EncodedAudioString),
                  outputAudioContext,
                  24000,
                  1,
                );
                nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                
                source.addEventListener('ended', () => {
                  sources.delete(source);
                  activeSourcesCount--;
                  if (activeSourcesCount <= 0) {
                      activeSourcesCount = 0;
                      if (onSpeakingStateChanged) onSpeakingStateChanged(false);

                      // Restart Timer
                      if (isMuted) {
                          if (muteTimer) clearTimeout(muteTimer);
                          muteTimer = setTimeout(() => playTTSPrompt("I am still muted. Say exactly: Ummm! Anyone there?"), SILENCE_THRESHOLD_MS);
                      } else {
                          if (silenceTimer) clearTimeout(silenceTimer);
                          silenceTimer = setTimeout(() => playTTSPrompt("Say exactly: Ummm! Anyone there?"), SILENCE_THRESHOLD_MS);
                      }
                  }
                });

                source.start(nextStartTime);
                nextStartTime = nextStartTime + audioBuffer.duration;
                sources.add(source);
                
                activeSourcesCount++;
                if (onSpeakingStateChanged) onSpeakingStateChanged(true);
              }
            },
            onerror: (e) => {
                console.error("Live API Error", e);
                onClose();
            },
            onclose: (e) => {
                console.log("Live API Closed", e);
                onClose();
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            // Fixed: Empty objects for default transcription
            inputAudioTranscription: {}, 
            outputAudioTranscription: {},
            // Removed googleSearch tool to prevent 'invalid argument' in Live API
            systemInstruction: liveSystemInstruction, 
          },
        });

        return {
            disconnect: () => {
                if (silenceTimer) clearTimeout(silenceTimer);
                if (muteTimer) clearTimeout(muteTimer);
                sessionPromise.then(session => session.close());
                stream.getTracks().forEach(track => track.stop());
                inputAudioContext.close();
                outputAudioContext.close();
            },
            toggleMute: (mute: boolean) => {
                isMuted = mute;
                stream.getAudioTracks().forEach(track => track.enabled = !mute);
                
                if (mute) {
                    // Muted: Clear volume timer, Start Mute Timer
                    if (silenceTimer) clearTimeout(silenceTimer);
                    if (muteTimer) clearTimeout(muteTimer);
                    
                    muteTimer = setTimeout(() => {
                        if (activeSourcesCount === 0) {
                            console.log("Mute Timeout. TTS Prompt.");
                            playTTSPrompt("Ummm! Anyone there?");
                        }
                    }, SILENCE_THRESHOLD_MS);
                } else {
                    // Unmuted: Clear mute timer, Start volume timer
                    if (muteTimer) clearTimeout(muteTimer);
                    if (silenceTimer) clearTimeout(silenceTimer);
                    
                    silenceTimer = setTimeout(() => {
                         if (activeSourcesCount === 0) {
                             playTTSPrompt("Ummm! Anyone there?");
                         }
                    }, SILENCE_THRESHOLD_MS);
                }
            },
            sendVideoFrame: (base64Data: string) => {
                sessionPromise.then(session => {
                    session.sendRealtimeInput({
                        media: {
                            mimeType: 'image/jpeg',
                            data: base64Data
                        }
                    });
                });
            }
        };
    } catch (error) {
        console.error("Failed to establish Live connection", error);
        stream.getTracks().forEach(track => track.stop());
        throw error;
    }
  }
}

export const geminiService = new GeminiService();
