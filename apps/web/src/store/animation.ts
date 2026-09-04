import { A_D } from '@/settings';
import { CellId, TAnimationConfig } from '@/types';
import { RefObject } from 'react';
import { Group, Mesh } from 'three';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface IAnimationStore {
	cellRefs: Record<CellId, RefObject<Mesh>>;
	pieceRefs: Record<number, RefObject<Group>>;
	cuboidRefs: Record<string, RefObject<Group>>;
	cells: CellId[] | null;
	cuboids: string[] | null;
	pieces: number[] | null;
	onEnd: (() => void) | null;
	config: TAnimationConfig | null;
	duration: number;
	progress: number;
	registerCellRef: (id: CellId, ref: RefObject<Mesh>) => void;
	registerPieceRef: (id: number, ref: RefObject<Group>) => void;
	registerCuboidRef: (id: string, ref: RefObject<Group>) => void;
	unregisterCellRef: (id: CellId) => void;
	unregisterPieceRef: (id: number) => void;
	unregisterCuboidRef: (id: string) => void;
	reset: () => void;
}

export const useAnimationStore = create(
	subscribeWithSelector<IAnimationStore>((set, get) => ({
		cellRefs: {},
		pieceRefs: {},
		cuboidRefs: {},
		cells: null,
		cuboids: null,
		pieces: null,
		onEnd: null,
		config: null,
		duration: A_D,
		progress: 0,
		registerCellRef: (id, ref) => {
			get().cellRefs[id] = ref;
		},
		registerPieceRef: (id, ref) => {
			get().pieceRefs[id] = ref;
		},
		registerCuboidRef: (id, ref) => {
			get().cuboidRefs[id] = ref;
		},
		unregisterCellRef: (id) => {
			delete get().cellRefs[id];
		},
		unregisterPieceRef: (id) => {
			delete get().pieceRefs[id];
		},
		unregisterCuboidRef: (id) => {
			delete get().cuboidRefs[id];
		},
		reset: () => {
			set({ cells: null, cuboids: null, pieces: null, onEnd: null, config: null, progress: 0 });
		},
	})),
);

export function animation() {
	return Object.assign({ ...useAnimationStore.getState() }, {
		set: useAnimationStore.setState,
	});
}

/** Kick off an animation; `onEnd` commits the move to the engine. */
export function startAnimation(
	partial: Pick<IAnimationStore, 'config' | 'onEnd'> &
		Partial<Pick<IAnimationStore, 'cells' | 'cuboids' | 'pieces'>>,
) {
	useAnimationStore.setState({
		cells: null,
		cuboids: null,
		pieces: null,
		progress: 0,
		...partial,
	});
}
(globalThis as unknown as { __anim: typeof useAnimationStore }).__anim = useAnimationStore;
