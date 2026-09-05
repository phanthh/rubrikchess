import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { onServerMsg, send } from './net/ws';
import { toast } from 'sonner';
import { clockLabel } from './utils/clock';
import { AnalysisPage } from './pages/analysis';
import { ChallengePage } from './pages/challenge';
import { EditorPage } from './pages/editor';
import { GamePage } from './pages/game';
import { GamesPage } from './pages/games';
import { LobbyPage } from './pages/lobby';
import { LocalPage } from './pages/local';
import { PlayersPage } from './pages/players';
import { TournamentPage } from './pages/tournament';
import { TournamentsPage } from './pages/tournaments';
import { TvPage } from './pages/tv';
import { UserPage } from './pages/user';
import { notify } from './utils/notify';
import { play } from './utils/sound';

/** Games and challenges can start from any page, so these listeners are global. */
function ServerNav() {
	const navigate = useNavigate();
	useEffect(
		() =>
			onServerMsg((msg) => {
				if (msg.t === 'game_start') {
					play('notify');
					notify('Game started', 'Your opponent is waiting.');
					navigate(`/g/${msg.game_id}`);
				} else if (msg.t === 'challenge') {
					navigate(`/c/${msg.challenge.id}`);
				} else if (msg.t === 'challenge_in') {
					const c = msg.challenge;
					play('notify');
					notify('Challenge', `${c.user.name} challenges you (${clockLabel(c.clock)})`);
					toast(`${c.user.name} challenges you · ${clockLabel(c.clock)}`, {
						duration: 60_000,
						action: { label: 'Accept', onClick: () => send({ t: 'join', challenge_id: c.id }) },
						cancel: { label: 'Ignore', onClick: () => undefined },
					});
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
				<Route path="/editor" element={<EditorPage />} />
				<Route path="/tv" element={<TvPage />} />
				<Route path="/games" element={<GamesPage />} />
				<Route path="/tournaments" element={<TournamentsPage />} />
				<Route path="/tournament/:id" element={<TournamentPage />} />
				<Route path="/players" element={<PlayersPage />} />
				<Route path="/c/:id" element={<ChallengePage />} />
				<Route path="/g/:id" element={<GamePage />} />
				<Route path="/analysis/:id" element={<AnalysisPage />} />
				<Route path="/u/:name" element={<UserPage />} />
			</Routes>
			<Toaster closeButton richColors theme="dark" />
		</BrowserRouter>
	);
}
