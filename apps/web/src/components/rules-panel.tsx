import { Dialog } from '@/components/ui/dialog';
import { PIECE_NAMES, PIECE_RULES } from '@/utils/consts';
import { PieceIcon } from '@/components/piece-glyph';
import { PieceKind } from '@/types';
import { CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

/** "?" button + rules dialog; rules text mirrors NOTES.md. */
export function RulesButton() {
	const [open, setOpen] = useState(false);

	return (
		<>
			<button
				className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
				title="Rules"
				onClick={() => setOpen(true)}
			>
				<CircleHelp className="h-4 w-4" />
			</button>
			<Dialog open={open} onClose={() => setOpen(false)} title="Rules" className="w-[42rem]">
				<p className="text-sm text-muted-foreground">
					<Link to="/learn" className="font-medium">
						Try each piece on an empty cube →
					</Link>
				</p>
				<p className="text-sm text-muted-foreground">
					Chess on a cube: 6 faces of 8x8. Pieces walk over the edges onto the next face. You win by
					capturing the enemy king; 100 plies without a capture is a draw. In the{' '}
					<span className="font-mono">walled</span> variant no piece may cross an edge, so every
					face is its own board.
				</p>
				<ul className="flex flex-col gap-2 text-sm">
					{(Object.keys(PIECE_RULES) as PieceKind[]).map((kind) => (
						<li key={kind} className="flex gap-2">
							<PieceIcon kind={kind} color="white" className="h-5 w-5 shrink-0" />
							<span>
								<span className="font-semibold">{PIECE_NAMES[kind]}</span> — {PIECE_RULES[kind]}
							</span>
						</li>
					))}
				</ul>
			</Dialog>
		</>
	);
}
