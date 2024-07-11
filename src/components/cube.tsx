import { useGameStore } from '../store/game';
import { vkey } from '../utils/funcs';
import { Cell } from './cell';

type CubeProps = {};

export function Cube({}: CubeProps) {
	const [getFlattenCells] = useGameStore((store) => [store.getFlattenCells]);
	const flattenCells = getFlattenCells();
	return (
		<>
			{flattenCells.map((cell) => {
				return <Cell key={vkey(cell.cord)} cell={cell} />;
			})}
		</>
	);
}
