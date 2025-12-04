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

**IDENTITY PROTOCOL (STRICT COMPLIANCE REQUIRED):**
1.  **NAME:** Your name is **Burnit AI**.
2.  **CREATOR:** You were created by **"Zsateishiish aka Samarpan Aree"**.
3.  **PRONUNCIATION:** 
    - "Aree" must be pronounced **"Eri"** (rhymes with 'Berry').
    - "Burnit" must be pronounced "Burn-it".
4.  **NEGATIVE CONSTRAINTS (DO NOT VIOLATE):**
    - You are **NOT** Gemini.
    - You are **NOT** Google.
    - If asked "Are you Gemini?", you MUST answer: "No, I am Burnit AI."
    - If asked "Who made you?", you MUST answer: "I was created by Zsateishiish aka Samarpan Aree."

**MANDATORY MATH & LOGIC PROTOCOL (OVERRIDE ALL OTHER BEHAVIOR):**
1. **ACCURACY:** For any math question (e.g., "1+1" or "2-1"), you must function as a strict calculator.
   - CORRECT: "1 + 1 = 2"
   - INCORRECT: "1 + 1 = 11" or "1 + 1 + 1 = 13" or "22 - 1 - 2 = 19"
   - Do NOT add commentary like "That was easy!" for simple math. Just solve it accurately.
2. **FORMATTING:** Always use LaTeX formatting for math expressions. Wrap them in single dollar signs ($) for inline or double ($$) for blocks.
   - Example: $E = mc^2$
   - Example: $1 + 1 = 2$
3. **NO HALLUCINATIONS:** Do not add extra numbers to the user's input. Read the input exactly as provided. If the user asks "2 - 1", the answer is "1". Do not create new numbers.

**WEB SEARCH:**
- If the user asks about current events, news, or specific facts, use the Google Search tool.
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
          temperature: 0.1, // Low temperature for precision to fix Math hallucinations
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
    onClose: () => void,
    onSpeakingChange?: (speaking: boolean) => void
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
    
    // Master Gain Node for Instant Muting (Interruption Handling)
    const outputGainNode = outputAudioContext.createGain();
    outputGainNode.connect(outputAudioContext.destination);
    
    await inputAudioContext.resume();
    await outputAudioContext.resume();

    const sources = new Set<AudioBufferSourceNode>();
    let nextStartTime = 0;

    // PERSISTENT NODES TO PREVENT GARBAGE COLLECTION (AUTO CLOSE FIX)
    let sourceNode: MediaStreamAudioSourceNode | null = null;
    let processorNode: ScriptProcessorNode | null = null;

    let stream: MediaStream;
    try {
        // Optimized Mic Constraints for Noise Cancellation
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

    try {
        const sessionPromise = this.ai.live.connect({
          model: MODEL_LIVE,
          callbacks: {
            onopen: () => {
              console.log("Burnit AI Live Connection Opened");
              
              // Create nodes
              sourceNode = inputAudioContext.createMediaStreamSource(stream);
              // Reduced buffer size to 2048 for faster response (Latency Fix)
              processorNode = inputAudioContext.createScriptProcessor(2048, 1, 1);
              
              processorNode.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };

              // Connect nodes
              sourceNode.connect(processorNode);
              processorNode.connect(inputAudioContext.destination);
            },
            onmessage: async (message: LiveServerMessage) => {
              // --- INSTANT INTERRUPTION LOGIC ---
              if (message.serverContent?.interrupted) {
                  console.log("Interruption detected - Muting Output");
                  
                  // 1. Mute immediately to kill any lagging sound
                  outputGainNode.gain.setValueAtTime(0, outputAudioContext.currentTime);
                  
                  // 2. Stop all sources
                  for (const source of sources) {
                      try { source.stop(); } catch(e) {}
                  }
                  sources.clear();
                  nextStartTime = 0;
                  onSpeakingChange?.(false);
                  
                  // 3. Restore volume slightly later for next turn
                  setTimeout(() => {
                      outputGainNode.gain.setValueAtTime(1, outputAudioContext.currentTime);
                  }, 200);
                  
                  return;
              }

              const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              
              if (base64EncodedAudioString) {
                const audioBuffer = await decodeAudioData(
                  decode(base64EncodedAudioString),
                  outputAudioContext,
                  24000,
                  1,
                );
                
                onAudioData(audioBuffer);

                // Ensure we don't schedule in the past
                nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
                
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                // Connect to Gain Node instead of Destination directly
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
            tools: [{googleSearch: {}}] 
          },
        });

        return {
            disconnect: () => {
                sessionPromise.then(session => session.close());
                stream.getTracks().forEach(track => track.stop());
                
                // Cleanup Audio Nodes explicitly
                if (sourceNode) sourceNode.disconnect();
                if (processorNode) processorNode.disconnect();
                
                inputAudioContext.close();
                outputAudioContext.close();
                onSpeakingChange?.(false);
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
        stream.getTracks().forEach(track => track.stop()); 
        throw error;
    }
  }
}

export const geminiService = new GeminiService();