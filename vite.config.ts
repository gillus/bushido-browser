import { defineConfig } from 'vite';

// Relative asset paths so the build works from any subpath (GitHub Pages
// serves project sites at /<repo>/).
export default defineConfig({
  base: './',
});
