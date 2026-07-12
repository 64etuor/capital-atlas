import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // React Compiler (babel-plugin-react-compiler) via rolldown babel bridge
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split the two heavy visual engines off the app chunk so the globe
        // (deck.gl) and the panel treemap (echarts) load as separate cacheable
        // bundles instead of one 1.3 MB blob.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](@?deck\.gl|@luma\.gl|@math\.gl|@loaders\.gl)/.test(id)) {
            return 'deck'
          }
          if (/[\\/]node_modules[\\/](echarts|zrender)/.test(id)) {
            return 'echarts'
          }
        },
      },
    },
  },
})
