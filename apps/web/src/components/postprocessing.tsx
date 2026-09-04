import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { Suspense } from 'react';

export function PostProcessing() {
	return (
		<Suspense fallback={null}>
			<EffectComposer>
				{/* <Vignette eskil={false} offset={0.1} darkness={1.1} /> */}
				<Bloom intensity={10} luminanceSmoothing={0.5} mipmapBlur luminanceThreshold={0.5} />
			</EffectComposer>
		</Suspense>
	);
}
