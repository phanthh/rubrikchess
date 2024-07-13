import { animation } from '@/store/animation';
import { game, useGameStore } from '@/store/game';
import { useFrame } from '@react-three/fiber';

type AnimatorProps = {};
export function Animator(props: AnimatorProps) {
	const state = useGameStore((store) => store.state);
	useFrame(() => {
		if (state === 'play:animate') {
			const { cellRefs, cells, animation: ani } = animation();
			if (!cells || !ani) return;

			let progressDelta = 0;

			switch (ani.type) {
				case 'rotate':
					const { angle, axis } = ani;
					const delta = 0.03;
					progressDelta = delta / Math.abs(angle);
					for (const cell of cells) {
						const mesh = cellRefs[cell.id].current;
						if (!mesh) continue;
						mesh.position.applyAxisAngle(axis, delta * Math.sign(angle));
						mesh.rotateOnWorldAxis(axis, delta * Math.sign(angle));
					}
					break;
				case 'path':
					break;
				default:
					break;
			}

			animation().set((state) => ({
				progress: state.progress + progressDelta,
			}));

			if (animation().progress > 1) {
				game().set({ state: 'play:pick-piece' });
				animation().onEnd?.();
				animation().reset();
			}
		}
	});
	return null;
}
