import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { INITAL_CAM_CORD } from '../settings';
import { useGameStore } from '../store/game';

/** Points the camera at the player's own face: white +Y up, black -Y up. */
export function CameraRig() {
	const myColor = useGameStore((s) => s.myColor);
	const { camera, invalidate } = useThree();
	useEffect(() => {
		const flip = myColor === 'black' ? -1 : 1;
		camera.up.set(0, flip, 0);
		camera.position.set(INITAL_CAM_CORD.x, flip * INITAL_CAM_CORD.y, INITAL_CAM_CORD.z);
		camera.lookAt(0, 0, 0);
		camera.updateProjectionMatrix();
		invalidate();
	}, [myColor, camera, invalidate]);
	return null;
}
