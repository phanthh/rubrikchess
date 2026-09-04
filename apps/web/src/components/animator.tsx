import { useAnimationStore } from '@/store/animation';
import { useGameStore } from '@/store/game';
import { easeInOutQuart } from '@/utils/animation';
import { CUBOID_BY_ID } from '@/utils/cuboids';
import { clamp } from '@/utils/funcs';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Clock, Quaternion } from 'three';

const q = new Quaternion();
const SPEED = 1.5;

export function Animator() {
	const animating = useGameStore((store) => store.animating);
	const { invalidate } = useThree();

	useEffect(() => {
		return useAnimationStore.subscribe((store) => store.progress, invalidate);
	}, [invalidate]);

	// frameloop is "demand": kick the first frame, progress updates keep it going
	useEffect(() => {
		if (animating) invalidate();
	}, [animating, invalidate]);

	const clock = useMemo(() => new Clock(), []);

	useFrame(() => {
		const clockDelta = clock.getDelta();
		if (!animating) return;

		const { pieces, cellRefs, cells, cuboids, cuboidRefs, config, pieceRefs } =
			useAnimationStore.getState();
		if (!config) return;

		let progressDelta = 0;
		// time-based so low fps does not slow the animation; cap guards against tab-switch jumps
		const animationDelta = clamp(clockDelta, 0, 0.1) * SPEED;

		switch (config.type) {
			case 'rotate': {
				const { angle, axis } = config;
				if (!cells) return;
				progressDelta = animationDelta / Math.abs(angle);

				for (const id of cells) {
					const mesh = cellRefs[id]?.current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, animationDelta * Math.sign(angle));
					// rotate about the board group's axis (not world: the board may be flipped for black)
					mesh.quaternion.premultiply(q.setFromAxisAngle(axis, animationDelta * Math.sign(angle)));
				}

				for (const id of cuboids ?? []) {
					const mesh = cuboidRefs[id]?.current;
					if (!mesh) continue;
					mesh.position.applyAxisAngle(axis, animationDelta * Math.sign(angle));
					mesh.quaternion.premultiply(q.setFromAxisAngle(axis, animationDelta * Math.sign(angle)));
				}
				break;
			}
			case 'path': {
				const { path, zPath } = config;
				if (!pieces) return;
				progressDelta = animationDelta;

				const t = easeInOutQuart(useAnimationStore.getState().progress);
				for (const id of pieces) {
					const mesh = pieceRefs[id]?.current;
					if (!mesh) continue;
					// path is in board-local coords: re-parent from the cell to the board group
					const board = mesh.parent?.parent;
					if (board && mesh.parent !== board) board.attach(mesh);
					path.getPointAt(t, mesh.position);
					mesh.lookAt(mesh.parent!.localToWorld(zPath.getPointAt(t)));
				}
				break;
			}
		}

		useAnimationStore.setState((state) => ({ progress: state.progress + progressDelta }));

		if (useAnimationStore.getState().progress >= 1) {
			// Cuboids are decorative and identical: snap them back to their fixed spots.
			for (const id of cuboids ?? []) {
				const mesh = cuboidRefs[id]?.current;
				if (!mesh) continue;
				mesh.position.copy(CUBOID_BY_ID[id].pos);
				mesh.rotation.set(0, 0, 0);
			}
			const onEnd = useAnimationStore.getState().onEnd;
			useAnimationStore.getState().reset();
			onEnd?.();
		}
	});
	return null;
}
