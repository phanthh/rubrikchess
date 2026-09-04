export function easeInOutExpo(x: number): number {
	return x === 0
		? 0
		: x === 1
			? 1
			: x < 0.5
				? Math.pow(2, 20 * x - 10) / 2
				: (2 - Math.pow(2, -20 * x + 10)) / 2;
}

export function easeInOutQuart(x: number): number {
	return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
}

export function easeInOutQuad(x: number): number {
	return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export const EASE_FUNCS = {
	quad: easeInOutQuad,
	quart: easeInOutQuart,
	exponential: easeInOutExpo,
};
