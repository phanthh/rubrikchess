import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { GamePage } from './pages/game';
import { LobbyPage } from './pages/lobby';
import { LocalPage } from './pages/local';

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<LobbyPage />} />
				<Route path="/local" element={<LocalPage />} />
				<Route path="/g/:id" element={<GamePage />} />
			</Routes>
			<Toaster closeButton richColors />
		</BrowserRouter>
	);
}
