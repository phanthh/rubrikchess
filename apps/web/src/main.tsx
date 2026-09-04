import React from 'react';
import ReactDOM from 'react-dom/client';
import init from 'rubrik-wasm';
import App from './App.tsx';
import './index.css';

// The rules engine must be live before any component touches WasmGame.
init().then(() => {
	ReactDOM.createRoot(document.getElementById('root')!).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
});
