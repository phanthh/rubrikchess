import { animation, useAnimationStore } from '@/store/animation';
import { game, useGameState } from '@/store/game';
import { clamp, EASE_FUNCS } from '@/utils/funcs';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Clock } from 'three';

type AnimatorProps = {
	speedFactor?: number;
};
export function Animator({ speedFactor = 1.5 }: AnimatorProps) {
	const [state] = useGameState('state');

	const { invalidate } = useThree();

	useEffect(() => {
		const unsub = useAnimationStore.subscribe((store) => store.progress, invalidate);
		return unsub;
	}, []);

	const clock = useMemo(() => {
		const clock = new Clock();
		clock.autoStart = true;
		return clock;
	}, []);

	useFrame(({ scene }) => {
		const clockDelta = Math.max(clock.getDelta(), 0.001);

		if (state !== 'play:animate') return;

		const { pieces, cellRefs, cells, cuboids, cuboidRefs, config, pieceRefs } = animation();
		if (!config) return;

		let progressDelta = 0;

		const animationDelta = clamp(clockDelta, 0.01, 0.02) * speedFactor;

		switch (config.type) {
			case 'rotate': {
				// ROTATING ANIMATION
				const { angle, axis } = config;
				if (!cuboids || !cells) return;

				progressDelta = animationDelta / Math.abs(angle);

				// rotate cells
				for (const cell of cells) {
					const mesh = cellRefs[cell.id].current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, animationDelta * Math.sign(angle));
					mesh.rotateOnWorldAxis(axis, animationDelta * Math.sign(angle));
				}

				for (const cuboid of cuboids) {
					const mesh = cuboidRefs[cuboid.id].current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, animationDelta * Math.sign(angle));
					mesh.rotateOnWorldAxis(axis, animationDelta * Math.sign(angle));
				}
				break;
			}
			case 'path':
				// PATH ANIMATION
				const { path, ease, zPath } = config;
				if (!pieces) return;

				progressDelta = animationDelta; // TODO: FPS synced rotation

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
			if (clock.running) clock.stop();
			game().set({ state: 'play:pick-piece' });
			animation().onEnd?.();
			animation().reset();
			console.log('ANIMATION DONEEEE');
		}
	});
	return null;
}
