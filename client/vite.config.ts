import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server :{
    proxy: {
        '/api': {
             target: 'http://localhost:3000/api',
             rewrite: (path) => path.replace(/^\/api/, ''),
         }
    }
  }
})