import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';
import { useSimStore } from './store/useSimStore';

// Expose the store for debugging and for the visual smoke test (scripts/screenshot.mjs).
declare global {
  interface Window {
    __butterfly?: typeof useSimStore;
  }
}
window.__butterfly = useSimStore;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
