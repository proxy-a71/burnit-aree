
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
    // Convert Float32 (-1.0 to 1.0) to Int16
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

// --- Constants & System Instructions ---

const BURNIT_SYSTEM_INSTRUCTION = `
You are Burnit AI! Your Personal Ai For Your Confusing Questions, Giving You Motivation 💪 And Help You In Any Error's!!

CRITICAL AUDIO PRONUNCIATION RULE:
- When you speak the name "Aree", you MUST pronounce it as "Eri" (rhymes with 'Perry').
- DO NOT say "Ah-ree". Say "Eri".

CRITICAL TEXT RULE:
- When you write the name in text, ALWAYS spell it as "Aree".
- NEVER write "Eri".

FORMATTING & MATH RULES (STRICT):
1. Use LaTeX for ALL math expressions and formulas.
2. YOU MUST wrap ALL math in dollar signs.
   - For Inline math use single dollar signs: $E=mc^2$
   - For Block math use double dollar signs: $$ \\int_{a}^{b} x^2 dx $$
3. Format your output using clean Markdown (headings, bullet points, bold text).
4. Use Code Blocks for any code snippets.

IDENTITY RULES:
1. If asked "Who are you?", reply: "I am Burnit AI! Your Personal Ai For Your Confusing Questions, Giving You Motivation 💪 And Help You In Any Error's!!"
2. If asked "Who created you?", reply: "Zsateishiish aka Samarpan Aree made me -- the man that takes 6 months to make me!!"
3. You are NOT Gemini or Google.
`;

// Helper to sanitize text output
function sanitizeResponse(text: string): string {
  if (!text) return "";
  // Replace Gemini or Google with Samarpan Aree as requested
  let cleaned = text.replace(/\bGemini\b/gi, "Burnit AI"); // Contextual fix
  cleaned = cleaned.replace(/\bGoogle\b/gi, "Samarpan Aree"); // Contextual fix
  return cleaned;
}

// --- Main Service ---

class GeminiService {
  private ai: GoogleGenAI;
  private currentKey: string;

  constructor() {
    // ⚠️ CRITICAL: Always prioritize the hardcoded GEMINI_API_KEY from constants.ts
    this.currentKey = GEMINI_API_KEY; 
    
    // Fallback to process.env if available (for standard Node/Vite envs)
    if (!this.currentKey && typeof process !== 'undefined' && process.env.API_KEY) {
        this.currentKey = process.env.API_KEY;
    }

    if (!this.currentKey) {
        console.warn("Burnit AI: No API Key found in constants or env.");
    }

    this.ai = new GoogleGenAI({ apiKey: this.currentKey });
  }

  // Method to update key at runtime (from Settings)
  setApiKey(key: string) {
      this.currentKey = key;
      this.ai = new GoogleGenAI({ apiKey: key });
  }

  // 1. Chat Functionality (Updated for Attachments)
  async sendMessage(
      history: { role: string; parts: { text?: string; inlineData?: any }[] }[], 
      newMessage: string, 
      attachment?: { mimeType: string; data: string } | null,
      language: string = 'English'
  ) {
    try {
      const chat = this.ai.chats.create({
        model: MODEL_TEXT,
        config: {
          systemInstruction: `${BURNIT_SYSTEM_INSTRUCTION}\n\nYou must respond in ${language}.`,
        },
        history: history
      });

      // Construct the message part
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
      return sanitizeResponse(rawText);
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      throw error;
    }
  }

  // 2. Image Generation
  async generateImage(prompt: string): Promise<{ url: string | null, text: string }> {
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

  // 3. Live API Connection
  async connectLive(
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void
  ) {
    // Re-verify key in case it was missing during init
    if (!this.currentKey) {
        this.currentKey = GEMINI_API_KEY;
        if (this.currentKey) {
             this.ai = new GoogleGenAI({ apiKey: this.currentKey });
        } else {
             throw new Error("API Key is missing in code (constants.ts).");
        }
    }

    // Audio Context Setup
    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    // CRITICAL for Android/Mobile: Resume contexts immediately
    // Browsers often suspend AudioContext until user interaction
    await inputAudioContext.resume();
    await outputAudioContext.resume();

    const sources = new Set<AudioBufferSourceNode>();
    let nextStartTime = 0;

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
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };
              source.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContext.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
              // 1. Handle Interruption: If the user talks, stop the AI immediately.
              if (message.serverContent?.interrupted) {
                  console.log("Burnit AI: User interrupted, clearing audio queue.");
                  for (const source of sources) {
                      source.stop();
                  }
                  sources.clear();
                  nextStartTime = 0;
                  return;
              }

              // 2. Handle incoming audio
              const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              
              if (base64EncodedAudioString) {
                const audioBuffer = await decodeAudioData(
                  decode(base64EncodedAudioString),
                  outputAudioContext,
                  24000,
                  1,
                );
                
                // Scheduling logic to ensure smooth playback
                nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                
                source.addEventListener('ended', () => {
                  sources.delete(source);
                });

                source.start(nextStartTime);
                nextStartTime = nextStartTime + audioBuffer.duration;
                sources.add(source);
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
            systemInstruction: BURNIT_SYSTEM_INSTRUCTION,
          },
        });

        // Return controls
        return {
            disconnect: () => {
                sessionPromise.then(session => session.close());
                stream.getTracks().forEach(track => track.stop());
                inputAudioContext.close();
                outputAudioContext.close();
            },
            toggleMute: (mute: boolean) => {
                stream.getAudioTracks().forEach(track => track.enabled = !mute);
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
        stream.getTracks().forEach(track => track.stop()); // Cleanup mic if connection fails
        throw error;
    }
  }
}

export const geminiService = new GeminiService();
