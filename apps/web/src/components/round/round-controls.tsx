import { Button } from '@/components/ui/button';
import { send } from '@/net/ws';
import { game, useGameStore } from '@/store/game';
import { prefs } from '@/store/prefs';
import { Color } from '@/types';
import { moveText } from '@/utils/notation';
import { cn, statusLabel } from '@/utils/ui';
import { Check, Download, Flag, RefreshCw, Undo2, X } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

type Confirm = 'resign' | 'draw' | null;

function IconBtn({
	title,
	onClick,
	children,
	className,
	disabled,
}: {
	title: string;
	onClick: () => void;
	children: ReactNode;
	className?: string;
	disabled?: boolean;
}) {
	return (
		<button
			title={title}
			onClick={onClick}
			disabled={disabled}
			className={cn(
				'flex-1 flex items-center justify-center py-2 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent',
				className,
			)}
		>
			{children}
		</button>
	);
}

/** Yes/no banner used for incoming offers and in-place confirmations. */
function Question({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
	return (
		<div className="flex items-center gap-1 px-2 py-1.5 bg-primary/10 text-sm">
			<button className="p-1.5 rounded hover:bg-secondary/30 text-secondary" onClick={onYes} title="Accept">
				<Check className="h-4 w-4" />
			</button>
			<span className="flex-1 text-center">{text}</span>
			<button className="p-1.5 rounded hover:bg-destructive/30 text-destructive" onClick={onNo} title="Decline">
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}

function exportGame() {
	const { gameId, history, sans, config, players } = game();
	const blob = new Blob(
		[
			JSON.stringify(
				{
					id: gameId,
					white: players.white?.name,
					black: players.black?.name,
					config,
					moves: history,
					text: moveText(sans),
				},
				null,
				2,
			),
		],
		{ type: 'application/json' },
	);
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `rubrik-${gameId ?? 'local'}.json`;
	a.click();
	URL.revokeObjectURL(a.href);
}

export function RoundControls({
	gameId,
	gone,
	rematchBy,
}: {
	gameId: string;
	gone: Color | null;
	rematchBy: Color | null;
}) {
	const { status, myColor, drawOffer, takebackOffer, history, diffs, flipped } = useGameStore(
		useShallow((s) => ({
			status: s.status,
			myColor: s.myColor,
			drawOffer: s.drawOffer,
			takebackOffer: s.takebackOffer,
			history: s.history,
			diffs: s.diffs,
			flipped: s.flipped,
		})),
	);
	const [confirm, setConfirm] = useState<Confirm>(null);
	const over = status.kind !== 'playing';
	const opp = myColor === 'white' ? 'black' : 'white';

	const act = (kind: Exclude<Confirm, null>) => {
		if (kind === 'resign') send({ t: 'resign', game_id: gameId });
		else send({ t: 'draw', game_id: gameId, offer: true });
		setConfirm(null);
	};

	const flip = (
		<IconBtn title="Flip board (f)" onClick={() => game().setSetting({ flipped: !flipped })}>
			<RefreshCw className="h-4 w-4" />
		</IconBtn>
	);
	const download = (
		<IconBtn title="Export game" onClick={exportGame} disabled={history.length === 0}>
			<Download className="h-4 w-4" />
		</IconBtn>
	);

	if (over) {
		const won = status.kind === 'won' ? status.winner : null;
		const myDiff = myColor ? diffs[myColor] : null;
		return (
			<div className="box flex flex-col">
				<div className="px-3 py-3 text-center border-b border-border/60">
					<div
						className={cn(
							'text-lg font-bold',
							myColor && won === myColor && 'text-secondary',
							myColor && won && won !== myColor && 'text-destructive',
						)}
					>
						{won ? (myColor ? (won === myColor ? 'You won' : 'You lost') : `${won === 'white' ? 'White' : 'Black'} wins`) : 'Draw'}
					</div>
					<div className="text-xs text-muted-foreground">{statusLabel(status)}</div>
					{myDiff !== null && myDiff !== undefined && (
						<div className={cn('text-sm mt-1', myDiff >= 0 ? 'text-secondary' : 'text-destructive')}>
							{myDiff >= 0 ? '+' : '−'}
							{Math.abs(myDiff)} rating
						</div>
					)}
				</div>
				{myColor && rematchBy && rematchBy !== myColor && (
					<Question
						text="Opponent wants a rematch"
						onYes={() => send({ t: 'rematch', game_id: gameId, offer: true })}
						onNo={() => send({ t: 'rematch', game_id: gameId, offer: false })}
					/>
				)}
				<div className="flex flex-col gap-2 p-2">
					{myColor && !(rematchBy && rematchBy !== myColor) && (
						<Button
							variant={rematchBy === myColor ? 'outline' : 'secondary'}
							onClick={() => send({ t: 'rematch', game_id: gameId, offer: rematchBy !== myColor })}
						>
							{rematchBy === myColor ? 'Cancel rematch offer' : 'Rematch'}
						</Button>
					)}
					<Button variant="outline" asChild>
						<Link to="/" className="hover:no-underline text-foreground">
							{myColor ? 'New opponent' : 'Back to lobby'}
						</Link>
					</Button>
				</div>
				<div className="flex border-t border-border/60">
					{flip}
					{download}
				</div>
			</div>
		);
	}

	if (!myColor) {
		return (
			<div className="box flex">
				{flip}
				{download}
			</div>
		);
	}

	return (
		<div className="box flex flex-col">
			{drawOffer === opp && (
				<Question
					text="Opponent offers a draw"
					onYes={() => send({ t: 'draw', game_id: gameId, offer: true })}
					onNo={() => send({ t: 'draw', game_id: gameId, offer: false })}
				/>
			)}
			{takebackOffer === opp && (
				<Question
					text="Opponent asks for a takeback"
					onYes={() => send({ t: 'takeback', game_id: gameId, offer: true })}
					onNo={() => send({ t: 'takeback', game_id: gameId, offer: false })}
				/>
			)}
			{drawOffer === myColor && (
				<div className="px-2 py-1.5 text-xs text-center text-muted-foreground">
					Draw offered ·{' '}
					<button className="underline" onClick={() => send({ t: 'draw', game_id: gameId, offer: false })}>
						withdraw
					</button>
				</div>
			)}
			{takebackOffer === myColor && (
				<div className="px-2 py-1.5 text-xs text-center text-muted-foreground">
					Takeback requested ·{' '}
					<button className="underline" onClick={() => send({ t: 'takeback', game_id: gameId, offer: false })}>
						withdraw
					</button>
				</div>
			)}
			{gone === opp && (
				<div className="px-2 py-2 flex flex-col gap-1.5 bg-destructive/10 text-sm text-center">
					<span>Your opponent left the game.</span>
					<Button size="sm" variant="destructive" onClick={() => send({ t: 'claim', game_id: gameId })}>
						Claim victory
					</Button>
				</div>
			)}
			{confirm ? (
				<Question
					text={confirm === 'resign' ? 'Resign?' : 'Offer a draw?'}
					onYes={() => act(confirm)}
					onNo={() => setConfirm(null)}
				/>
			) : (
				<div className="flex">
					<IconBtn
						title="Propose a takeback"
						disabled={history.length === 0 || takebackOffer !== null}
						onClick={() => send({ t: 'takeback', game_id: gameId, offer: true })}
					>
						<Undo2 className="h-4 w-4" />
					</IconBtn>
					<IconBtn
						title="Offer a draw"
						disabled={drawOffer !== null}
						onClick={() => (prefs().confirmResign ? setConfirm('draw') : act('draw'))}
						className="font-bold text-base"
					>
						½
					</IconBtn>
					<IconBtn title="Resign" onClick={() => (prefs().confirmResign ? setConfirm('resign') : act('resign'))}>
						<Flag className="h-4 w-4" />
					</IconBtn>
					{flip}
					{download}
				</div>
			)}
		</div>
	);
}
