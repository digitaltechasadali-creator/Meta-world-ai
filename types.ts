
export enum ChatRole {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system',
}

export interface Source {
  uri: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  image?: string;
  video?: string;
  audio?: string;
  sources?: Source[];
  isLoading?: boolean;
}

export enum AppMode {
  LITE = 'gemini-2.5-flash-lite',
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-2.5-pro',
  SEARCH = 'search',
}

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type VideoAspectRatio = "16:9" | "9:16";

export interface FileData {
  base64: string;
  mimeType: string;
  name: string;
}
