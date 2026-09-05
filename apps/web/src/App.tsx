import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { onServerMsg, send } from './net/ws';
import { toast } from 'sonner';
import { clockLabel } from './utils/clock';
import { ChallengePage } from './pages/challenge';
import { GamesPage } from './pages/games';
import { LobbyPage } from './pages/lobby';
import { PlayersPage } from './pages/players';
import { TournamentPage } from './pages/tournament';
import { TournamentsPage } from './pages/tournaments';
import { TvPage } from './pages/tv';
import { UserPage } from './pages/user';
import { notify } from './utils/notify';
import { play } from './utils/sound';

// The 3D pages pull in three.js + the engine store; keep them out of the lobby bundle.
const GamePage = lazy(() => import('./pages/game').then((m) => ({ default: m.GamePage })));
const LocalPage = lazy(() => import('./pages/local').then((m) => ({ default: m.LocalPage })));
const AnalysisPage = lazy(() =>
	import('./pages/analysis').then((m) => ({ default: m.AnalysisPage })),
);
const EditorPage = lazy(() => import('./pages/editor').then((m) => ({ default: m.EditorPage })));
const LearnPage = lazy(() => import('./pages/learn').then((m) => ({ default: m.LearnPage })));
const PuzzlePage = lazy(() => import('./pages/puzzle').then((m) => ({ default: m.PuzzlePage })));

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
			<Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
				<Routes>
					<Route path="/" element={<LobbyPage />} />
					<Route path="/local" element={<LocalPage />} />
					<Route path="/editor" element={<EditorPage />} />
					<Route path="/learn" element={<LearnPage />} />
					<Route path="/puzzle" element={<PuzzlePage />} />
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
			</Suspense>
			<Toaster closeButton richColors theme="dark" />
		</BrowserRouter>
	);
}
