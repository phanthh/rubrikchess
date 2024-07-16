import { animation, useAnimationStore } from '@/store/animation';
import { game, useGameStore } from '@/store/game';
import { EASE_FUNCS } from '@/utils/funcs';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';

type AnimatorProps = {};
export function Animator(props: AnimatorProps) {
	const state = useGameStore((store) => store.state);
	const inverted = useGameStore((store) => store.inverted);

	const { invalidate } = useThree();

	useEffect(() => {
		const unsub = useAnimationStore.subscribe((store) => {
			invalidate();
		});
		return unsub;
	}, []);

	useFrame(({ scene }) => {
		if (state !== 'play:animate') return;

		const { pieces, cellRefs, cells, cuboids, cuboidRefs, config, pieceRefs } = animation();
		if (!config) return;

		let progressDelta = 0;

		switch (config.type) {
			case 'rotate': {
				// ROTATING ANIMATION
				const { angle, axis } = config;
				if (!cuboids || !cells) return;

				const delta = 0.01; // TODO: FPS synced rotation

				progressDelta = delta / Math.abs(angle);

				// rotate cells
				for (const cell of cells) {
					const mesh = cellRefs[cell.id].current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, delta * Math.sign(angle));
					mesh.rotateOnWorldAxis(axis, delta * Math.sign(angle));
				}

				for (const cuboid of cuboids) {
					const mesh = cuboidRefs[cuboid.id].current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, delta * Math.sign(angle));
					mesh.rotateOnWorldAxis(axis, delta * Math.sign(angle));
				}
				break;
			}
			case 'path':
				// PATH ANIMATION
				const { path, ease, zPath } = config;
				if (!pieces) return;

				progressDelta = 0.01; // TODO: FPS synced rotation

				const t = EASE_FUNCS[ease](animation().progress);
				for (const piece of pieces) {
					try {
						const mesh = pieceRefs[piece.id].current;
						if (!mesh) continue;
						scene.attach(mesh);
						path.getPointAt(t, mesh.position);
						mesh.lookAt(zPath.getPointAt(t));
					} catch (e) {
						// console.log(e, piece);
						throw e;
					}
				}

				break;
			default:
				break;
		}

		animation().set((state) => ({
			progress: state.progress + progressDelta,
		}));

		if (animation().progress >= 1) {
			game().set({ state: 'play:pick-piece' });
			console.log(animation());
			animation().onEnd?.();
			animation().reset();
			console.log('ANIMATION DONEEEE');
		}
	});
	return null;
}
