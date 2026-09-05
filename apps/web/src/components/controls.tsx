import { ArcballControls } from '@react-three/drei';
import { ComponentRef, useEffect, useRef } from 'react';

export const RESET_CAMERA_EVENT = 'rubrik:reset-camera';

export function Controls() {
	const ref = useRef<ComponentRef<typeof ArcballControls>>(null);
	useEffect(() => {
		const onReset = () => ref.current?.reset();
		window.addEventListener(RESET_CAMERA_EVENT, onReset);
		return () => window.removeEventListener(RESET_CAMERA_EVENT, onReset);
	}, []);
	return <ArcballControls ref={ref} enablePan={false} dampingFactor={2} />;
}
