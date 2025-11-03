
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LiveServerMessage } from "@google/genai";
import { AppMode, ChatMessage, ChatRole, FileData, AspectRatio, VideoAspectRatio } from './types';
import { generateText, generateImage, editImage, generateVideo, textToSpeech, connectLive } from './services/geminiService';
import { BotIcon, CloseIcon, ImageIcon, MicIcon, SendIcon, SpeakerIcon, UserIcon, VideoIcon } from './components/Icons';

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<FileData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve({
        base64: result.split(',')[1],
        mimeType: file.type,
        name: file.name
      });
    };
    reader.onerror = (error) => reject(error);
  });
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
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

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}


// --- Main App Component ---
export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: ChatRole.MODEL, text: 'Hello! I am your all-in-one Gemini assistant. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<AppMode>(AppMode.FLASH);
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<FileData | null>(null);
  
  const [isImageGenModalOpen, setIsImageGenModalOpen] = useState(false);
  const [isVideoGenModalOpen, setIsVideoGenModalOpen] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = (message: Omit<ChatMessage, 'id'>) => {
    setMessages(prev => [...prev, { ...message, id: Date.now().toString() }]);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileData = await fileToBase64(file);
      setAttachedFile(fileData);
    }
     if (event.target) {
      event.target.value = ''; // Reset file input
    }
  };

  const handleSubmit = async () => {
    if (isLoading || (!input.trim() && !attachedFile)) return;
    
    setIsLoading(true);
    const userInput = input;
    const currentFile = attachedFile;
    setInput('');
    setAttachedFile(null);

    addMessage({ role: ChatRole.USER, text: userInput, image: currentFile?.mimeType.startsWith('image/') ? `data:${currentFile.mimeType};base64,${currentFile.base64}` : undefined });
    
    const loadingMessageId = Date.now().toString();
    setMessages(prev => [...prev, { id: loadingMessageId, role: ChatRole.MODEL, text: '', isLoading: true }]);

    try {
      let response;
      if (currentFile && currentFile.mimeType.startsWith('image/')) {
        response = await generateText(userInput, AppMode.FLASH, currentFile); // Force flash for image analysis
      } else {
        response = await generateText(userInput, mode);
      }
      
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map(chunk => ({
        uri: chunk.web?.uri || chunk.maps?.uri || '',
        title: chunk.web?.title || chunk.maps?.title || '',
      })).filter(s => s.uri);

      setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, text: response.text, sources, isLoading: false } : msg));
    } catch (error) {
      console.error("Error generating response:", error);
      const errorText = error instanceof Error ? error.message : "An unknown error occurred.";
      setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, text: `Error: ${errorText}`, isLoading: false } : msg));
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleImageGeneration = async (prompt: string, aspectRatio: AspectRatio) => {
     setIsLoading(true);
     addMessage({ role: ChatRole.USER, text: `Generate an image: "${prompt}" with aspect ratio ${aspectRatio}`});
     const loadingMessageId = Date.now().toString();
     setMessages(prev => [...prev, { id: loadingMessageId, role: ChatRole.MODEL, text: '', isLoading: true }]);
     try {
       const imageBytes = await generateImage(prompt, aspectRatio);
       const imageUrl = `data:image/jpeg;base64,${imageBytes}`;
       setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, image: imageUrl, text: `Here is the generated image for: "${prompt}"`, isLoading: false } : msg));
     } catch (error) {
        console.error("Error generating image:", error);
        const errorText = error instanceof Error ? error.message : "An unknown error occurred.";
        setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, text: `Error generating image: ${errorText}`, isLoading: false } : msg));
     } finally {
        setIsLoading(false);
     }
  };
  
  const handleImageEditing = async (prompt: string) => {
      if (!attachedFile || !attachedFile.mimeType.startsWith('image/')) {
          addMessage({ role: ChatRole.SYSTEM, text: "Please attach an image first to edit it." });
          return;
      }
      setIsLoading(true);
      const currentFile = attachedFile;
      setAttachedFile(null);

      addMessage({ role: ChatRole.USER, text: `Edit image: "${prompt}"`, image: `data:${currentFile.mimeType};base64,${currentFile.base64}`});
      const loadingMessageId = Date.now().toString();
      setMessages(prev => [...prev, { id: loadingMessageId, role: ChatRole.MODEL, text: '', isLoading: true }]);
      
      try {
          const editedImageBytes = await editImage(prompt, currentFile);
          const imageUrl = `data:image/png;base64,${editedImageBytes}`;
          setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, image: imageUrl, text: `Here is the edited image for: "${prompt}"`, isLoading: false } : msg));
      } catch (error) {
          console.error("Error editing image:", error);
          const errorText = error instanceof Error ? error.message : "An unknown error occurred.";
          setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, text: `Error editing image: ${errorText}`, isLoading: false } : msg));
      } finally {
          setIsLoading(false);
      }
  };

  const handleVideoGeneration = async (prompt: string | null, image: FileData | null, aspectRatio: VideoAspectRatio) => {
    setIsLoading(true);
    let userMessage = "Generate a video";
    if (prompt) userMessage += `: "${prompt}"`;
    if (image) userMessage += ` from the attached image.`;
    
    addMessage({ role: ChatRole.USER, text: userMessage, image: image ? `data:${image.mimeType};base64,${image.base64}` : undefined });
    const loadingMessageId = Date.now().toString();
    setMessages(prev => [...prev, { id: loadingMessageId, role: ChatRole.MODEL, text: '📹 Starting video generation... This may take a few minutes. Please wait.', isLoading: true }]);
    
    try {
        const videoUrl = await generateVideo(prompt, image, aspectRatio);
        setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, video: videoUrl, text: `Here is your generated video.`, isLoading: false } : msg));
    } catch(e) {
        console.error("Error generating video:", e);
        const errorText = e instanceof Error ? e.message : "An unknown error occurred during video generation.";
        setMessages(prev => prev.map(msg => msg.id === loadingMessageId ? { ...msg, text: `Error: ${errorText}`, isLoading: false } : msg));
    } finally {
        setIsLoading(false);
    }
  };
  
  const handlePlayAudio = async (text: string) => {
      try {
          const audioData = await textToSpeech(text);
          if (audioData) {
              const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
              const decodedData = decode(audioData);
              const buffer = await decodeAudioData(decodedData, audioContext, 24000, 1);
              const source = audioContext.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContext.destination);
              source.start(0);
          }
      } catch (error) {
          console.error("Error with TTS:", error);
          addMessage({ role: ChatRole.SYSTEM, text: "Sorry, I couldn't read that aloud." });
      }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
      <Header onLiveToggle={() => setIsLiveMode(p => !p)} isLiveMode={isLiveMode}/>
      
      {isLiveMode ? (
        <LiveConversationUI onExit={() => setIsLiveMode(false)}/>
      ) : (
        <>
          <ModeSelector mode={mode} setMode={setMode} />
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {messages.map((msg) => (
              <ChatMessageBubble key={msg.id} msg={msg} onPlayAudio={handlePlayAudio} />
            ))}
            <div ref={chatEndRef} />
          </div>
          
          <InputBar
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            attachedFile={attachedFile}
            fileInputRef={fileInputRef}
            handleFileChange={handleFileChange}
            setAttachedFile={setAttachedFile}
            handleSubmit={handleSubmit}
            handleImageEditing={handleImageEditing}
            onImageIconClick={() => setIsImageGenModalOpen(true)}
            onVideoIconClick={() => setIsVideoGenModalOpen(true)}
          />
        </>
      )}

      {isImageGenModalOpen && (
        <ImageGenerationModal
          onClose={() => setIsImageGenModalOpen(false)}
          onGenerate={handleImageGeneration}
          isLoading={isLoading}
        />
      )}
      
      {isVideoGenModalOpen && (
         <VideoGenerationModal
          onClose={() => setIsVideoGenModalOpen(false)}
          onGenerate={handleVideoGeneration}
        />
      )}

    </div>
  );
}

// --- Sub Components ---

const Header: React.FC<{onLiveToggle: () => void, isLiveMode: boolean}> = ({ onLiveToggle, isLiveMode }) => (
  <header className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700 shadow-md">
    <h1 className="text-xl font-bold text-cyan-400">Meta World 🌎 ai</h1>
    <button
      onClick={onLiveToggle}
      className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors ${
        isLiveMode 
        ? 'bg-red-500 hover:bg-red-600'
        : 'bg-cyan-500 hover:bg-cyan-600'
      }`}
    >
      <MicIcon className="w-5 h-5"/>
      {isLiveMode ? 'End Conversation' : 'Start Conversation'}
    </button>
  </header>
);

const ModeSelector: React.FC<{mode: AppMode, setMode: (mode: AppMode) => void}> = ({ mode, setMode }) => {
  const modes = [
    { key: AppMode.LITE, label: 'Lite ⚡️' },
    { key: AppMode.FLASH, label: 'Flash ✨' },
    { key: AppMode.PRO, label: 'Pro (Thinking) 🤔' },
    { key: AppMode.SEARCH, label: 'Search 🌐' },
  ];
  return (
    <div className="flex justify-center p-2 bg-gray-800/50">
      <div className="flex space-x-2 bg-gray-900 p-1 rounded-lg">
        {modes.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`px-3 py-1 text-sm font-semibold rounded-md transition-colors ${
              mode === m.key ? 'bg-cyan-500 text-white' : 'bg-transparent text-gray-400 hover:bg-gray-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
};


const ChatMessageBubble: React.FC<{msg: ChatMessage, onPlayAudio: (text: string) => void}> = ({ msg, onPlayAudio }) => {
  const isUser = msg.role === ChatRole.USER;
  return (
    <div className={`flex items-start gap-4 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && <div className="p-1.5 bg-gray-700 rounded-full"><BotIcon className="w-8 h-8 text-cyan-400"/></div>}
      <div className={`max-w-xl p-4 rounded-2xl shadow ${isUser ? 'bg-cyan-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'}`}>
        {msg.isLoading ? (
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-75"></div>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse delay-150"></div>
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            {msg.image && <img src={msg.image} alt="content" className="max-w-xs rounded-lg my-2"/>}
            {msg.video && <video src={msg.video} controls className="max-w-xs rounded-lg my-2"/>}
            <p className="whitespace-pre-wrap">{msg.text}</p>
            {msg.sources && msg.sources.length > 0 && (
              <div className="mt-4 pt-2 border-t border-gray-600">
                <h4 className="text-xs font-bold text-gray-400 mb-1">Sources:</h4>
                <ul className="text-xs space-y-1">
                  {msg.sources.map((source, index) => (
                    <li key={index}>
                      <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline break-all">
                        {index + 1}. {source.title || source.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {!isUser && msg.text && !msg.isLoading && (
          <button onClick={() => onPlayAudio(msg.text)} className="mt-2 text-gray-400 hover:text-cyan-400 transition-colors">
            <SpeakerIcon className="w-5 h-5"/>
          </button>
        )}
      </div>
      {isUser && <div className="p-1.5 bg-gray-700 rounded-full"><UserIcon className="w-8 h-8 text-gray-300"/></div>}
    </div>
  );
};

const InputBar: React.FC<{
  input: string;
  setInput: (val: string) => void;
  isLoading: boolean;
  attachedFile: FileData | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setAttachedFile: (file: FileData | null) => void;
  handleSubmit: () => void;
  handleImageEditing: (prompt: string) => void;
  onImageIconClick: () => void;
  onVideoIconClick: () => void;
}> = ({
  input, setInput, isLoading, attachedFile, fileInputRef,
  handleFileChange, setAttachedFile, handleSubmit, handleImageEditing,
  onImageIconClick, onVideoIconClick
}) => {
  const isImageAttached = attachedFile?.mimeType.startsWith('image/');

  const handleSend = () => {
    if (isImageAttached && input.trim()) {
      handleImageEditing(input);
      setInput('');
    } else {
      handleSubmit();
    }
  };
  
  return (
    <div className="p-4 bg-gray-800 border-t border-gray-700">
      {attachedFile && (
        <div className="mb-2 flex items-center justify-between bg-gray-700 p-2 rounded-lg">
          <span className="text-sm text-gray-300 truncate">Attached: {attachedFile.name}</span>
          <button onClick={() => setAttachedFile(null)} className="text-gray-400 hover:text-white">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      )}
      <div className="flex items-center bg-gray-700 rounded-lg p-2">
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,video/*,audio/*" />
        <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-cyan-400" title="Attach file">
          <ImageIcon />
        </button>
        <button onClick={onImageIconClick} className="p-2 text-gray-400 hover:text-cyan-400" title="Generate Image">
          <ImageIcon className="w-6 h-6"/>
        </button>
        <button onClick={onVideoIconClick} className="p-2 text-gray-400 hover:text-cyan-400" title="Generate Video">
          <VideoIcon className="w-6 h-6"/>
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={isImageAttached ? "Describe how you want to edit the image..." : "Type your message..."}
          className="flex-1 bg-transparent border-none focus:ring-0 resize-none text-gray-100 placeholder-gray-400"
          rows={1}
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || (!input.trim() && !attachedFile)}
          className="p-2 rounded-full bg-cyan-500 text-white disabled:bg-gray-600 hover:bg-cyan-600 transition-colors"
        >
          {isLoading ? (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <SendIcon />
          )}
        </button>
      </div>
    </div>
  );
};

const Modal: React.FC<{ children: React.ReactNode, title: string, onClose: () => void }> = ({ children, title, onClose }) => (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold text-white">{title}</h2>
                <button onClick={onClose} className="text-gray-400 hover:text-white">
                    <CloseIcon />
                </button>
            </div>
            {children}
        </div>
    </div>
);


const ImageGenerationModal: React.FC<{
    onClose: () => void;
    onGenerate: (prompt: string, aspectRatio: AspectRatio) => void;
    isLoading: boolean;
}> = ({ onClose, onGenerate, isLoading }) => {
    const [prompt, setPrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const aspectRatios: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

    const handleGenerate = () => {
        if (prompt.trim()) {
            onGenerate(prompt, aspectRatio);
            onClose();
        }
    };

    return (
        <Modal title="Generate Image" onClose={onClose}>
            <div className="space-y-4">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter a prompt for the image..."
                    className="w-full bg-gray-700 rounded-lg p-2 focus:ring-cyan-500 focus:border-cyan-500 text-white"
                    rows={3}
                />
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Aspect Ratio</label>
                    <div className="flex flex-wrap gap-2">
                        {aspectRatios.map(ar => (
                            <button key={ar} onClick={() => setAspectRatio(ar)}
                                className={`px-3 py-1 text-sm rounded-full ${aspectRatio === ar ? 'bg-cyan-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                                {ar}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={isLoading || !prompt.trim()}
                    className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-500"
                >
                    {isLoading ? 'Generating...' : 'Generate'}
                </button>
            </div>
        </Modal>
    );
};

const VideoGenerationModal: React.FC<{
    onClose: () => void;
    onGenerate: (prompt: string | null, image: FileData | null, aspectRatio: VideoAspectRatio) => void;
}> = ({ onClose, onGenerate }) => {
    const [prompt, setPrompt] = useState('');
    const [imageFile, setImageFile] = useState<FileData | null>(null);
    const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
    const [isLoading, setIsLoading] = useState(false);
    const aspectRatios: VideoAspectRatio[] = ["16:9", "9:16"];

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const fileData = await fileToBase64(file);
            setImageFile(fileData);
        }
    };

    const handleGenerate = async () => {
        if (!prompt.trim() && !imageFile) {
            return;
        }
        setIsLoading(true);
        if (typeof (window as any).aistudio === 'undefined' || !((window as any).aistudio.hasSelectedApiKey())) {
            await (window as any).aistudio.openSelectKey();
        }
        await onGenerate(prompt || null, imageFile, aspectRatio);
        setIsLoading(false);
        onClose();
    };

    return (
        <Modal title="Generate Video with Veo" onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-gray-400">Provide a prompt and/or an initial image to generate a video. <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Billing information</a></p>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter a prompt for the video..."
                    className="w-full bg-gray-700 rounded-lg p-2 focus:ring-cyan-500 focus:border-cyan-500 text-white"
                    rows={3}
                />
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Initial Image (Optional)</label>
                    <input type="file" onChange={handleFileChange} accept="image/*"
                           className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-50 file:text-cyan-700 hover:file:bg-cyan-100"/>
                    {imageFile && <p className="text-xs text-gray-400 mt-1">Selected: {imageFile.name}</p>}
                </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Aspect Ratio</label>
                    <div className="flex flex-wrap gap-2">
                        {aspectRatios.map(ar => (
                            <button key={ar} onClick={() => setAspectRatio(ar)}
                                className={`px-3 py-1 text-sm rounded-full ${aspectRatio === ar ? 'bg-cyan-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>
                                {ar}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={isLoading || (!prompt.trim() && !imageFile)}
                    className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-500 flex items-center justify-center"
                >
                    {isLoading ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div><span>Generating...</span></> : 'Generate'}
                </button>
            </div>
        </Modal>
    );
};


const LiveConversationUI: React.FC<{ onExit: () => void }> = ({ onExit }) => {
    const [status, setStatus] = useState('Initializing...');
    const [permissionError, setPermissionError] = useState<string | null>(null);
    const [userTranscription, setUserTranscription] = useState('');
    const [modelTranscription, setModelTranscription] = useState('');
    const [history, setHistory] = useState<{user: string, model: string}[]>([]);

    const currentInputTranscriptionRef = useRef('');
    const currentOutputTranscriptionRef = useRef('');
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const sessionPromiseRef = useRef<Promise<any> | null>(null);

    const cleanup = useCallback(() => {
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
            sessionPromiseRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }
    }, []);

    useEffect(() => {
        let isMounted = true;
        let inputAudioContext: AudioContext;
        let stream: MediaStream;
        
        if (!outputAudioContextRef.current) {
          outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const outputNode = outputAudioContextRef.current.createGain();
        outputNode.connect(outputAudioContextRef.current.destination);
        
        const processMessage = async (message: LiveServerMessage) => {
            if (!isMounted) return;

            if (message.serverContent?.inputTranscription) {
                currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
                setUserTranscription(currentInputTranscriptionRef.current);
            }
            if (message.serverContent?.outputTranscription) {
                 currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
                 setModelTranscription(currentOutputTranscriptionRef.current);
            }
            if (message.serverContent?.turnComplete) {
                const fullInput = currentInputTranscriptionRef.current;
                const fullOutput = currentOutputTranscriptionRef.current;

                if (fullInput.trim() || fullOutput.trim()) {
                    setHistory(prev => [...prev, {user: fullInput, model: fullOutput}]);
                }

                currentInputTranscriptionRef.current = '';
                currentOutputTranscriptionRef.current = '';
                setUserTranscription('');
                setModelTranscription('');
            }
            
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
            if (audioData && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNode);
                source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                });
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
            }

             if (message.serverContent?.interrupted) {
                for (const source of sourcesRef.current.values()) {
                    source.stop();
                }
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }
        };

        const setupLive = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (!isMounted) return;
                
                inputAudioContext = new AudioContext({ sampleRate: 16000 });
                const source = inputAudioContext.createMediaStreamSource(stream);
                const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                
                scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                    const l = inputData.length;
                    const int16 = new Int16Array(l);
                    for (let i = 0; i < l; i++) {
                      int16[i] = inputData[i] * 32768;
                    }
                    const pcmBlob = {
                      data: encode(new Uint8Array(int16.buffer)),
                      mimeType: 'audio/pcm;rate=16000',
                    };

                    sessionPromiseRef.current?.then((session) => {
                        if (isMounted) session.sendRealtimeInput({ media: pcmBlob });
                    });
                };
                source.connect(scriptProcessor);
                scriptProcessor.connect(inputAudioContext.destination);

                sessionPromiseRef.current = connectLive({
                    onOpen: () => { if (isMounted) setStatus('Connected. Start speaking...') },
                    onMessage: processMessage,
                    onError: (e) => {
                        console.error('Live connection error:', e);
                        if (isMounted) setStatus('Error occurred. Please try again.');
                    },
                    onClose: () => { if (isMounted) setStatus('Connection closed.') },
                });

            } catch (err) {
                console.error('Error getting user media:', err);
                if (isMounted) {
                    setStatus('Error');
                    setPermissionError('Microphone access denied. Please enable it in your browser settings and restart the conversation.');
                }
            }
        };

        setupLive();

        return () => {
            isMounted = false;
            cleanup();
            stream?.getTracks().forEach(track => track.stop());
            if(inputAudioContext && inputAudioContext.state !== 'closed') {
                inputAudioContext.close();
            }
        };

    }, [cleanup]);

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-4 bg-gray-900 text-white">
             {permissionError ? (
                <div className="text-center w-full max-w-md p-6 bg-gray-800 rounded-lg shadow-xl">
                    <h2 className="text-xl font-bold text-red-500 mb-4">Microphone Access Required</h2>
                    <p className="text-gray-300 mb-6">{permissionError}</p>
                    <button onClick={onExit} className="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                        Return to Chat
                    </button>
                </div>
            ) : (
                <div className="text-center w-full max-w-2xl">
                    <p className="text-lg font-semibold text-cyan-400 mb-2">{status}</p>
                    <div className="min-h-[12rem] bg-gray-800 rounded-lg p-4 text-left space-y-4 overflow-y-auto">
                       {history.map((turn, i) => (
                           <div key={i} className="pb-2 mb-2 border-b border-gray-700 last:border-b-0">
                               <p><strong className="text-gray-400">You:</strong> {turn.user}</p>
                               <p><strong className="text-cyan-400">AI:</strong> {turn.model}</p>
                           </div>
                       ))}
                        {(userTranscription || modelTranscription) && (
                            <div>
                                <p><strong className="text-gray-400">You:</strong> {userTranscription}</p>
                                <p><strong className="text-cyan-400">AI:</strong> {modelTranscription}<span className="inline-block w-2 h-4 bg-cyan-400 ml-1 animate-pulse"></span></p>
                            </div>
                        )}
                    </div>
                     <button onClick={onExit} className="mt-6 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg">
                        End Conversation
                    </button>
                </div>
            )}
        </div>
    );
};
