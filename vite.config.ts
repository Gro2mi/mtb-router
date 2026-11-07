import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Relative base: the built app works from ANY folder on a webspace
// (e.g. mydomain.com/mtb-router/) as well as from the domain root —
// no rebuild needed when the folder name changes.
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), svelte()],
  build: {
    sourcemap: true,
    target: 'es2022',
  },
});
