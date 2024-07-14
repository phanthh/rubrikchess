import { C_S } from '@/settings';
import { animation } from '@/store/animation';
import { TCuboid } from '@/types';
import { preventProgagation } from '@/utils/funcs';
import { useLayoutEffect, useRef } from 'react';
import { BoxGeometry, Mesh, Group } from 'three';

type CuboidProps = {
	cuboid: TCuboid;
};
const cuboidGeometry = new BoxGeometry(C_S, C_S, C_S);

export function Cuboid({ cuboid }: CuboidProps) {
	const ref = useRef<Group>(null);

	useLayoutEffect(() => {
		if (!ref.current) return;
		animation().registerCuboidRef(cuboid.id, ref);
	}, [ref.current, cuboid]);

	return (
		<group ref={ref} position={cuboid.cord} scale={0.98}>
			<mesh
				{...preventProgagation()}
				position={[0, 0, 0]}
				geometry={cuboidGeometry}
				castShadow
				receiveShadow
			>
				<meshStandardMaterial color={'silver'} roughness={0.9} metalness={0.1} />
			</mesh>
		</group>
	);
}
