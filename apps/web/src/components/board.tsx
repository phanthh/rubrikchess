import { game, useGameStore } from '@/store/game';
import { usePrefs } from '@/store/prefs';
import { TCell } from '@/types';
import { CUBOIDS } from '@/utils/cuboids';
import { useCallback } from 'react';
import { Animator } from './animator';
import { Cell } from './cell';
import { CubeFrame } from './cube-frame';
import { Cuboid } from './cuboid';

export function Board() {
	const cells = useGameStore((store) => store.cells);
	const walled = useGameStore((store) => store.config?.rules.walled ?? false);
	const animate = usePrefs((s) => s.animate);

	const handlePick = useCallback((cell: TCell) => {
		if (cell.move) {
			game().play(cell.move);
		} else {
			game().select(cell.state === 'active' ? null : cell.id);
		}
	}, []);

	return (
		<>
			{cells.map((cell) => (
				<Cell onPick={handlePick} key={'c' + cell.id} cell={cell} />
			))}
			{CUBOIDS.map((cuboid) => (
				<Cuboid key={'cc' + cuboid.id} cuboid={cuboid} />
			))}
			{walled && <CubeFrame />}
			{animate && <Animator />}
		</>
	);
}
