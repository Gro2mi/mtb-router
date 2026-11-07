import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

// PWA (E7.1): register the offline-capable service worker after page load
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // SW is a progressive enhancement — the app works without it
    });
  });
}

export default app;
