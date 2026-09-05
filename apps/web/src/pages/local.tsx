import { GameCanvas } from '@/components/game-canvas';
import { MoveList } from '@/components/round/move-list';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { game, localConfig, useGameStore } from '@/store/game';
import { statusLabel } from '@/utils/ui';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

export function LocalPage() {
	const { history, turn, status, animating, walled, debug, flipped, cursor } = useGameStore(
		useShallow((s) => ({
			history: s.history,
			turn: s.turn,
			status: s.status,
			animating: s.animating,
			walled: s.walled,
			debug: s.debug,
			flipped: s.flipped,
			cursor: s.cursor,
		})),
	);

	useEffect(() => {
		game().newLocal(localConfig(game().walled));
	}, []);

	const banner = statusLabel(status) ?? `${turn === 'white' ? 'White' : 'Black'} to move`;

	return (
		<Shell fill>
			<div className="h-full flex flex-col lg:flex-row lg:gap-3 lg:p-3 overflow-y-auto lg:overflow-hidden">
				<div className="relative flex-1 min-h-[55vh] shrink-0 lg:shrink lg:min-h-0 lg:rounded-md overflow-hidden">
					<GameCanvas />
					<div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-xs text-white/90 backdrop-blur">
						{banner}
						{cursor !== history.length && ` · viewing move ${cursor}/${history.length}`}
					</div>
				</div>
				<aside className="w-full lg:w-72 shrink-0 flex flex-col gap-2 p-2 lg:p-0 min-h-0">
					<div className="box p-3 flex flex-col gap-3 text-sm">
						<div className="font-semibold">Sandbox</div>
						<p className="text-xs text-muted-foreground">
							Both sides on one board. Click a piece, then a highlighted cell. Arrow keys replay,{' '}
							<kbd className="font-mono">f</kbd> flips.
						</p>
						<label className="flex items-center justify-between">
							Walled variant
							<Switch
								checked={walled}
								onCheckedChange={(checked) => {
									game().setSetting({ walled: checked });
									game().newLocal(localConfig(checked));
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
								disabled={animating || history.length === 0}
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
								onClick={() => game().newLocal(localConfig(walled))}
							>
								Restart
							</Button>
						</div>
					</div>
					<MoveList className="flex-1 min-h-40 lg:min-h-0" />
				</aside>
			</div>
		</Shell>
	);
}
