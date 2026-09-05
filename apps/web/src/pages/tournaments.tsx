import { Shell } from '@/components/shell';
import { TournamentDialog } from '@/components/tournament-dialog';
import { Button } from '@/components/ui/button';
import { listTournaments } from '@/net/api';
import { onServerMsg } from '@/net/ws';
import { Tournament } from '@/types';
import { useEffect, useState } from 'react';
import { TourClock } from './tournament';
import { clockLabel, speedOf } from '@/utils/clock';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';

export function TourList({ items, empty }: { items: Tournament[]; empty: string }) {
	if (items.length === 0) return <div className="px-3 py-3 text-sm text-muted-foreground">{empty}</div>;
	return (
		<>
			{items.map((t) => (
				<Link key={t.id} to={`/tournament/${t.id}`} className="flex items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-accent/50 hover:no-underline">
					<Trophy className="h-4 w-4 text-brag shrink-0" />
					<div className="min-w-0 flex-1">
						<div className="truncate font-medium">{t.name}</div>
						<div className="text-xs text-muted-foreground">
							{clockLabel(t.clock)} {speedOf(t.clock)} · {t.players} players
						</div>
					</div>
					<div className="text-xs">
						<TourClock t={t} />
					</div>
				</Link>
			))}
		</>
	);
}

export function TournamentsPage() {
	const [data, setData] = useState<{ upcoming: Tournament[]; running: Tournament[]; finished: Tournament[] } | null>(null);
	const [create, setCreate] = useState(false);
	useEffect(() => {
		const load = () => listTournaments().then(setData).catch(() => undefined);
		load();
		// join/leave storms: coalesce reloads
		let t = 0;
		const unsub = onServerMsg((m) => {
			if (m.t !== 'tour') return;
			clearTimeout(t);
			t = window.setTimeout(load, 800);
		});
		return () => {
			clearTimeout(t);
			unsub();
		};
	}, []);
	return (
		<Shell>
			<div className="max-w-2xl mx-auto flex flex-col gap-4">
				<div className="flex items-center">
					<h1 className="text-xl font-bold mr-auto">Tournaments</h1>
					<Button variant="secondary" onClick={() => setCreate(true)}>
						New tournament
					</Button>
				</div>
				<section className="box">
					<div className="box-title">Running</div>
					<TourList items={data?.running ?? []} empty="No tournament is running." />
				</section>
				<section className="box">
					<div className="box-title">Upcoming</div>
					<TourList items={data?.upcoming ?? []} empty="Nothing scheduled — create one." />
				</section>
				<section className="box">
					<div className="box-title">Finished</div>
					<TourList items={data?.finished ?? []} empty="No finished tournaments yet." />
				</section>
			</div>
			<TournamentDialog open={create} onClose={() => setCreate(false)} />
		</Shell>
	);
}
