import { A_D } from '@/settings';
import { TAnimationConfig, TCell, TCuboid, TPiece } from '@/types';
import { RefObject } from 'react';
import { Group, Mesh } from 'three';
import { create } from 'zustand';
import { game } from './game';
import { produce } from 'immer';

interface IAnimationStore {
	cellRefs: Record<string, RefObject<Mesh>>;
	pieceRefs: Record<string, RefObject<Group>>;
	cuboidRefs: Record<string, RefObject<Group>>;
	cells: TCell[] | null;
	cuboids: TCuboid[] | null;
	pieces: TPiece[] | null;
	onEnd: (() => void) | null;
	config: TAnimationConfig | null;
	duration: number;
	progress: number;
	registerCellRef: (id: string, ref: RefObject<Mesh>) => void;
	registerPieceRef: (id: string, ref: RefObject<Group>) => void;
	registerCuboidRef: (id: string, ref: RefObject<Group>) => void;
	unregisterCellRef: (id: string) => void;
	unregisterPieceRef: (id: string) => void;
	unregisterCuboidRef: (id: string) => void;
	reset: () => void;
	start: (
		partial:
			| IAnimationStore
			| Partial<IAnimationStore>
			| ((state: IAnimationStore) => IAnimationStore | Partial<IAnimationStore>),
		replace?: boolean | undefined,
	) => void;
}

export const useAnimationStore = create<IAnimationStore>((set, get) => ({
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
	start: (...params) => {
		// prehook
		// clear all game cells state (no indicator at all)
		game().clearCellStates();
		set({ progress: 0 });
		set(...params);
	},
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
		set({
			cells: null,
			onEnd: null,
			config: null,
			pieces: null,
			progress: 0,
		});
	},
}));

export function animation() {
	return Object.assign(useAnimationStore.getState(), {
		set: useAnimationStore.setState,
	});
}
