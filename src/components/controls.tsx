import { ArcballControls, OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

type ControlsProps = {
	controlStyle: 'orbit' | 'arcball';
};

export function Controls({ controlStyle }: ControlsProps) {
	const ocRef = useRef<any>(null);
	const abRef = useRef<any>(null);
	const camera = useThree((state) => state.camera);

	useEffect(() => {
		if (!abRef.current) return;
		if (!ocRef.current) return;
		let p = camera.position.clone();
		if (controlStyle === 'orbit') {
			abRef.current.reset();
		}
		if (controlStyle === 'arcball') {
			ocRef.current.reset();
		}
		camera.position.copy(p);
	}, [controlStyle, camera]);

	return (
		<>
			<OrbitControls
				enabled={controlStyle === 'orbit'}
				ref={ocRef}
				enablePan={false}
				enableDamping={true}
			/>
			<ArcballControls
				enabled={controlStyle === 'arcball'}
				enablePan={false}
				dampingFactor={2}
				ref={abRef}
			/>
		</>
	);
}
