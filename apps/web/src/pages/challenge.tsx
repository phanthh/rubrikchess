import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { getChallenge } from '@/net/api';
import { send, useNetStore } from '@/net/ws';
import { variantLabel } from '@/store/game';
import { Challenge } from '@/types';
import { clockLabel, speedOf } from '@/utils/clock';
import { Copy, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

export function ChallengePage() {
	const { id } = useParams();
	const navigate = useNavigate();
	const me = useNetStore((s) => s.me);
	const [c, setC] = useState<Challenge | null>(null);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		if (!id) return;
		getChallenge(id).then(setC).catch(() => setMissing(true));
	}, [id]);

	const url = location.href;
	const own = !!c && !!me && c.user.id === me.id;
	const yours = c ? (c.color === 'random' ? 'random' : c.color === 'white' ? 'black' : 'white') : '';

	return (
		<Shell>
			<div className="box max-w-md mx-auto">
				<div className="box-title">Challenge</div>
				<div className="p-4 flex flex-col gap-4 text-sm">
					{missing && (
						<>
							<p>This challenge no longer exists (expired, cancelled or already accepted).</p>
							<Link to="/">Back to the lobby</Link>
						</>
					)}
					{c && (
						<>
							<div className="text-center">
								<div className="text-3xl font-bold font-mono">{clockLabel(c.clock)}</div>
								<div className="text-xs text-muted-foreground">
									{speedOf(c.clock)} · {variantLabel(c.walled, c.layout)} · rated
								</div>
							</div>
							{own ? (
								<>
									<p className="flex items-center gap-2 justify-center text-muted-foreground">
										<Loader2 className="h-4 w-4 animate-spin" /> Waiting for a friend to join…
									</p>
									<p className="text-xs text-muted-foreground">Send this link to anyone. The first to open it plays you.</p>
									<div className="flex gap-2">
										<input className="field flex-1 font-mono text-xs" readOnly value={url} onFocus={(e) => e.target.select()} />
										<Button
											variant="outline"
											size="icon"
											title="Copy"
											onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))}
										>
											<Copy className="h-4 w-4" />
										</Button>
									</div>
									<Button
										variant="outline"
										onClick={() => {
											send({ t: 'cancel_challenge' });
											navigate('/');
										}}
									>
										Cancel
									</Button>
								</>
							) : (
								<>
									<p className="text-center">
										<b>{c.user.name}</b> <span className="text-brag">{Math.round(c.user.rating)}</span> challenges you.
										You play {yours}.
									</p>
									<Button size="lg" variant="secondary" disabled={!me} onClick={() => id && send({ t: 'join', challenge_id: id })}>
										Accept
									</Button>
									<Link to="/" className="text-center text-xs">
										Decline
									</Link>
								</>
							)}
						</>
					)}
				</div>
			</div>
		</Shell>
	);
}
