import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Any request to /predict gets forwarded to FastAPI on port 8000.
      // This means the React app never has to worry about CORS in development.
      '/predict': 'http://localhost:8000',
      '/':        { target: 'http://localhost:8000', bypass: (req) => req.url }
    }
  }
})
