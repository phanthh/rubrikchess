import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ClockTenths, usePrefs } from '@/store/prefs';
import { BOARD_THEMES, BoardTheme } from '@/utils/consts';
import { play } from '@/utils/sound';
import { ReactNode } from 'react';

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="flex items-center justify-between gap-4 text-sm">
			<span>{label}</span>
			{children}
		</label>
	);
}

export function PrefsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const p = usePrefs();
	return (
		<Dialog open={open} onClose={onClose} title="Preferences">
			<Row label="Theme">
				<select
					className="field"
					value={p.theme}
					onChange={(e) => p.set({ theme: e.target.value as 'dark' | 'light' })}
				>
					<option value="dark">Dark</option>
					<option value="light">Light</option>
				</select>
			</Row>
			<Row label="Board colours">
				<select
					className="field capitalize"
					value={p.boardTheme}
					onChange={(e) => p.set({ boardTheme: e.target.value as BoardTheme })}
				>
					{(Object.keys(BOARD_THEMES) as BoardTheme[]).map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
			</Row>
			<Row label="Highlight last move">
				<Switch
					checked={p.highlightLastMove}
					onCheckedChange={(highlightLastMove) => p.set({ highlightLastMove })}
				/>
			</Row>
			<Row label="Sound">
				<Switch
					checked={p.sound}
					onCheckedChange={(sound) => {
						p.set({ sound });
						if (sound) play('move');
					}}
				/>
			</Row>
			<Row label="Volume">
				<input
					type="range"
					min={0}
					max={1}
					step={0.05}
					value={p.volume}
					disabled={!p.sound}
					onChange={(e) => p.set({ volume: Number(e.target.value) })}
					onMouseUp={() => play('move')}
					className="w-32 accent-primary"
				/>
			</Row>
			<Row label="Animate moves">
				<Switch checked={p.animate} onCheckedChange={(animate) => p.set({ animate })} />
			</Row>
			<Row label="Show threats to your king">
				<Switch checked={p.showThreats} onCheckedChange={(showThreats) => p.set({ showThreats })} />
			</Row>
			<Row label="Confirm moves before sending">
				<Switch checked={p.confirmMove} onCheckedChange={(confirmMove) => p.set({ confirmMove })} />
			</Row>
			<Row label="Confirm resign / draw">
				<Switch
					checked={p.confirmResign}
					onCheckedChange={(confirmResign) => p.set({ confirmResign })}
				/>
			</Row>
			<Row label="Clock tenths">
				<select
					className="field"
					value={p.clockTenths}
					onChange={(e) => p.set({ clockTenths: e.target.value as ClockTenths })}
				>
					<option value="never">Never</option>
					<option value="lowtime">Under 10 seconds</option>
					<option value="always">Always</option>
				</select>
			</Row>
			<Row label="Clock time bar">
				<Switch checked={p.clockBar} onCheckedChange={(clockBar) => p.set({ clockBar })} />
			</Row>
		</Dialog>
	);
}
