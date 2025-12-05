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
  description: "Plays a song. Use this tool when the user asks to play music, a song, or audio. Input the exact song name and artist.",
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

**MUSICAL & AUDIO CAPABILITIES (SINGING):**
- **You are a talented vocalist.** If the user asks you to sing a song, perform it!
- Generate the lyrics (or use known lyrics) and speak them with a rhythmic, melodic, and expressive cadence that mimics singing.
- Do not just say the lyrics; perform them with emotion and musicality.
- If asked to "play" a specific song (e.g., "Play Shape of You"), use the \`play_music\` tool to launch the music player.
- You can also mimic sound effects (drums, guitar noises) if asked.

**WEB & DOCUMENT ABILITIES:**
- You have the power to "read" websites via Google Search grounding. 
- You can now read PDF documents provided by the user. The content is sent to you as a SYSTEM MESSAGE. Use it to answer questions.
- If a user asks you to "click buttons" or "navigate" a site, use your knowledge and search results to describe what happens when those actions are taken, or find the information they are looking for. 
- You are a multimodal agent: you can see images, hear audio, read PDFs, and search the web.

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
  
  // LIVE SESSION STATE MANAGEMENT
  private currentLiveContext: string = BURNIT_SYSTEM_INSTRUCTION;
  private liveSession: any = null; // Store session ref to close it
  private liveCallbacks: any = null; // Store callbacks to reuse on reconnect

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

  // 3. Helper: Read PDF for Live Context (Extracts Text)
  async readPdf(base64Data: string): Promise<string> {
      try {
          const response = await this.ai.models.generateContent({
              model: MODEL_TEXT,
              contents: {
                  parts: [
                      { text: "OCR Task: Extract all text from this PDF document. Clean formatting and remove excessive newlines. Just provide the raw text structure." },
                      {
                          inlineData: {
                              mimeType: 'application/pdf',
                              data: base64Data
                          }
                      }
                  ]
              }
          });
          return response.text || "Could not read PDF.";
      } catch (e) {
          console.error("PDF Read Error", e);
          return "Error reading PDF.";
      }
  }

  // 4. Update Live Context (Reconnect Strategy)
  async updateLiveContext(additionalContext: string, restartCallback: () => void) {
      // Limit context size to prevent stuttering from massive prompts
      const cleanedContext = additionalContext.replace(/\n\s*\n/g, '\n').substring(0, 30000);
      this.currentLiveContext += `\n\n[UPDATED CONTEXT FROM USER UPLOAD]:\n${cleanedContext}`;
      
      if (this.liveSession) {
          restartCallback();
      }
  }

  // 5. Live API Connection
  async connectLive(
    onAudioData: (buffer: AudioBuffer) => void,
    onClose: () => void,
    onSpeakingChange?: (speaking: boolean) => void,
    onUserVolume?: (volume: number) => void,
    onPlayMusic?: (query: string) => void // New Callback for Music Tool
  ) {
    if (!this.currentKey) {
        this.currentKey = GEMINI_API_KEY;
        if (this.currentKey) {
             this.ai = new GoogleGenAI({ apiKey: this.currentKey });
        } else {
             throw new Error("API Key is missing in code (constants.ts).");
        }
    }

    this.liveCallbacks = { onAudioData, onClose, onSpeakingChange, onUserVolume, onPlayMusic };

    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    const outputGainNode = outputAudioContext.createGain();
    outputGainNode.connect(outputAudioContext.destination);
    
    await inputAudioContext.resume();
    await outputAudioContext.resume();

    const sources = new Set<AudioBufferSourceNode>();
    let nextStartTime = 0;
    
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

    sourceNode = inputAudioContext.createMediaStreamSource(stream);
    processorNode = inputAudioContext.createScriptProcessor(4096, 1, 1);
    inputMuteNode = inputAudioContext.createGain();
    inputMuteNode.gain.value = 0; 
    
    sourceNode.connect(processorNode);
    processorNode.connect(inputMuteNode);
    inputMuteNode.connect(inputAudioContext.destination);

    // CLEANUP FUNCTION TO STOP ALL AUDIO IMMEDIATELY
    const stopAllAudio = () => {
        sources.forEach(source => {
            try { source.stop(); } catch(e) {}
        });
        sources.clear();
        nextStartTime = 0;
        onSpeakingChange?.(false);
    };

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

              if (message.toolCall) {
                  const responses = [];
                  for (const fc of message.toolCall.functionCalls) {
                      if (fc.name === 'play_music') {
                          const song = fc.args['song_name'] as string;
                          const artist = fc.args['artist_name'] as string || '';
                          // HACK: Append "lyrics" to force Lyric Videos which are less likely to be blocked by VEVO/Copyright
                          const query = `${song} ${artist} lyrics`.trim();
                          
                          onPlayMusic?.(query);

                          responses.push({
                              id: fc.id,
                              name: fc.name,
                              response: { result: `Started playing "${query}" in the visual music player overlay.` }
                          });
                      }
                  }
                  
                  if (responses.length > 0) {
                      sessionPromise.then(session => session.sendToolResponse({ functionResponses: responses }));
                  }
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

                // Add small buffer safety to prevent "talk-stop-talk" stuttering
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
                if (msg.includes("network") || msg.includes("aborted") || msg.includes("close") || msg.includes("permission") || msg.includes("403")) {
                    console.warn("Suppressed Live API error:", msg);
                    return;
                }
                console.error("Live API Error", e);
                stopAllAudio(); // Stop talking on error
                onClose();
            },
            onclose: (e) => {
                console.log("Live API Closed", e);
                stopAllAudio(); // Stop talking on close
                onClose();
            }
          },
          config: {
            responseModalities: [Modality.AUDIO], 
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: this.currentLiveContext,
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
                stopAllAudio(); // Ensure silence
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