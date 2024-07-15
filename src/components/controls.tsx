import { OrbitControls, TrackballControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

type ControlsProps = {
	controlStyle: 'orbit' | 'trackball';
};

export function Controls({ controlStyle }: ControlsProps) {
	const ocRef = useRef<any>(null);
	const tbRef = useRef<any>(null);
	const camera = useThree((state) => state.camera);

	useEffect(() => {
		if (!tbRef.current) return;
		if (!ocRef.current) return;
		let p = camera.position.clone();
		if (controlStyle === 'orbit') {
			tbRef.current.reset();
		}
		if (controlStyle === 'trackball') {
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
			<TrackballControls enabled={controlStyle === 'trackball'} ref={tbRef} noPan />
		</>
	);
}
