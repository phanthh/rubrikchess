import { zvec } from '@/utils/consts';
import { vec } from '@/utils/funcs';
import { Vector3 } from 'three';

type AxisHelperProps = {
	position?: Vector3;
	length?: number;
};

export function AxisHelper({ position = zvec(), length = 8 }: AxisHelperProps) {
	return (
		<>
			<arrowHelper args={[vec(0, 0, 1), position, length, 'blue']} />
			<arrowHelper args={[vec(0, 1, 0), position, length, 'green']} />
			<arrowHelper args={[vec(1, 0, 0), position, length, 'red']} />
		</>
	);
}
