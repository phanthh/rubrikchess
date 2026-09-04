import { ArcballControls } from '@react-three/drei';

export function Controls() {
	return <ArcballControls enablePan={false} dampingFactor={2} />;
}
