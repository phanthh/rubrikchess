import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { defineConfig } from 'vite';

const SERVER = 'http://localhost:3000';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	// rubrik-wasm loads its .wasm via `new URL(..., import.meta.url)`; prebundling breaks that.
	optimizeDeps: {
		exclude: ['rubrik-wasm'],
	},
	server: {
		proxy: {
			'/api': SERVER,
			'/ws': { target: SERVER, ws: true },
		},
	},
});
