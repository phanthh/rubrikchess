import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { send } from '@/net/ws';
import { Layout, SeekColor } from '@/types';
import { clockLabel, speedOf, unlimited } from '@/utils/clock';
import { cn } from '@/utils/ui';
import { useState } from 'react';

export type SetupMode = 'seek' | 'friend';

/** Non-linear minute steps, like lichess' time slider. */
const MINUTES = [
	0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 45, 60, 90, 120, 180,
];
const INCREMENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 45, 60, 90, 120, 180];

const COLORS: [SeekColor, string][] = [
	['white', 'White'],
	['random', 'Random'],
	['black', 'Black'],
];

export function SetupDialog({
	mode,
	onClose,
	opponent,
	position,
}: {
	mode: SetupMode | null;
	onClose: () => void;
	opponent?: string;
	/** Board-editor position: `{setup, walled, layout}`; only friend challenges support it. */
	position?: { setup: string; walled: boolean; layout: Layout };
}) {
	const [mi, setMi] = useState(9); // 5 min
	const [ii, setIi] = useState(3); // 3 s
	const [walled, setWalled] = useState(position?.walled ?? false);
	const [layout, setLayout] = useState<Layout>(position?.layout ?? 'standard');
	const [to, setTo] = useState(opponent ?? '');
	const [color, setColor] = useState<SeekColor>('random');
	const clock = { initial_ms: MINUTES[mi] * 60_000, increment_ms: INCREMENTS[ii] * 1000 };

	const submit = () => {
		if (mode === 'friend')
			send({
				t: 'challenge',
				clock,
				walled,
				color,
				layout,
				to: to.trim() || undefined,
				setup: position?.setup,
			});
		else send({ t: 'seek', clock, walled, color, layout });
		onClose();
	};

	return (
		<Dialog
			open={mode !== null}
			onClose={onClose}
			title={mode === 'friend' ? 'Play with a friend' : 'Create a game'}
		>
			{position && (
				<div className="text-xs text-center text-brag">Custom position from the board editor</div>
			)}
			<div className="text-center">
				<div className="text-3xl font-bold font-mono">{clockLabel(clock)}</div>
				<div className="text-xs text-muted-foreground">
					{speedOf(clock)}
					{unlimited(clock) && ' · no clock, play whenever'}
				</div>
			</div>
			{mode === 'friend' && (
				<label className="text-sm flex flex-col gap-1">
					<span>
						Opponent{' '}
						<span className="text-xs text-muted-foreground">
							(username; leave empty for a shareable link)
						</span>
					</span>
					<input
						className="field"
						value={to}
						onChange={(e) => setTo(e.target.value)}
						placeholder="anyone with the link"
						autoComplete="off"
					/>
				</label>
			)}
			<label className="text-sm flex flex-col gap-1">
				<span className="flex justify-between">
					Minutes per side <b>{MINUTES[mi]}</b>
				</span>
				<input
					type="range"
					min={0}
					max={MINUTES.length - 1}
					value={mi}
					onChange={(e) => setMi(Number(e.target.value))}
					className="accent-primary"
				/>
			</label>
			<label className="text-sm flex flex-col gap-1">
				<span className="flex justify-between">
					Increment in seconds <b>{INCREMENTS[ii]}</b>
				</span>
				<input
					type="range"
					min={0}
					max={INCREMENTS.length - 1}
					value={ii}
					onChange={(e) => setIi(Number(e.target.value))}
					className="accent-primary"
				/>
			</label>
			<label className="text-sm flex items-center justify-between">
				<span>
					Walled variant
					<span className="block text-xs text-muted-foreground">
						Pieces may not cross cube edges
					</span>
				</span>
				<Switch checked={walled} onCheckedChange={setWalled} />
			</label>
			<label className="text-sm flex items-center justify-between">
				<span>
					Rubrik colours
					<span className="block text-xs text-muted-foreground">
						Six face colours; prince, princess and captain follow them
					</span>
				</span>
				<Switch
					checked={layout === 'rubrik'}
					onCheckedChange={(v) => setLayout(v ? 'rubrik' : 'standard')}
				/>
			</label>
			<div className="text-sm">
				<div className="mb-1">Your colour</div>
				<div className="grid grid-cols-3 gap-2">
					{COLORS.map(([c, label]) => (
						<button
							key={c}
							onClick={() => setColor(c)}
							className={cn(
								'flex flex-col items-center gap-1 py-2 rounded border border-border hover:bg-accent',
								color === c && 'ring-2 ring-primary bg-accent',
							)}
						>
							<span
								className={cn(
									'h-6 w-6 rounded-sm border',
									c === 'white' && 'bg-white border-neutral-400',
									c === 'black' && 'bg-neutral-900 border-neutral-600',
									c === 'random' &&
										'bg-gradient-to-br from-white from-50% to-neutral-900 to-50% border-neutral-500',
								)}
							/>
							<span className="text-xs">{label}</span>
						</button>
					))}
				</div>
			</div>
			<Button size="lg" variant="secondary" onClick={submit}>
				{mode === 'friend'
					? to.trim()
						? `Challenge ${to.trim()}`
						: 'Create challenge link'
					: 'Create game'}
			</Button>
		</Dialog>
	);
}
