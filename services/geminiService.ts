
import { GoogleGenAI, GenerateContentResponse, Modality, Type, LiveServerMessage } from "@google/genai";
import { AppMode, FileData, VideoAspectRatio, AspectRatio } from '../types';

let ai: GoogleGenAI;

const getAI = () => {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }
  return ai;
};

// Helper to convert file to base64
export const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

export const generateText = async (prompt: string, mode: AppMode, image?: FileData): Promise<GenerateContentResponse> => {
  const ai = getAI();
  const modelName = mode === AppMode.SEARCH ? AppMode.FLASH : mode;
  
  const contents = image ? { parts: [{ text: prompt }, { inlineData: { data: image.base64, mimeType: image.mimeType } }] } : prompt;

  return await ai.models.generateContent({
    model: modelName,
    contents,
    config: {
      ...(mode === AppMode.PRO && { thinkingConfig: { thinkingBudget: 32768 } }),
      ...(mode === AppMode.SEARCH && { tools: [{ googleSearch: {} }] }),
    },
  });
};

export const generateImage = async (prompt: string, aspectRatio: AspectRatio) => {
  const ai = getAI();
  const response = await ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt,
    config: {
      numberOfImages: 1,
      outputMimeType: 'image/jpeg',
      aspectRatio: aspectRatio,
    },
  });
  return response.generatedImages[0].image.imageBytes;
};

export const editImage = async (prompt: string, image: FileData) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { inlineData: { data: image.base64, mimeType: image.mimeType } },
        { text: prompt },
      ],
    },
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });
  
  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  throw new Error("No edited image found in response");
};


export const generateVideo = async (prompt: string | null, image: FileData | null, aspectRatio: VideoAspectRatio) => {
  const createNewAiInstance = () => new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  let currentAi = createNewAiInstance();

  const generate = async () => {
      return await currentAi.models.generateVideos({
          model: 'veo-3.1-fast-generate-preview',
          ...(prompt && { prompt }),
          ...(image && { image: { imageBytes: image.base64, mimeType: image.mimeType } }),
          config: {
              numberOfVideos: 1,
              resolution: '720p',
              aspectRatio: aspectRatio,
          }
      });
  };

  try {
      let operation = await generate();
      while (!operation.done) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          try {
              operation = await currentAi.operations.getVideosOperation({ operation: operation });
          } catch (e: any) {
              if (e.message.includes("Requested entity was not found.")) {
                  console.warn("API key might be stale. Re-initializing and retrying.");
                  currentAi = createNewAiInstance(); // re-initialize
                  // We can't re-get the operation, we have to restart it.
                  // This is a simplification. A real app might need to store operation ID.
                  throw new Error("API key invalid, please re-select and try again.");
              }
              throw e;
          }
      }
      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) {
          throw new Error("Video generation succeeded but no download link was provided.");
      }
      const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
      const videoBlob = await videoResponse.blob();
      return URL.createObjectURL(videoBlob);
  } catch(e: any) {
      if (e.message.includes("API key not valid.")) {
           throw new Error("API key invalid, please re-select and try again.");
      }
      throw e;
  }
};


export const textToSpeech = async (text: string) => {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });
  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
};


export const connectLive = async (callbacks: {
    onOpen: () => void,
    onMessage: (message: LiveServerMessage) => void,
    onError: (e: ErrorEvent) => void,
    onClose: (e: CloseEvent) => void,
}) => {
    const ai = getAI();
    return await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: callbacks.onOpen,
            onmessage: callbacks.onMessage,
            onerror: callbacks.onError,
            onclose: callbacks.onClose,
        },
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: 'You are a friendly and helpful AI assistant. Be concise.',
        },
    });
};
