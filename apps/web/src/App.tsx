import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { onServerMsg } from './net/ws';
import { GamePage } from './pages/game';
import { LobbyPage } from './pages/lobby';
import { LocalPage } from './pages/local';
import { UserPage } from './pages/user';

/** A rematch or an accepted seek can start a game from any page, so this listener is global. */
function GameStartNav() {
	const navigate = useNavigate();
	useEffect(
		() => onServerMsg((msg) => msg.t === 'game_start' && navigate(`/g/${msg.game_id}`)),
		[navigate],
	);
	return null;
}

export default function App() {
	return (
		<BrowserRouter>
			<GameStartNav />
			<Routes>
				<Route path="/" element={<LobbyPage />} />
				<Route path="/local" element={<LocalPage />} />
				<Route path="/g/:id" element={<GamePage />} />
				<Route path="/u/:name" element={<UserPage />} />
			</Routes>
			<Toaster closeButton richColors />
		</BrowserRouter>
	);
}
