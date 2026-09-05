import { GameRowItem } from '@/components/game-row';
import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { listGames, listGamesBefore } from '@/net/api';
import { GameRow } from '@/types';
import { useEffect, useState } from 'react';

const PAGE = 30;

export function GamesPage() {
	const [games, setGames] = useState<GameRow[]>([]);
	const [done, setDone] = useState(false);
	const [busy, setBusy] = useState(false);

	const more = async () => {
		setBusy(true);
		try {
			const last = games[games.length - 1];
			const next = last ? await listGamesBefore(last.created_at, PAGE) : await listGames(PAGE);
			// StrictMode double-fires the initial load; keep rows unique
			setGames((prev) => {
				const seen = new Set(prev.map((g) => g.id));
				return [...prev, ...next.filter((g) => !seen.has(g.id))];
			});
			if (next.length < PAGE) setDone(true);
		} finally {
			setBusy(false);
		}
	};

	useEffect(() => {
		void more();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<Shell>
			<div className="box max-w-3xl mx-auto">
				<div className="box-title">All games</div>
				{games.map((g) => (
					<GameRowItem key={g.id} g={g} />
				))}
				{games.length === 0 && !busy && <div className="p-4 text-sm text-muted-foreground">No games yet.</div>}
				{!done && (
					<div className="p-3 flex justify-center border-t border-border/40">
						<Button variant="outline" size="sm" disabled={busy} onClick={more}>
							{busy ? 'Loading…' : 'Load more'}
						</Button>
					</div>
				)}
			</div>
		</Shell>
	);
}
