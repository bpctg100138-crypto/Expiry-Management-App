import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register offline Service Worker
registerSW({
  immediate: true,
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('pwa-offline-ready'));
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
