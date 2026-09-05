import { Net, NetCell } from '@/components/round/net';
import { Shell } from '@/components/shell';
import { SetupDialog } from '@/components/setup-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { baseConfig } from '@/store/game';
import { CellId, Color, GameState, PieceKind } from '@/types';
import { PIECE_NAMES } from '@/utils/consts';
import { PieceIcon } from '@/components/piece-glyph';
import { decodeSetup, encodeSetup, fromSetup, Placement, toSetup } from '@/utils/setup';
import { cn } from '@/utils/ui';
import { LAYOUTS } from '@/utils/variant';
import { vec } from '@/utils/funcs';
import { WasmGame } from 'rubrik-wasm';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

const KINDS: PieceKind[] = [
	'king',
	'queen',
	'rook',
	'bishop',
	'knight',
	'pawn',
	'prince',
	'princess',
	'captain',
	'cannon',
	'tesseract',
];

/** Board editor: place pieces on the unfolded net, then play the position locally. */
export function EditorPage() {
	const navigate = useNavigate();
	const [params] = useSearchParams();
	// prefilled from the analysis board (?setup=…&walled=1&layout=rubrik)
	const [pieces, setPieces] = useState<Map<CellId, Placement>>(() =>
		fromSetup(params.get('setup') ? decodeSetup(params.get('setup')!) : baseConfig().setup),
	);
	const [brush, setBrush] = useState<Placement | null>({ kind: 'pawn', color: 'white' });
	const [walled, setWalled] = useState(params.get('walled') === '1');
	const [rubrik, setRubrik] = useState(params.get('layout') === 'rubrik');
	const [challenge, setChallenge] = useState(false);

	// initial geometry: cell id ↔ position, before any rotation
	const base = useMemo(() => {
		const cfg = baseConfig();
		cfg.layout = LAYOUTS[rubrik ? 'rubrik' : 'standard'];
		const g = new WasmGame(cfg);
		const cells = (g.state() as GameState).board.cells.map((c, id) => ({
			id,
			pos: vec(c.pos.x, c.pos.y, c.pos.z),
			color: c.color,
		}));
		g.free();
		return cells;
	}, [rubrik]);

	const cells: NetCell[] = base.map((c) => {
		const p = pieces.get(c.id);
		return { ...c, piece: p ? { ...p, id: c.id } : null, state: 'normal' };
	});

	const paint = (id: CellId) => {
		const next = new Map(pieces);
		const cur = pieces.get(id);
		if (!brush || (cur && cur.kind === brush.kind && cur.color === brush.color)) next.delete(id);
		else next.set(id, brush);
		setPieces(next);
	};

	const kings = { white: 0, black: 0 };
	for (const p of pieces.values()) if (p.kind === 'king') kings[p.color]++;
	const valid = kings.white === 1 && kings.black === 1;
	const query = () =>
		`setup=${encodeURIComponent(encodeSetup(toSetup(pieces)))}${walled ? '&walled=1' : ''}${rubrik ? '&layout=rubrik' : ''}`;

	return (
		<Shell>
			<div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
				<div className="box p-3 bg-[#101010]">
					<Net cells={cells} onCell={paint} className="max-h-[70vh]" />
				</div>
				<div className="flex flex-col gap-3">
					<div className="box p-3 text-sm flex flex-col gap-2">
						<div className="font-semibold">Board editor</div>
						<p className="text-xs text-muted-foreground">
							Pick a piece, click cells to place it; click again to remove. One king per side is
							required.
						</p>
						{(['white', 'black'] as Color[]).map((color) => (
							<div key={color} className="grid grid-cols-6 gap-1">
								{KINDS.map((kind) => {
									const on = brush?.kind === kind && brush.color === color;
									return (
										<button
											key={kind}
											title={PIECE_NAMES[kind]}
											onClick={() => setBrush({ kind, color })}
											className={cn(
												'h-9 rounded border flex items-center justify-center',
												color === 'white'
													? 'bg-neutral-100 text-neutral-900 border-neutral-400'
													: 'bg-neutral-900 text-neutral-100 border-neutral-600',
												on && 'ring-2 ring-primary',
											)}
										>
											<PieceIcon kind={kind} color={color} className="h-7 w-7" />
										</button>
									);
								})}
								<button
									title="Eraser"
									onClick={() => setBrush(null)}
									className={cn(
										'h-9 rounded border border-dashed text-muted-foreground',
										brush === null && 'ring-2 ring-primary',
									)}
								>
									×
								</button>
							</div>
						))}
						<div className="flex gap-2 pt-1">
							<Button
								size="sm"
								variant="outline"
								className="flex-1"
								onClick={() => setPieces(new Map())}
							>
								Clear
							</Button>
							<Button
								size="sm"
								variant="outline"
								className="flex-1"
								onClick={() => setPieces(fromSetup(baseConfig().setup))}
							>
								Standard
							</Button>
						</div>
					</div>
					<div className="box p-3 text-sm flex flex-col gap-3">
						<label className="flex items-center justify-between">
							Walled variant <Switch checked={walled} onCheckedChange={setWalled} />
						</label>
						<label className="flex items-center justify-between">
							Rubrik colours <Switch checked={rubrik} onCheckedChange={setRubrik} />
						</label>
						{!valid && (
							<div className="text-xs text-destructive">Each side needs exactly one king.</div>
						)}
						<Button
							variant="secondary"
							disabled={!valid}
							onClick={() => navigate(`/local?${query()}`)}
						>
							Play in sandbox
						</Button>
						<Button
							variant="outline"
							disabled={!valid}
							onClick={() => navigate(`/local?ai=3&${query()}`)}
						>
							Play vs computer
						</Button>
						<Button variant="outline" disabled={!valid} onClick={() => setChallenge(true)}>
							Challenge a friend
						</Button>
						<Link to="/local" className="text-xs text-center">
							Back to the sandbox
						</Link>
					</div>
				</div>
			</div>
			<SetupDialog
				mode={challenge ? 'friend' : null}
				onClose={() => setChallenge(false)}
				position={{ setup: toSetup(pieces), walled, layout: rubrik ? 'rubrik' : 'standard' }}
			/>
		</Shell>
	);
}
