import { CU_S } from '@/settings';
import { useMemo } from 'react';
import { BoxGeometry } from 'three';

export function CubeFrame() {
	const geometry = useMemo(() => new BoxGeometry(CU_S + 2, CU_S + 2, CU_S + 2), []);
	return (
		<lineSegments position={[0, 0, 0]}>
			<edgesGeometry args={[geometry]} />
			<lineBasicMaterial color={'white'} linewidth={2} />
		</lineSegments>
	);
}
