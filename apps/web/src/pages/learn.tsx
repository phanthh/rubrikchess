import { BoardPage } from '@/components/round/board-page';
import { game, localConfig, useGameStore } from '@/store/game';
import { PieceKind } from '@/types';
import { PIECE_NAMES, PIECE_RULES } from '@/utils/consts';
import { PIECE_LETTER } from '@/utils/notation';
import { toSetup } from '@/utils/setup';
import { cn } from '@/utils/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const KINDS: PieceKind[] = [
	'pawn',
	'knight',
	'bishop',
	'rook',
	'queen',
	'king',
	'prince',
	'princess',
	'captain',
	'cannon',
	'tesseract',
];

/** Front face (F, +Z) near its top-right edge, so most pieces show an edge crossing. */
const SHOWCASE = 2 * 64 + 5 * 8 + 5;
const WHITE_KING = 0; // U face corner
const BLACK_KING = 3 * 64 + 63; // D face far corner
const TARGET = 1 * 64 + 2 * 8 + 6; // a black pawn on the R face to capture

/** One piece on an otherwise empty cube with its legal moves lit up. */
export function LearnPage() {
	const [kind, setKind] = useState<PieceKind>('knight');
	const [walled, setWalled] = useState(false);
	const selected = useGameStore((s) => s.selected);
	const legal = useGameStore((s) => s.legal.length);

	useEffect(() => {
		const pieces = new Map([
			[WHITE_KING, { kind: 'king' as PieceKind, color: 'white' as const }],
			[BLACK_KING, { kind: 'king' as PieceKind, color: 'black' as const }],
			[TARGET, { kind: 'pawn' as PieceKind, color: 'black' as const }],
		]);
		pieces.set(SHOWCASE, { kind, color: 'white' });
		if (kind === 'king') pieces.delete(WHITE_KING);
		const config = localConfig(walled);
		config.setup = toSetup(pieces);
		game().newLocal(config);
		game().select(SHOWCASE);
	}, [kind, walled]);

	return (
		<BoardPage
			banner={`${PIECE_NAMES[kind]}: ${legal} legal move${legal === 1 ? '' : 's'}`}
			right={
				<>
					<div className="box p-3 text-sm flex flex-col gap-2">
						<div className="font-semibold">Learn the pieces</div>
						<p className="text-xs text-muted-foreground">
							The board is a cube: six 8×8 faces. White starts on the top face, black on the bottom;
							sliding pieces walk straight over an edge onto the next face, and the tesseract can
							rotate a whole slice of the cube. Toggle the 2D net (top-right of the board) to see
							all six faces at once.
						</p>
						<p className="text-xs text-muted-foreground">
							Green cells are where the {PIECE_NAMES[kind].toLowerCase()} may go; red is a capture.
							Play the move and click the piece again to keep exploring
							{selected === null && ' (click it to re-select)'}.
						</p>
						<div className="grid grid-cols-4 gap-1">
							{KINDS.map((k) => (
								<button
									key={k}
									onClick={() => setKind(k)}
									className={cn(
										'flex flex-col items-center py-1.5 rounded border border-border hover:bg-accent',
										k === kind && 'bg-accent ring-1 ring-primary',
									)}
								>
									<span className="font-mono font-bold text-base">{PIECE_LETTER[k] || 'P'}</span>
									<span className="text-[10px] text-muted-foreground">{PIECE_NAMES[k]}</span>
								</button>
							))}
						</div>
						<p className="text-sm">{PIECE_RULES[kind]}</p>
						<label className="flex items-center justify-between text-xs text-muted-foreground">
							Walled variant (no edge crossing)
							<input
								type="checkbox"
								checked={walled}
								onChange={(e) => setWalled(e.target.checked)}
								className="accent-primary"
							/>
						</label>
						<div className="text-xs text-muted-foreground">
							Ready? <Link to="/local?ai=2">Play the computer</Link> or{' '}
							<Link to="/">find an opponent</Link>.
						</div>
					</div>
				</>
			}
		/>
	);
}
