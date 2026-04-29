import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'pdb-mime-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.pdb')) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          }
          next()
        })
      },
    },
  ],
})
