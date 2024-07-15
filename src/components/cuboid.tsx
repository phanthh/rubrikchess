import { C_S } from '@/settings';
import { animation } from '@/store/animation';
import { TCuboid } from '@/types';
import { usePreventPropagation } from '@/utils/hooks';
import { memo, useLayoutEffect, useRef } from 'react';
import { BoxGeometry, Group } from 'three';

type CuboidProps = {
	cuboid: TCuboid;
};
const cuboidGeometry = new BoxGeometry(C_S, C_S, C_S);

export const Cuboid = memo(({ cuboid }: CuboidProps) => {
	const ref = useRef<Group>(null);
	const preventPropagationProps = usePreventPropagation();

	useLayoutEffect(() => {
		animation().registerCuboidRef(cuboid.id, ref);
		return () => {
			animation().unregisterCuboidRef(cuboid.id);
		};
	}, [cuboid.id, ref.current]);

	return (
		<group ref={ref} position={cuboid.cord} scale={0.95}>
			<mesh
				{...preventPropagationProps}
				position={[0, 0, 0]}
				geometry={cuboidGeometry}
				receiveShadow
			>
				<meshStandardMaterial color={'silver'} roughness={0.9} metalness={0.1} />
			</mesh>
		</group>
	);
});
