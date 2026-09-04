import { animation, useAnimationStore } from '@/store/animation';
import { useGameStore } from '@/store/game';
import { EASE_FUNCS } from '@/utils/animation';
import { CUBOID_BY_ID } from '@/utils/cuboids';
import { clamp } from '@/utils/funcs';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Clock } from 'three';

type AnimatorProps = {
	speedFactor?: number;
};

export function Animator({ speedFactor = 1.5 }: AnimatorProps) {
	const animating = useGameStore((store) => store.animating);
	const { invalidate } = useThree();

	useEffect(() => {
		return useAnimationStore.subscribe((store) => store.progress, invalidate);
	}, [invalidate]);

	const clock = useMemo(() => {
		const clock = new Clock();
		clock.autoStart = true;
		return clock;
	}, []);

	useFrame(({ scene }) => {
		const clockDelta = Math.max(clock.getDelta(), 0.001);

		if (!animating) return;

		const { pieces, cellRefs, cells, cuboids, cuboidRefs, config, pieceRefs } = animation();
		if (!config) return;

		let progressDelta = 0;
		const animationDelta = clamp(clockDelta, 0.01, 0.02) * speedFactor;

		switch (config.type) {
			case 'rotate': {
				const { angle, axis } = config;
				if (!cells) return;
				progressDelta = animationDelta / Math.abs(angle);

				for (const id of cells) {
					const mesh = cellRefs[id]?.current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, animationDelta * Math.sign(angle));
					mesh.rotateOnWorldAxis(axis, animationDelta * Math.sign(angle));
				}

				for (const id of cuboids ?? []) {
					const mesh = cuboidRefs[id]?.current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, animationDelta * Math.sign(angle));
					mesh.rotateOnWorldAxis(axis, animationDelta * Math.sign(angle));
				}
				break;
			}
			case 'path': {
				const { path, ease, zPath } = config;
				if (!pieces) return;
				progressDelta = animationDelta;

				const t = EASE_FUNCS[ease](animation().progress);
				for (const id of pieces) {
					const mesh = pieceRefs[id]?.current;
					if (!mesh) continue;
					scene.attach(mesh);
					path.getPointAt(t, mesh.position);
					mesh.lookAt(zPath.getPointAt(t));
				}
				break;
			}
		}

		animation().set((state) => ({ progress: state.progress + progressDelta }));

		if (animation().progress >= 1) {
			if (clock.running) clock.stop();
			// Cuboids are decorative and identical: snap them back to their fixed spots.
			for (const id of cuboids ?? []) {
				const mesh = cuboidRefs[id]?.current;
				if (!mesh) continue;
				mesh.position.copy(CUBOID_BY_ID[id].pos);
				mesh.rotation.set(0, 0, 0);
			}
			const onEnd = animation().onEnd;
			animation().reset();
			onEnd?.();
		}
	});
	return null;
}
