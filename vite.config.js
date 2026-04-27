import { defineConfig } from 'vite';

export default defineConfig({
    root: 'src',
    resolve: {
        alias: {
            'stream/web': 'web-streams-polyfill'
        }
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true
            }
        }
    },
    build: {
        outDir: '../dist'
    }
});
