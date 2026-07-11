import { mount } from 'svelte';
import TileViewer from './views/TileViewer.svelte';

const app = mount(TileViewer, {
  target: document.getElementById('app')!,
});

// Register the offline-app-shell service worker (feature 127). Production only —
// in dev it would interfere with Vite HMR — and best-effort (a failure must never
// break the app). The SW only precaches the shell; it never caches data requests.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline shell is a progressive enhancement; ignore registration failures */
    });
  });
}

export default app;
