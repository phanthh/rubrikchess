import { animation } from '@/store/animation';
import { game, useGameStore } from '@/store/game';
import { useFrame } from '@react-three/fiber';

type AnimatorProps = {};
export function Animator(props: AnimatorProps) {
	const state = useGameStore((store) => store.state);
	useFrame(() => {
		if (state === 'play:animate') {
			const { cellRefs, cells, cuboids, cuboidRefs, animation: ani } = animation();
			if (!ani) return;

			let progressDelta = 0;

			switch (ani.type) {
				case 'rotate':
					const { angle, axis } = ani;
					if (!cuboids || !cells) return;

					const delta = 0.003; // TODO: FPS synced rotation

					progressDelta = delta / Math.abs(angle);

					// rotate cells
					for (const cell of cells) {
						const mesh = cellRefs[cell.id].current;
						if (!mesh) continue;
						mesh.position.applyAxisAngle(axis, delta * Math.sign(angle));
						mesh.rotateOnWorldAxis(axis, delta * Math.sign(angle));
					}

					// rotate cuboids
					for (const cuboid of cuboids) {
						const mesh = cuboidRefs[cuboid.id].current;
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
