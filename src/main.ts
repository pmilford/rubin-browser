import { mount } from 'svelte';
import TileViewer from './views/TileViewer.svelte';

const app = mount(TileViewer, {
  target: document.getElementById('app')!,
});

export default app;
