import { useGameStore } from '../store/game';
import { Cell } from './cell';
import { CubeFrame } from './cube-frame';

type CubeProps = {};

export function Cube({}: CubeProps) {
	const cells = useGameStore((store) => store.cells);
	const walled = useGameStore((store) => store.walled);
	return (
		<>
			{cells.flat(3).map((cell) => {
				return <Cell key={cell.id} cell={cell} />;
			})}
			{walled && <CubeFrame />}
		</>
	);
}
