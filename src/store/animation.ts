import { A_D } from '@/settings';
import { TAnimation, TCell } from '@/types';
import { RefObject } from 'react';
import { Group, Mesh, Clock } from 'three';
import { create } from 'zustand';

interface IAnimationStore {
	cellRefs: Record<string, RefObject<Mesh>>;
	pieceRefs: Record<string, RefObject<Group>>;
	cells: TCell[] | null;
	onEnd: (() => void) | null;
	animation: TAnimation | null;
	duration: number;
	progress: number;
}

export const useAnimationStore = create<IAnimationStore>((set, get) => ({
	cellRefs: {},
	pieceRefs: {},
	cells: null,
	onEnd: null,
	animation: null,
	duration: A_D,
	progress: 0,
}));

export function registerCellRef(id: string, ref: RefObject<Mesh>) {
	useAnimationStore.getState().cellRefs[id] = ref;
}

export function registerPieceRef(id: string, ref: RefObject<Group>) {
	useAnimationStore.getState().pieceRefs[id] = ref;
}

export function animation() {
	return Object.assign(useAnimationStore.getState(), {
		set: useAnimationStore.setState,
		reset: () => {
			useAnimationStore.setState({
				cells: null,
				onEnd: null,
				animation: null,
				progress: 0,
			});
		},
	});
}
