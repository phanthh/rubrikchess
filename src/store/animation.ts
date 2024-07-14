import { A_D } from '@/settings';
import { TAnimation, TCell, TCuboid } from '@/types';
import { RefObject } from 'react';
import { Group, Mesh, Clock } from 'three';
import { create } from 'zustand';

interface IAnimationStore {
	cellRefs: Record<string, RefObject<Mesh>>;
	pieceRefs: Record<string, RefObject<Group>>;
	cuboidRefs: Record<string, RefObject<Group>>;
	cells: TCell[] | null;
	cuboids: TCuboid[] | null;
	onEnd: (() => void) | null;
	animation: TAnimation | null;
	duration: number;
	progress: number;
	registerCellRef: (id: string, ref: RefObject<Mesh>) => void;
	registerPieceRef: (id: string, ref: RefObject<Group>) => void;
	registerCuboidRef: (id: string, ref: RefObject<Group>) => void;
	reset: () => void;
}

export const useAnimationStore = create<IAnimationStore>((set, get) => ({
	cellRefs: {},
	pieceRefs: {},
	cuboidRefs: {},
	cells: null,
	cuboids: null,
	onEnd: null,
	animation: null,
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
	reset: () => {
		set({
			cells: null,
			onEnd: null,
			animation: null,
			progress: 0,
		});
	},
}));

export function animation() {
	return Object.assign(useAnimationStore.getState(), {
		set: useAnimationStore.setState,
	});
}
