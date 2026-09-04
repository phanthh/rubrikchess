import { GameCanvas } from '@/components/game-canvas';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/tooltip';
import { game, localConfig, notation, useGameStore } from '@/store/game';
import { statusLabel } from '@/utils/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

export function LocalPage() {
	const { cursor, history, turn, status, animating, animate, walled, debug } = useGameStore(
		useShallow((store) => ({
			cursor: store.cursor,
			history: store.history,
			turn: store.turn,
			status: store.status,
			animating: store.animating,
			animate: store.animate,
			walled: store.walled,
			debug: store.debug,
		})),
	);

	useEffect(() => {
		game().newLocal(localConfig(game().walled));
	}, []);

	const label = statusLabel(status);

	return (
		<div className="w-screen overflow-hidden h-screen flex flex-col">
			<nav className="flex flex-wrap p-4 flex-row items-center gap-3 border-gray-500 border-2 bg-background">
				<Link to="/" className="text-foreground underline">
					Lobby
				</Link>
				<Button variant="outline" onClick={() => game().newLocal(localConfig(walled))}>
					Restart
				</Button>
				<Button variant="outline" disabled={animating || history.length === 0} onClick={() => game().undo()}>
					Undo
				</Button>
				<span className="text-foreground ml-auto">
					{label ?? `${turn === 'white' ? 'White' : 'Black'} to move`}
				</span>
				<span className="text-foreground">Walled:</span>
				<Switch
					checked={walled}
					onCheckedChange={(checked) => {
						game().setSetting({ walled: checked });
						game().newLocal(localConfig(checked));
					}}
				/>
				<span className="text-foreground">Animate:</span>
				<Switch
					checked={animate}
					onCheckedChange={(checked) => game().setSetting({ animate: checked })}
				/>
				<span className="text-foreground">Debug:</span>
				<Switch
					checked={debug}
					onCheckedChange={(checked) => game().setSetting({ debug: checked })}
				/>
			</nav>

			<GameCanvas />
			<Tooltip />

			<div className="fixed select-none p-2 bottom-2 left-1/2 translate-x-[-50%] rounded-lg border bg-card text-card-foreground shadow-sm">
				<div className="flex items-center px-2 gap-2">
					<Button
						onClick={() => game().setCursor(cursor - 1)}
						disabled={animating || cursor === 0}
						variant="outline"
						size="icon"
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<Button
						onClick={() => game().setCursor(cursor + 1)}
						disabled={animating || cursor === history.length}
						variant="outline"
						size="icon"
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<Slider
						min={0}
						max={history.length}
						step={1}
						value={[cursor]}
						onValueChange={(v) => game().setCursor(v[0])}
						className="w-[200px]"
					/>
					<span>
						{cursor} / {history.length}
					</span>
					<span className="text-muted-foreground w-24 text-right">
						{cursor > 0 ? notation(history[cursor - 1]) : ''}
					</span>
				</div>
			</div>
		</div>
	);
}
