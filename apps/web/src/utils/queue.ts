// AN O(1) dequeue queue
export function createQueue<T>() {
	const a: T[] = [];
	const b: T[] = [];
	return {
		push: (...elts: T[]) => a.push(...elts),
		shift: () => {
			if (b.length === 0) {
				while (a.length > 0) {
					b.push(a.pop()!);
				}
			}
			return b.pop();
		},
		get length() {
			return a.length + b.length;
		},
	};
}
