import { Dialog } from '@/components/ui/dialog';
import { CircleHelp } from 'lucide-react';
import { useState } from 'react';

const PIECES: [letter: string, name: string, rule: string][] = [
	[
		'p',
		'Pawn',
		'Moves to an empty cell one step away (also across an edge unless walled); captures diagonally. Any direction, no promotion.',
	],
	[
		'n',
		'Knight',
		'Chess knight leap, wrapped around the cube edges; walled keeps it on its own face.',
	],
	['b', 'Bishop', 'Diagonal walk, climbing over edges onto neighbouring faces (unless walled).'],
	['r', 'Rook', 'Orthogonal walk, climbing over edges onto neighbouring faces (unless walled).'],
	['q', 'Queen', 'Rook plus bishop.'],
	[
		'k',
		'King',
		'One step in any direction, straight or diagonal, across edges too (unless walled).',
	],
	['x', 'Prince', 'King moves, but only onto cells of its own colour.'],
	['s', 'Princess', 'Queen walk, but only over cells of its own colour.'],
	[
		'c',
		'Captain',
		'Moves to any empty cell reachable orthogonally over cells of its own colour; also king moves (captures allowed).',
	],
	[
		'o',
		'Cannon',
		'Captures or moves to the 4 cells found by rotating its position ±90° about the tangential axes; king moves without capturing.',
	],
	[
		't',
		'Tesseract',
		'King moves; or rotates its own slice of the cube by ±90° about the X, Y or Z axis, carrying every piece on it.',
	],
];

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
					Chess on a cube: 6 faces of 8x8. Pieces walk over the edges onto the next face. You win by
					capturing the enemy king. In the <span className="font-mono">walled</span> variant no piece
					may cross an edge, so every face is its own board.
				</p>
				<ul className="flex flex-col gap-2 text-sm">
					{PIECES.map(([letter, name, rule]) => (
						<li key={letter} className="flex gap-2">
							<span className="font-mono font-bold w-4 shrink-0 text-brag">{letter}</span>
							<span>
								<span className="font-semibold">{name}</span> — {rule}
							</span>
						</li>
					))}
				</ul>
			</Dialog>
		</>
	);
}
