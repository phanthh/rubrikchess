import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { createTournament } from '@/net/api';
import { Layout } from '@/types';
import { clockLabel, speedOf } from '@/utils/clock';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const MINUTES = [0.5, 1, 2, 3, 5, 10, 15];
const INCREMENTS = [0, 1, 2, 3, 5];
const STARTS = [1, 2, 5, 10, 30, 60]; // minutes
const DURATIONS = [10, 20, 30, 45, 60, 90, 120]; // minutes

export function TournamentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const navigate = useNavigate();
	const [name, setName] = useState('');
	const [mi, setMi] = useState(2);
	const [ii, setIi] = useState(2);
	const [si, setSi] = useState(2);
	const [di, setDi] = useState(2);
	const [walled, setWalled] = useState(false);
	const [layout, setLayout] = useState<Layout>('standard');
	const [busy, setBusy] = useState(false);
	const clock = { initial_ms: MINUTES[mi] * 60_000, increment_ms: INCREMENTS[ii] * 1000 };

	const submit = async () => {
		setBusy(true);
		try {
			const t = await createTournament({
				name: name.trim(),
				clock,
				walled,
				layout,
				starts_in_ms: STARTS[si] * 60_000,
				duration_ms: DURATIONS[di] * 60_000,
			});
			onClose();
			navigate(`/tournament/${t.id}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const range = (label: string, value: string, i: number, set: (n: number) => void, max: number) => (
		<label className="text-sm flex flex-col gap-1">
			<span className="flex justify-between">
				{label} <b>{value}</b>
			</span>
			<input type="range" min={0} max={max} value={i} onChange={(e) => set(Number(e.target.value))} className="accent-primary" />
		</label>
	);

	return (
		<Dialog open={open} onClose={onClose} title="New arena tournament">
			<input className="field" placeholder="Tournament name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
			<div className="text-center">
				<div className="text-2xl font-bold font-mono">{clockLabel(clock)}</div>
				<div className="text-xs text-muted-foreground">{speedOf(clock)} arena</div>
			</div>
			{range('Minutes per side', String(MINUTES[mi]), mi, setMi, MINUTES.length - 1)}
			{range('Increment', `${INCREMENTS[ii]}s`, ii, setIi, INCREMENTS.length - 1)}
			{range('Starts in', `${STARTS[si]} min`, si, setSi, STARTS.length - 1)}
			{range('Duration', `${DURATIONS[di]} min`, di, setDi, DURATIONS.length - 1)}
			<label className="text-sm flex items-center justify-between">
				Walled variant <Switch checked={walled} onCheckedChange={setWalled} />
			</label>
			<label className="text-sm flex items-center justify-between">
				Rubrik colours <Switch checked={layout === 'rubrik'} onCheckedChange={(v) => setLayout(v ? 'rubrik' : 'standard')} />
			</label>
			<p className="text-xs text-muted-foreground">
				Arena: join any time, you are paired automatically as soon as you are free. Win 2 · draw 1 · loss 0.
			</p>
			<Button size="lg" variant="secondary" disabled={name.trim().length < 3 || busy} onClick={submit}>
				Create tournament
			</Button>
		</Dialog>
	);
}
