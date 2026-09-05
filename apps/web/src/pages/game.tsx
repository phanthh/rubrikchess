import { BoardPage } from '@/components/round/board-page';
import { Chat, ChatLine } from '@/components/round/chat';
import { Crosstable } from '@/components/round/crosstable';
import { useClock } from '@/components/round/use-clock';
import { MoveList } from '@/components/round/move-list';
import { PlayerBar } from '@/components/round/player-bar';
import { RoundControls } from '@/components/round/round-controls';
import { onServerMsg, send, useNetStore } from '@/net/ws';
import { game, useGameStore } from '@/store/game';
import { Color } from '@/types';
import { notify } from '@/utils/notify';
import { play } from '@/utils/sound';
import { statusLabel } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

const side = (c: Color) => (c === 'white' ? 'White' : 'Black');

export function GamePage() {
	const { id } = useParams();
	const connected = useNetStore((s) => s.connected);
	const [chat, setChat] = useState<ChatLine[]>([]);
	const [rematchBy, setRematchBy] = useState<Color | null>(null);
	const [gone, setGone] = useState<Color | null>(null);
	const { turn, status, players, clock, myColor, flipped, watchers } = useGameStore(
		useShallow((s) => ({
			turn: s.turn,
			status: s.status,
			players: s.players,
			clock: s.clock,
			myColor: s.myColor,
			flipped: s.flipped,
			watchers: s.watchers,
		})),
	);
	const { remaining } = useClock();

	// re-runs on reconnect so the room subscription (and full state) is restored
	useEffect(() => {
		if (!id || !connected) return;
		send({ t: 'watch', game_id: id });
		const sys = (text: string) => setChat((prev) => [...prev, { text, at: Date.now() }]);
		const unsub = onServerMsg((msg) => {
			if (!('game_id' in msg) || msg.game_id !== id) return;
			const g = game();
			switch (msg.t) {
				case 'game_state':
					g.loadOnline(msg);
					break;
				case 'move':
					g.applyRemoteMove(msg);
					setGone(null);
					break;
				case 'game_end':
					g.setEnd(msg);
					sys(statusLabel(msg.status) ?? 'Game over');
					break;
				case 'draw_offer':
					g.setDrawOffer(msg.by);
					if (msg.by) sys(`${side(msg.by)} offers a draw`);
					if (msg.by && msg.by !== g.myColor) play('notify');
					break;
				case 'takeback_offer':
					g.setSetting({ takebackOffer: msg.by });
					if (msg.by) sys(`${side(msg.by)} proposes a takeback`);
					if (msg.by && msg.by !== g.myColor) play('notify');
					break;
				case 'chat':
					setChat((prev) => [...prev, { user: msg.user.name, text: msg.text, at: msg.at }]);
					break;
				case 'rematch_offer':
					setRematchBy(msg.by);
					if (msg.by && msg.by !== g.myColor) play('notify');
					break;
				case 'watchers':
					g.setSetting({ watchers: msg.n });
					break;
				case 'presence':
					g.setSetting({ presence: { white: msg.white, black: msg.black } });
					if (msg.white && msg.black) setGone(null);
					break;
				case 'clock':
					g.setSetting({ clock: msg.clock });
					break;
				case 'gone':
					setGone(msg.color);
					sys(`${side(msg.color)} left the game`);
					break;
			}
		});
		return () => {
			unsub();
			send({ t: 'unwatch', game_id: id });
		};
	}, [id, connected]);

	// per-game local state resets only when the game changes, not on reconnect
	useEffect(() => {
		setChat([]);
		setRematchBy(null);
		setGone(null);
	}, [id]);

	// Tab title (and a desktop notification) tell you it's your move even when the tab is hidden.
	useEffect(() => {
		const mine = status.kind === 'playing' && myColor === turn;
		document.title = mine ? '● Your move – Rubrik Chess' : 'Rubrik Chess';
		if (mine) notify('Your move', `${players.white?.name} vs ${players.black?.name}`);
		return () => {
			document.title = 'Rubrik Chess';
		};
	}, [status, myColor, turn, players]);

	const bottom: Color = flipped ? 'black' : 'white';
	const top: Color = flipped ? 'white' : 'black';
	const over = status.kind !== 'playing';
	const banner = over ? statusLabel(status) : myColor === turn ? 'Your move' : `${side(turn)} to move`;

	return (
		<BoardPage
			banner={banner}
			left={
				<>
					<div className="box p-3 text-sm flex flex-col gap-1">
						<div className="font-semibold">
							{clock ? `${clock.initial_ms / 60000}+${clock.increment_ms / 1000}` : '—'}{' '}
							<span className="text-muted-foreground font-normal">
								· {game().config?.rules.walled ? 'walled' : 'standard'} · rated
							</span>
						</div>
						<div className="text-xs text-muted-foreground">
							Game <span className="font-mono">{id}</span>
						</div>
					</div>
					{id && players.white && players.black && (
						<Crosstable white={players.white} black={players.black} gameId={id} />
					)}
					{id && <Chat gameId={id} lines={chat} watchers={watchers} className="flex-1" />}
				</>
			}
			right={
				<>
					<PlayerBar color={top} player={players[top]} ms={remaining(top)} />
					<MoveList className="flex-1 min-h-40 lg:min-h-0" />
					{id && <RoundControls gameId={id} gone={gone} rematchBy={rematchBy} />}
					<PlayerBar color={bottom} player={players[bottom]} ms={remaining(bottom)} />
				</>
			}
			below={id && <Chat gameId={id} lines={chat} watchers={watchers} className="h-56" />}
		/>
	);
}
