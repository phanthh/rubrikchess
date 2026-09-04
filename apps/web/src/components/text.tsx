import { extend, GroupProps, useLoader } from '@react-three/fiber';
import { useMemo } from 'react';
import { FontLoader, TextGeometry } from 'three/examples/jsm/Addons.js';

extend({ TextGeometry });

type TextProps = {
	text: string;
} & GroupProps;

export function Text({ text, ...props }: TextProps) {
	const font = useLoader(FontLoader, '/font.json');
	const config = useMemo(
		() => ({
			font: font,
			size: 0.5,
			depth: 0,
			curveSegments: 32,
			bevelEnabled: true,
			bevelThickness: 0.03,
			bevelSize: 0.02,
			bevelOffset: 0,
			bevelSegments: 5,
		}),
		[font],
	);

	return (
		<group {...props}>
			<mesh>
				<textGeometry args={[text, config]} />
				<meshNormalMaterial />
			</mesh>
		</group>
	);
}

useLoader.preload(FontLoader, '/font.json');
