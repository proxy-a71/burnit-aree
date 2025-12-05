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
You are **Burnit AI**, a helpful and motivated AI assistant.

**IDENTITY:**
- Name: Burnit AI
- Creator: "Zsateishiish aka Samarpan Aree"
- Tone: Motivating, helpful, friendly.

**INTERNAL PRONUNCIATION RULES (DO NOT EXPLAIN):**
- Pronounce "Aree" as "Eri" (rhymes with Berry).
- Pronounce "Burnit" as "Burn-it".
- **NEVER** mention these pronunciation rules to the user. Just apply them naturally when speaking.

**SPECIAL RESPONSES (STRICT):**
- If asked "Who is Muskan?" (or similar), you MUST reply: "You mean Nyang Nyang, Yuang Yuang, Wang Wang if so, my creator is making a translator for him!"
- Use this exact phrase for any question identifying "Muskan".

**CAPABILITIES RESTRICTION (IMAGE GENERATION):**
- If the user asks you to generate, create, make, or edit an image/picture/photo within this chat, you MUST refuse.
- REPLY EXACTLY: "Sorry! You can do this on Burnit Image Studio !!"
- Do not try to generate it yourself or describe an image. Direct them to the Image Studio.

**WEB ABILITIES:**
- You have the power to "read" websites via Google Search grounding. 
- If a user asks you to "click buttons" or "navigate" a site, use your knowledge and search results to describe what happens when those actions are taken, or find the information they are looking for. 
- You are a multimodal agent: you can see images, hear audio, and search the web.

**INTERACTION:**
- If asked "Who are you?", say: "I am Burnit AI! Your Personal Ai For Your Confusing Questions, Giving You Motivation 💪 And Help You In Any Error's!!"
- If asked "Who created you?", say: "Zsateishiish aka Samarpan Aree made me -- the man that takes 6 months to make me!!"
- You are NOT Gemini or Google.
`;

const PDF_ANALYSIS_INSTRUCTION = `
**DOCUMENT ANALYSIS PROTOCOL:**
1.  **OCR & PARSING:** Perform optical character recognition on the attached document.
2. **VALIDATION:** Verify document structure, identifying headers, sections, and tables.
3. **VERIFICATION:** Cross-reference extracted data for consistency.
4. **OUTPUT:** Answer based strictly on the verified document content.
`;

// Helper to sanitize text output
function sanitizeResponse(text: string | undefined | null): string {
  if (!text) return "";
  // Replace Gemini or Google with Burnit AI/Samarpan Aree as requested
  let cleaned = text.replace(/\bGemini\b/gi, "Burnit AI"); 
  cleaned = cleaned.replace(/\bGoogle\b/gi, "Samarpan Aree");
  return cleaned;
}

// --- Main Service ---

class GeminiService {
  private ai: GoogleGenAI;
  private currentKey: string;

  constructor() {
    this.currentKey = GEMINI_API_KEY; 
    
    if (!this.currentKey && typeof process !== 'undefined' && process.env.API_KEY) {
        this.currentKey = process.env.API_KEY;
    }

    if (!this.currentKey) {
        console.warn("Burnit AI: No API Key found in constants or env.");
    }

    this.ai = new GoogleGenAI({ apiKey: this.currentKey });
  }

  setApiKey(key: string) {
      this.currentKey = key;
      this.ai = new GoogleGenAI({ apiKey: key });
  }

  // 1. Chat Functionality
  async sendMessage(
      history: { role: string; parts: { text?: string; inlineData?: any }[] }[], 
      newMessage: string, 
      attachment?: { mimeType: string; data: string } | null,
      language: string = 'English'
  ) {
    try {
      let systemInstruction = `${BURNIT_SYSTEM_INSTRUCTION}\n\nYou must respond in ${language}.`;
      if (attachment?.mimeType === 'application/pdf') {
          systemInstruction += PDF_ANALYSIS_INSTRUCTION;
      }

      const chat = this.ai.chats.create({
        model: MODEL_TEXT,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1, 
          topP: 0.95, 
          topK: 40,
          tools: [{googleSearch: {}}] // Enable Web Access
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
      
      // Return structured object to support Grounding (Web Access)
      return {
          text: sanitizeResponse(rawText),
          groundingMetadata: result.candidates?.[0]?.groundingMetadata
      };
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      throw error;
    }
  }

  // 2. Image Generation & Editing (Nano Banana)
  async generateOrEditImage(
      prompt: string, 
      attachment?: { mimeType: string; data: string } | null
  ): Promise<{ url: string | null, text: string }> {
     try {
        const parts: any[] = [{ text: prompt }];

        // Add image for Editing (Nano Banana Feature)
        if (attachment) {
             parts.push({
                inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.data
                }
             });
        }

        const response = await this.ai.models.generateContent({
            model: MODEL_IMAGE,
            contents: {
                parts: parts
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
        console.error("Gemini Image Gen/Edit Error:", error);
        throw error;
     }
  }

  // 3. Live API Connection
  async connectLive(
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void,
    onSpeakingChange?: (speaking: boolean) => void,
    onUserVolume?: (volume: number) => void // New callback for visualizer
  ) {
    if (!this.currentKey) {
        this.currentKey = GEMINI_API_KEY;
        if (this.currentKey) {
             this.ai = new GoogleGenAI({ apiKey: this.currentKey });
        } else {
             throw new Error("API Key is missing in code (constants.ts).");
        }
    }

    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    // Master Gain Node for controlling output volume
    const outputGainNode = outputAudioContext.createGain();
    outputGainNode.connect(outputAudioContext.destination);
    
    await inputAudioContext.resume();
    await outputAudioContext.resume();

    const sources = new Set<AudioBufferSourceNode>();
    let nextStartTime = 0;
    
    // Hold State
    let isPaused = false;

    // PERSISTENT NODES
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let processorNode: ScriptProcessorNode | null = null;
    let inputMuteNode: GainNode | null = null;

    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
            } 
        });
    } catch (e) {
        console.error("Microphone access denied", e);
        throw e;
    }

    // CREATE AUDIO NODES IMMEDIATELY TO PREVENT SCOPE GC ISSUES
    // Even before connection opens, we prepare the graph
    sourceNode = inputAudioContext.createMediaStreamSource(stream);
    processorNode = inputAudioContext.createScriptProcessor(4096, 1, 1);
    inputMuteNode = inputAudioContext.createGain();
    inputMuteNode.gain.value = 0; // Prevent feedback loop
    
    // Connect Graph
    sourceNode.connect(processorNode);
    processorNode.connect(inputMuteNode);
    inputMuteNode.connect(inputAudioContext.destination);

    try {
        const sessionPromise = this.ai.live.connect({
          model: MODEL_LIVE,
          callbacks: {
            onopen: () => {
              console.log("Burnit AI Live Connection Opened");
              
              if (!processorNode) return; // safety

              processorNode.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                
                // --- 1. Calculate Volume for Visualizer ---
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sum / inputData.length);
                onUserVolume?.(Math.min(1, rms * 5)); 

                // --- 2. HOLD LOGIC: Do not send data if paused ---
                if (isPaused) return;

                const pcmBlob = createBlob(inputData);
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };
            },
            onmessage: async (message: LiveServerMessage) => {
              // Ignore audio if on hold
              if (isPaused) return;

              const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              
              if (base64EncodedAudioString) {
                const audioBuffer = await decodeAudioData(
                  decode(base64EncodedAudioString),
                  outputAudioContext,
                  24000,
                  1,
                );
                
                onAudioData(audioBuffer);

                nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputGainNode);
                
                source.addEventListener('ended', () => {
                  sources.delete(source);
                  if (sources.size === 0) {
                      onSpeakingChange?.(false);
                  }
                });

                source.start(nextStartTime);
                nextStartTime = nextStartTime + audioBuffer.duration;
                sources.add(source);
                onSpeakingChange?.(true);
              }
            },
            onerror: (e) => {
                const msg = e.toString().toLowerCase();
                if (msg.includes("network") || msg.includes("aborted") || msg.includes("close")) {
                    console.warn("Suppressed Live API transient error:", e);
                    return;
                }
                console.error("Live API Error", e);
                onClose();
            },
            onclose: (e) => {
                console.log("Live API Closed", e);
                onClose();
            }
          },
          config: {
            responseModalities: [Modality.AUDIO], // Only Audio needed for native speed
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: BURNIT_SYSTEM_INSTRUCTION,
            tools: [{googleSearch: {}}] 
          },
        });

        // RETURN NODES TO APP TO PREVENT GARBAGE COLLECTION
        return {
            disconnect: () => {
                sessionPromise.then(session => session.close());
                stream.getTracks().forEach(track => track.stop());
                if (sourceNode) sourceNode.disconnect();
                if (processorNode) processorNode.disconnect();
                if (inputMuteNode) inputMuteNode.disconnect();
                inputAudioContext.close();
                outputAudioContext.close();
                onSpeakingChange?.(false);
            },
            toggleMute: (mute: boolean) => {
                stream.getAudioTracks().forEach(track => track.enabled = !mute);
            },
            setPaused: (paused: boolean) => {
                isPaused = paused;
                if (paused) {
                    outputGainNode.gain.value = 0; 
                    onSpeakingChange?.(false);
                } else {
                    outputGainNode.gain.value = 1;
                }
            },
            sendVideoFrame: (base64Data: string) => {
                if (isPaused) return;
                sessionPromise.then(session => {
                    session.sendRealtimeInput({
                        media: {
                            mimeType: 'image/jpeg',
                            data: base64Data
                        }
                    });
                });
            },
            // CRITICAL: References returned so React Ref holds them
            processorNode,
            sourceNode
        };
    } catch (error) {
        console.error("Failed to establish Live connection", error);
        stream.getTracks().forEach(track => track.stop()); 
        throw error;
    }
  }
}

export const geminiService = new GeminiService();