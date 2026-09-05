import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { onServerMsg } from './net/ws';
import { ChallengePage } from './pages/challenge';
import { GamePage } from './pages/game';
import { LobbyPage } from './pages/lobby';
import { LocalPage } from './pages/local';
import { PlayersPage } from './pages/players';
import { TvPage } from './pages/tv';
import { UserPage } from './pages/user';
import { play } from './utils/sound';

/** Games and challenges can start from any page, so these listeners are global. */
function ServerNav() {
	const navigate = useNavigate();
	useEffect(
		() =>
			onServerMsg((msg) => {
				if (msg.t === 'game_start') {
					play('notify');
					navigate(`/g/${msg.game_id}`);
				} else if (msg.t === 'challenge') {
					navigate(`/c/${msg.challenge.id}`);
				}
			}),
		[navigate],
	);
	return null;
}

export default function App() {
	return (
		<BrowserRouter>
			<ServerNav />
			<Routes>
				<Route path="/" element={<LobbyPage />} />
				<Route path="/local" element={<LocalPage />} />
				<Route path="/tv" element={<TvPage />} />
				<Route path="/players" element={<PlayersPage />} />
				<Route path="/c/:id" element={<ChallengePage />} />
				<Route path="/g/:id" element={<GamePage />} />
				<Route path="/u/:name" element={<UserPage />} />
			</Routes>
			<Toaster closeButton richColors theme="dark" />
		</BrowserRouter>
	);
}
