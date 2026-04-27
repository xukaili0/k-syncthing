/// <reference types="vite/client" />

declare global {
  interface Window {
    metadata?: {
      deviceID: string;
      deviceIDShort: string;
      authenticated: boolean;
    };
  }
}

export {};
