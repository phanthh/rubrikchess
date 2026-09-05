import { Puzzle, scanPuzzles } from '@/ai';
import { BoardPage } from '@/components/round/board-page';
import { Button } from '@/components/ui/button';
import { getGame, listGames, randomPuzzle } from '@/net/api';
import { game, useGameStore } from '@/store/game';
import { Move } from '@/types';
import { notation } from '@/utils/notation';
import { play } from '@/utils/sound';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prefs, usePrefs } from '@/store/prefs';
import { Link } from 'react-router-dom';

type Task = { gameId: string; puzzle: Puzzle; players: string };
type Verdict = 'solved' | 'failed' | null;

const sameMove = (a: Move, b: Move) =>
	a.kind === b.kind &&
	a.from === b.from &&
	(a.kind === 'rotate'
		? a.axis === (b as typeof a).axis && a.sign === (b as typeof a).sign
		: a.path[a.path.length - 1] === (b as typeof a).path[(b as typeof a).path.length - 1]);

/**
 * Tactics from real games: find the move that wins material against the best reply.
 * Positions are mined on the fly by the engine worker from recent finished games.
 */
export function PuzzlePage() {
	const [task, setTask] = useState<Task | null>(null);
	const [verdict, setVerdict] = useState<Verdict>(null);
	const [status, setStatus] = useState('Looking for a tactic in recent games…');
	const [loading, setLoading] = useState(true);
	const solved = usePrefs((s) => s.puzzlesSolved);
	const seen = useRef(new Set<string>());
	const seenIds = useRef<number[]>([]);
	const run = useRef(0);
	const turn = useGameStore((s) => s.turn);
	const history = useGameStore((s) => s.history);

	const next = useCallback(async () => {
		const me = ++run.current; // a newer click supersedes this scan
		setTask(null);
		setVerdict(null);
		setLoading(true);
		setStatus('Looking for a tactic in recent games…');
		// server-mined puzzles first (instant); fall back to scanning recent games in the worker
		const served = await randomPuzzle(seenIds.current).catch(() => null);
		if (me !== run.current) return;
		if (served) {
			seenIds.current.push(served.id);
			game().loadAnalysis(served.config, served.moves, {
				white: served.white,
				black: served.black,
			});
			game().setSetting({ flipped: game().turn === 'black' });
			setTask({
				gameId: served.game_id,
				puzzle: { ply: served.ply, solution: served.solution, gain: served.gain },
				players: `${served.white.name} vs ${served.black.name}`,
			});
			setLoading(false);
			return;
		}
		const games = (await listGames(50)).filter((g) => g.plies >= 8 && g.status.kind !== 'playing');
		for (const row of games.sort(() => Math.random() - 0.5).slice(0, 12)) {
			if (me !== run.current) return;
			const detail = await getGame(row.id);
			const puzzles = (await scanPuzzles(detail.config, detail.moves)).filter(
				(p) => !seen.current.has(`${row.id}:${p.ply}`),
			);
			if (me !== run.current) return;
			if (puzzles.length === 0) continue;
			const puzzle = puzzles[Math.floor(Math.random() * puzzles.length)];
			seen.current.add(`${row.id}:${puzzle.ply}`);
			game().loadAnalysis(detail.config, detail.moves.slice(0, puzzle.ply), {
				white: detail.white,
				black: detail.black,
			});
			game().setSetting({ flipped: game().turn === 'black' });
			setTask({ gameId: row.id, puzzle, players: `${detail.white.name} vs ${detail.black.name}` });
			setLoading(false);
			return;
		}
		setLoading(false);
		setStatus('No tactics found in recent games yet — play some games and come back!');
	}, []);

	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- load the first puzzle on mount; next() resets the same state a click would
		void next();
	}, [next]);

	// the player's move = first ply after the puzzle position
	useEffect(() => {
		if (!task || verdict) return;
		if (history.length !== task.puzzle.ply + 1) return;
		const played = history[task.puzzle.ply];
		if (sameMove(played, task.puzzle.solution)) {
			// oxlint-disable-next-line react/set-state-in-effect -- grades the move played into the external game store
			setVerdict('solved');
			prefs().set({ puzzlesSolved: prefs().puzzlesSolved + 1 });
			play('end');
		} else {
			setVerdict('failed');
			play('error');
		}
	}, [history, task, verdict]);

	const retry = () => {
		if (!task) return;
		// bounded: undo() is a no-op mid-animation, so never loop on the live length
		for (let i = game().history.length; i > task.puzzle.ply; i--) game().undo();
		setVerdict(null);
	};

	const side = turn === 'white' ? 'White' : 'Black';
	const sol = task
		? notation(task.puzzle.solution, game().cells[task.puzzle.solution.from]?.piece?.kind)
		: '';

	return (
		<BoardPage
			banner={
				task
					? verdict === 'solved'
						? 'Solved!'
						: verdict === 'failed'
							? 'Not this one'
							: `${side} to play and win material`
					: status
			}
			right={
				<div className="box p-3 text-sm flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<span className="font-semibold">Tactics</span>
						<span className="text-xs text-muted-foreground">solved {solved}</span>
					</div>
					{!task && <p className="text-xs text-muted-foreground">{status}</p>}
					{task && !verdict && (
						<p className="text-xs text-muted-foreground">
							Find the best move for {side}. It wins at least a minor piece even against the best
							reply — a plain capture is not enough.
						</p>
					)}
					{verdict === 'solved' && (
						<p className="text-secondary">
							Correct: <span className="font-mono">{sol}</span> wins{' '}
							{(task!.puzzle.gain / 100).toFixed(0)} points of material.
						</p>
					)}
					{verdict === 'failed' && (
						<p className="text-destructive">
							That does not win enough. Try again or reveal the answer.
						</p>
					)}
					<div className="flex gap-2">
						{verdict === 'failed' && (
							<Button size="sm" variant="outline" className="flex-1" onClick={retry}>
								Retry
							</Button>
						)}
						{verdict === 'failed' && (
							<Button
								size="sm"
								variant="outline"
								className="flex-1"
								onClick={() => {
									retry();
									game().play(task!.puzzle.solution);
								}}
							>
								Show answer
							</Button>
						)}
						<Button
							size="sm"
							variant="secondary"
							className="flex-1"
							disabled={loading}
							onClick={next}
						>
							{task ? 'Next puzzle' : 'Search again'}
						</Button>
					</div>
					{task && (
						<div className="text-xs text-muted-foreground">
							From <Link to={`/g/${task.gameId}`}>{task.players}</Link>, ply {task.puzzle.ply + 1}.
						</div>
					)}
				</div>
			}
		/>
	);
}
