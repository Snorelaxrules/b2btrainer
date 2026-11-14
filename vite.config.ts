import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the static build works from any folder or sub-path host.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
})
