import { BoardPage } from '@/components/round/board-page';
import { MoveList } from '@/components/round/move-list';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { game, localConfig, useGameStore } from '@/store/game';
import { statusLabel } from '@/utils/ui';
import { AI_LEVELS } from '@/ai';
import { Color } from '@/types';
import { cn } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

/** `/local` = sandbox; `/local?ai=3&color=white` = play the engine (level 1..4) as white. */
export function LocalPage() {
	const [params] = useSearchParams();
	const { history, turn, status, animating, walled, debug, flipped, ai } = useGameStore(
		useShallow((s) => ({
			history: s.history,
			turn: s.turn,
			status: s.status,
			animating: s.animating,
			walled: s.walled,
			debug: s.debug,
			flipped: s.flipped,
			ai: s.ai,
		})),
	);
	const [level, setLevel] = useState(Number(params.get('ai')) || 3);
	const [color, setColor] = useState<Color>(params.get('color') === 'black' ? 'black' : 'white');
	const vsAi = params.has('ai');

	const start = (opts: { walled?: boolean; level?: number; color?: Color } = {}) => {
		const w = opts.walled ?? game().walled;
		const l = opts.level ?? level;
		const c = opts.color ?? color;
		game().newLocal(localConfig(w), vsAi ? { color: c === 'white' ? 'black' : 'white', level: l } : null);
	};

	useEffect(() => {
		start();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vsAi]);

	const thinking = !!ai && ai.color === turn && status.kind === 'playing';
	const banner =
		statusLabel(status) ??
		(ai ? (thinking ? 'Computer is thinking…' : 'Your move') : `${turn === 'white' ? 'White' : 'Black'} to move`);

	return (
		<BoardPage
			banner={banner}
			right={
				<>
					<div className="box p-3 flex flex-col gap-3 text-sm">
						<div className="font-semibold">{vsAi ? 'Play the computer' : 'Sandbox'}</div>
						<p className="text-xs text-muted-foreground">
							{vsAi ? 'A material-counting engine. ' : 'Both sides on one board. '}
							Click a piece, then a highlighted cell. Arrow keys replay, <kbd className="font-mono">f</kbd> flips.
						</p>
						{vsAi && (
							<>
								<label className="flex items-center justify-between gap-2">
									Strength
									<select
										className="field"
										value={level}
										onChange={(e) => {
											setLevel(Number(e.target.value));
											start({ level: Number(e.target.value) });
										}}
									>
										{AI_LEVELS.map((name, i) => (
											<option key={name} value={i + 1}>
												{i + 1} · {name}
											</option>
										))}
									</select>
								</label>
								<div className="flex items-center justify-between gap-2">
									You play
									<div className="flex rounded border border-border overflow-hidden">
										{(['white', 'black'] as Color[]).map((c) => (
											<button
												key={c}
												className={cn('px-3 py-1 capitalize', color === c ? 'bg-accent text-foreground' : 'text-muted-foreground')}
												onClick={() => {
													setColor(c);
													start({ color: c });
												}}
											>
												{c}
											</button>
										))}
									</div>
								</div>
							</>
						)}
						<label className="flex items-center justify-between">
							Walled variant
							<Switch
								checked={walled}
								onCheckedChange={(checked) => {
									game().setSetting({ walled: checked });
									start({ walled: checked });
								}}
							/>
						</label>
						<label className="flex items-center justify-between">
							Cell ids (debug)
							<Switch checked={debug} onCheckedChange={(checked) => game().setSetting({ debug: checked })} />
						</label>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								disabled={animating || history.length === 0 || thinking}
								onClick={() => game().undo()}
							>
								Undo
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								onClick={() => game().setSetting({ flipped: !flipped })}
							>
								Flip
							</Button>
							<Button
								variant="secondary"
								size="sm"
								className="flex-1"
								onClick={() => start()}
							>
								Restart
							</Button>
						</div>
					</div>
					<MoveList className="flex-1 min-h-40 lg:min-h-0" />
				</>
			}
		/>
	);
}
