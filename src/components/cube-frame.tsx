import { CU_S } from '@/settings';
import { useMemo, useRef } from 'react';
import { BoxGeometry, LineSegments } from 'three';

export function CubeFrame() {
	const geometry = useMemo(() => new BoxGeometry(CU_S + 2, CU_S + 2, CU_S + 2), []);
	const ref = useRef<LineSegments>(null);
	return (
		<lineSegments ref={ref} position={[0, 0, 0]}>
			<edgesGeometry args={[geometry]} />
			<lineBasicMaterial color={'white'} linewidth={2} />
		</lineSegments>
	);
}
