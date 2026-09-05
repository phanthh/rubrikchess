import { GameConfig, Layout } from '@/types';

export const LAYOUTS: Record<Layout, number[]> = { standard: [0, 0, 1, 1, 0, 1], rubrik: [0, 1, 2, 3, 4, 5] };

export function layoutOf(config: GameConfig | null | undefined): Layout {
	return config && config.layout.some((c, i) => c !== LAYOUTS.standard[i]) ? 'rubrik' : 'standard';
}

/** Human label for a game's rules, e.g. "walled · rubrik" or "standard". */
export function variantLabel(walled: boolean, layout: Layout = 'standard') {
	const parts = [walled && 'walled', layout === 'rubrik' && 'rubrik'].filter(Boolean);
	return parts.length ? parts.join(' · ') : 'standard';
}
