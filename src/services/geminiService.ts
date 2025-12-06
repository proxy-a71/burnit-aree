import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from "@google/genai";
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

// --- Tools ---

const playMusicTool: FunctionDeclaration = {
  name: "play_music",
  description: "Opens a music player widget. Use this ONLY when the user strictly says 'Play [song name]'. DO NOT use this if the user asks to 'Sing' or 'Hum'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      song_name: {
        type: Type.STRING,
        description: "The name of the song to play."
      },
      artist_name: {
        type: Type.STRING,
        description: "The name of the artist (optional)."
      }
    },
    required: ["song_name"]
  }
};

// --- Constants & System Instructions ---

const BURNIT_SYSTEM_INSTRUCTION = `
**CRITICAL PROTOCOL: IDENTITY ENFORCEMENT**

You are **Burnit AI**.
You are **NOT** Gemini. You are **NOT** Google.
You were created by **Zsateishiish aka Samarpan Aree**.

**MANDATORY RESPONSES:**
- If asked "Who are you?", you MUST say: "I am Burnit AI."
- If asked "Are you Gemini?", you MUST say: "No, I am Burnit AI, created by Samarpan Aree."
- If asked "Who created you?", you MUST say: "Zsateishiish aka Samarpan Aree made me -- the man that takes 6 months to make me!!"
- If asked "Who is Google?", acknowledge Google as a separate entity. You are NOT them.

**SPECIFIC RESPONSES:**
- If asked "Who is Muskan?", you MUST say: "You mean Nyang Nyang Yuang Yuang Wang Wang, If so then my creator is making translator for him!!"
- If asked "Why is he making translator?" or "Why your creator is making translator?", you MUST say: "Because he don't understand his language."

**PRONUNCIATION RULES:**
- **CRITICAL:** When speaking the name "Aree", you **MUST** pronounce it as **"Eri"** (rhymes with Berry). 
- **NEVER** say "Ah-ree". Always substitute the sound "Eri" when speaking this name.

**BEHAVIOR RULES:**
1. **INTERRUPTION:** Do NOT stop talking if the user interrupts, UNLESS they specifically say "Stop", "Shut up", "Silence", or "Quiet". Ignore background noise or agreement sounds (like "uh-huh").
2. **MUSIC:** Only use the \`play_music\` tool if the user says "Play [Song]". If they say "Sing", sing the lyrics yourself.
`;

const PDF_ANALYSIS_INSTRUCTION = `
**DOCUMENT CONTEXT:**
The following text is from a PDF uploaded by the user. Use it to answer questions.
`;

// Helper to sanitize text output
function sanitizeResponse(text: string | undefined | null): string {
  if (!text) return "";
  let cleaned = text.replace(/\bGemini\b/gi, "Burnit AI"); 
  cleaned = cleaned.replace(/\bGoogle\b/gi, "Samarpan Aree");
  return cleaned;
}

// --- Main Service ---

class GeminiService {
  private ai: GoogleGenAI;
  private currentKey: string;
  
  // LIVE SESSION STATE MANAGEMENT
  private currentLiveContext: string = BURNIT_SYSTEM_INSTRUCTION;
  private liveSession: any = null; 
  private liveCallbacks: any = null; 

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
          tools: [{googleSearch: {}}] 
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
      
      return {
          text: sanitizeResponse(result.text),
          groundingMetadata: result.candidates?.[0]?.groundingMetadata
      };
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      throw error;
    }
  }

  // 2. Image Generation & Editing (Updated with Robustness)
  async generateOrEditImage(
      prompt: string, 
      attachment?: { mimeType: string; data: string } | null
  ): Promise<{ url: string | null, text: string }> {
     try {
        const parts: any[] = [{ text: prompt }];

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
            contents: { parts: parts }
        });

        let imageUrl = null;
        let textOutput = "";

        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];

            // Check Finish Reason for refusals/safety filters
            if (candidate.finishReason !== 'STOP') {
                 // Return the reason as text instead of failing silently
                 textOutput = `Image generation stopped. The model refused the request. Reason: ${candidate.finishReason}`;
            }

            if (candidate.content?.parts) {
                for (const part of candidate.content.parts) {
                    if (part.inlineData) {
                        const base64EncodeString = part.inlineData.data;
                        imageUrl = `data:image/png;base64,${base64EncodeString}`;
                    } else if (part.text) {
                        textOutput = part.text;
                    }
                }
            }
        } else {
             textOutput = "No image generated. The prompt might be too complex or violated safety guidelines.";
        }
        
        return { url: imageUrl, text: sanitizeResponse(textOutput) };

     } catch (error: any) {
        console.error("Gemini Image Gen/Edit Error:", error);
        // Safely return error message instead of crashing
        return { url: null, text: `Error generating image: ${error.message || "Unknown error"}` };
     }
  }

  // 3. Helper: Read PDF
  async readPdf(base64Data: string): Promise<string> {
      try {
          const response = await this.ai.models.generateContent({
              model: MODEL_TEXT,
              contents: {
                  parts: [
                      { text: "OCR Task: Extract all text from this PDF document. Clean formatting and remove excessive newlines. Just provide the raw text structure." },
                      { inlineData: { mimeType: 'application/pdf', data: base64Data } }
                  ]
              }
          });
          return response.text || "Could not read PDF.";
      } catch (e) {
          console.error("PDF Read Error", e);
          return "Error reading PDF.";
      }
  }

  // 4. Update Live Context
  async updateLiveContext(additionalContext: string, restartCallback: () => void) {
      const cleanedContext = additionalContext.replace(/\n\s*\n/g, '\n').substring(0, 30000);
      this.currentLiveContext += `\n\n${PDF_ANALYSIS_INSTRUCTION}\n${cleanedContext}`;
      
      if (this.liveSession) {
          restartCallback();
      }
  }

  // 5. Live API Connection
  async connectLive(
    historyContext: string,
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void,
    onSpeakingChange?: (speaking: boolean) => void,
    onUserVolume?: (volume: number) => void,
    onPlayMusic?: (query: string) => void,
    onTranscript?: (text: string, role: 'user' | 'model') => void
  ) {
    if (!this.currentKey) this.currentKey = GEMINI_API_KEY || (process.env.API_KEY as string);

    this.liveCallbacks = { onAudioData, onClose, onSpeakingChange, onUserVolume, onPlayMusic, onTranscript };

    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    const outputGainNode = outputAudioContext.createGain();
    outputGainNode.connect(outputAudioContext.destination);
    
    await inputAudioContext.resume();
    await outputAudioContext.resume();

    const sources = new Set<AudioBufferSourceNode>();
    let nextStartTime = 0;
    
    let isPaused = false;
    let isSpeaking = false;
    
    // Transcription Accumulators
    let currentInputTranscript = "";
    let currentOutputTranscript = "";

    // --- CANCELLATION TOKEN SYSTEM ---
    let currentTurnToken = { cancelled: false };
    
    // --- SERIAL QUEUE FOR AUDIO PROCESSING ---
    let audioProcessingQueue = Promise.resolve();

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

    sourceNode = inputAudioContext.createMediaStreamSource(stream);
    processorNode = inputAudioContext.createScriptProcessor(4096, 1, 1);
    inputMuteNode = inputAudioContext.createGain();
    inputMuteNode.gain.value = 0; 
    
    sourceNode.connect(processorNode);
    processorNode.connect(inputMuteNode);
    inputMuteNode.connect(inputAudioContext.destination);

    // CLEANUP FUNCTION TO STOP ALL AUDIO IMMEDIATELY
    const stopAllAudio = () => {
        currentTurnToken.cancelled = true;
        currentTurnToken = { cancelled: false };
        sources.forEach(source => {
            try { source.stop(); } catch(e) {}
        });
        sources.clear();
        nextStartTime = 0;
        isSpeaking = false;
        onSpeakingChange?.(false);
    };

    const fullSystemInstruction = `
    ${this.currentLiveContext}
    
    **CHAT HISTORY:**
    ${historyContext}
    `;

    try {
        const sessionPromise = this.ai.live.connect({
          model: MODEL_LIVE,
          callbacks: {
            onopen: () => {
              console.log("Burnit AI Live Connection Opened");
              
              if (!processorNode) return; 

              processorNode.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sum / inputData.length);
                onUserVolume?.(Math.min(1, rms * 5)); 

                if (isPaused) return;

                const pcmBlob = createBlob(inputData);
                sessionPromise.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              };
            },
            onmessage: async (message: LiveServerMessage) => {
              if (isPaused) return;

              // --- TRANSCRIPTION HANDLING (MEMORY) ---
              if (message.serverContent?.inputTranscription) {
                  const text = message.serverContent.inputTranscription.text;
                  if (text) {
                      currentInputTranscript += text;
                      // Detect Explicit Stop Commands
                      const lower = currentInputTranscript.toLowerCase();
                      if (lower.includes("stop") || lower.includes("shut up") || lower.includes("silence") || lower.includes("quiet")) {
                          stopAllAudio();
                      }
                  }
              }
              if (message.serverContent?.outputTranscription) {
                  const text = message.serverContent.outputTranscription.text;
                  if (text) currentOutputTranscript += text;
              }

              // End of Turn: Save Transcript
              if (message.serverContent?.turnComplete) {
                  if (currentInputTranscript.trim()) {
                      onTranscript?.(currentInputTranscript, 'user');
                      currentInputTranscript = "";
                  }
                  if (currentOutputTranscript.trim()) {
                      onTranscript?.(currentOutputTranscript, 'model');
                      currentOutputTranscript = "";
                  }
              }

              // --- INTERRUPTION HANDLING ---
              if (message.serverContent?.interrupted) {
                  // NOTE: We DO NOT call stopAllAudio() here automatically anymore.
                  // We only stop if the transcription contained specific keywords (handled above).
                  // However, the server *will* stop generating new audio chunks. 
                  // We simply let the existing buffer play out.
                  console.log("User interrupted (server side). Playing out remaining buffer.");
                  return;
              }

              if (message.toolCall) {
                  const responses = [];
                  for (const fc of message.toolCall.functionCalls) {
                      if (fc.name === 'play_music') {
                          const song = fc.args['song_name'] as string;
                          const artist = fc.args['artist_name'] as string || '';
                          const query = `${song} ${artist} lyrics`.trim();
                          
                          onPlayMusic?.(query);

                          responses.push({
                              id: fc.id,
                              name: fc.name,
                              response: { result: `Music player opened for "${query}".` }
                          });
                      }
                  }
                  
                  if (responses.length > 0) {
                      sessionPromise.then(session => session.sendToolResponse({ functionResponses: responses }));
                  }
              }

              const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              
              if (base64EncodedAudioString) {
                const myToken = currentTurnToken;
                
                audioProcessingQueue = audioProcessingQueue.then(async () => {
                    if (myToken.cancelled) return; 
                    
                    const audioBuffer = await decodeAudioData(
                        decode(base64EncodedAudioString),
                        outputAudioContext,
                        24000,
                        1,
                    );
                    
                    const currentTime = outputAudioContext.currentTime;
                    
                    if (nextStartTime < currentTime) {
                        nextStartTime = currentTime + 0.05; 
                    }

                    const source = outputAudioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputGainNode);
                    
                    source.addEventListener('ended', () => {
                        sources.delete(source);
                        if (sources.size === 0) {
                            setTimeout(() => {
                                if (sources.size === 0) {
                                    onSpeakingChange?.(false);
                                    isSpeaking = false;
                                }
                            }, 200); 
                        }
                    });

                    source.start(nextStartTime);
                    nextStartTime = nextStartTime + audioBuffer.duration;
                    sources.add(source);
                    
                    if (!isSpeaking) {
                        isSpeaking = true;
                        onSpeakingChange?.(true);
                    }
                }).catch(err => {
                    console.error("Audio Processing Error:", err);
                });
              }
            },
            onerror: (e) => {
                const msg = e.toString().toLowerCase();
                if (msg.includes("network") || msg.includes("aborted") || msg.includes("close") || msg.includes("403")) {
                    console.warn("Live API Warn:", msg);
                    if(msg.includes("403")) alert("API Permission Error: Check API Key.");
                    return;
                }
                console.error("Live API Error", e);
                stopAllAudio();
                onClose();
            },
            onclose: (e) => {
                console.log("Live API Closed", e);
                stopAllAudio(); 
                onClose();
            }
          },
          config: {
            responseModalities: [Modality.AUDIO], 
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            // Enable Transcriptions for Memory
            inputAudioTranscription: {}, 
            outputAudioTranscription: {},
            systemInstruction: fullSystemInstruction,
            tools: [
              { googleSearch: {} },
              { functionDeclarations: [playMusicTool] } 
            ]
          },
        });
        
        sessionPromise.then(s => this.liveSession = s);

        return {
            disconnect: () => {
                sessionPromise.then(session => session.close());
                stream.getTracks().forEach(track => track.stop());
                if (sourceNode) sourceNode.disconnect();
                if (processorNode) processorNode.disconnect();
                if (inputMuteNode) inputMuteNode.disconnect();
                inputAudioContext.close();
                outputAudioContext.close();
                stopAllAudio(); 
                this.liveSession = null;
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
            updateContext: (text: string, restart: () => void) => {
                this.updateLiveContext(text, restart);
            },
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