import { GameCanvas } from '@/components/game-canvas';
import { RatingDiff } from '@/components/rating-diff';
import { Tooltip } from '@/components/tooltip';
import { Button } from '@/components/ui/button';
import { connect, onServerMsg, send, useNetStore } from '@/net/ws';
import { game, notation, useGameStore } from '@/store/game';
import { Color } from '@/types';
import { formatClock, statusLabel } from '@/utils/ui';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

export function GamePage() {
	const { id } = useParams();
	const me = useNetStore((store) => store.me);
	const { history, turn, status, players, diffs, clock, myColor, drawOffer, cursor } = useGameStore(
		useShallow((store) => ({
			history: store.history,
			turn: store.turn,
			status: store.status,
			players: store.players,
			diffs: store.diffs,
			clock: store.clock,
			myColor: store.myColor,
			drawOffer: store.drawOffer,
			cursor: store.cursor,
		})),
	);

	useEffect(() => {
		if (!id) return;
		connect();
		send({ t: 'watch', game_id: id });
		const unsub = onServerMsg((msg) => {
			if (!('game_id' in msg) || msg.game_id !== id) return;
			switch (msg.t) {
				case 'game_state':
					game().loadOnline(msg);
					break;
				case 'move':
					game().applyRemoteMove(msg);
					break;
				case 'game_end':
					game().setEnd(msg);
					break;
				case 'draw_offer':
					game().setDrawOffer(msg.by);
					break;
			}
		});
		return () => {
			unsub();
			send({ t: 'unwatch', game_id: id });
		};
	}, [id]);

	// Clock extrapolation: measure elapsed locally, server/browser clocks may differ.
	const received = useRef(Date.now());
	const [, tick] = useState(0);
	useEffect(() => {
		received.current = Date.now();
		tick((n) => n + 1);
	}, [clock]);
	useEffect(() => {
		if (!clock?.running) return;
		const t = setInterval(() => tick((n) => n + 1), 250);
		return () => clearInterval(t);
	}, [clock]);

	const remaining = (color: Color) => {
		if (!clock) return 0;
		const base = color === 'white' ? clock.white_ms : clock.black_ms;
		return clock.running === color ? base - (Date.now() - received.current) : base;
	};

	const label = statusLabel(status);
	const over = status.kind !== 'playing';

	const seat = (color: Color) => (
		<div className="flex items-center justify-between gap-2 p-2 rounded border">
			<div className="flex items-center gap-2">
				<div
					className="rounded-full w-4 h-4 border-gray-200 border"
					style={{ backgroundColor: color }}
				/>
				{players[color] ? (
					<Link to={`/u/${players[color]!.name}`} className="hover:underline">
						{players[color]!.name}{' '}
						<span className="text-muted-foreground">({Math.round(players[color]!.rating)})</span>
					</Link>
				) : (
					<span>—</span>
				)}
				<RatingDiff diff={diffs[color]} />
				{myColor === color && <span className="text-muted-foreground">(you)</span>}
			</div>
			<span className={turn === color && !over ? 'font-bold' : 'text-muted-foreground'}>
				{clock ? formatClock(remaining(color)) : '—'}
			</span>
		</div>
	);

	return (
		<div className="w-screen overflow-hidden h-screen flex flex-col">
			<nav className="flex p-4 flex-row items-center gap-3 border-gray-500 border-2 bg-background">
				<Link to="/" className="text-foreground underline">
					Lobby
				</Link>
				<span className="text-muted-foreground">game {id}</span>
				<span className="text-foreground ml-auto">
					{label ?? `${turn === 'white' ? 'White' : 'Black'} to move`}
				</span>
			</nav>

			<div className="flex flex-grow overflow-hidden">
				<GameCanvas />
				<aside className="w-72 shrink-0 flex flex-col gap-3 p-3 border-l border-gray-500 bg-background text-foreground overflow-hidden">
					{seat('black')}
					{seat('white')}

					{myColor && !over && (
						<div className="flex gap-2">
							<Button
								variant="destructive"
								onClick={() => id && send({ t: 'resign', game_id: id })}
							>
								Resign
							</Button>
							<Button
								variant="outline"
								onClick={() => id && send({ t: 'draw', game_id: id, offer: true })}
							>
								{drawOffer && drawOffer !== myColor ? 'Accept draw' : 'Offer draw'}
							</Button>
							{drawOffer === myColor && (
								<Button
									variant="outline"
									onClick={() => id && send({ t: 'draw', game_id: id, offer: false })}
								>
									Withdraw
								</Button>
							)}
						</div>
					)}
					{drawOffer && drawOffer !== myColor && (
						<span className="text-sm text-muted-foreground">
							{drawOffer === 'white' ? 'White' : 'Black'} offers a draw
						</span>
					)}
					{!me && <span className="text-sm text-muted-foreground">connecting…</span>}

					<ol className="flex-grow overflow-auto text-sm font-mono">
						{history.map((move, i) => (
							<li
								key={i}
								className={`cursor-pointer px-1 ${cursor === i + 1 ? 'bg-muted' : ''}`}
								onClick={() => game().setCursor(i + 1)}
							>
								{i + 1}. {notation(move)}
							</li>
						))}
					</ol>
					{cursor !== history.length && (
						<Button variant="outline" onClick={() => game().setCursor(history.length)}>
							Back to live
						</Button>
					)}
				</aside>
			</div>
			<Tooltip />
		</div>
	);
}
