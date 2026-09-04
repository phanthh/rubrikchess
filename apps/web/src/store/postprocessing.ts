import { RefObject } from 'react';
import { create } from 'zustand';

interface IPostProcessingStore {
	bloomMeshRefs: Record<string, RefObject<any>>;
	lightRefs: Record<string, RefObject<any>>;
	registerLightRef: (id: string, ref: RefObject<any>) => void;
	registerBloomMeshRef: (id: string, ref: RefObject<any>) => void;
	unregisterLightRef: (id: string) => void;
	unregisterBloomMeshRef: (id: string) => void;
}

export const usePostProcessingStore = create<IPostProcessingStore>((set, get) => ({
	bloomMeshRefs: {},
	lightRefs: {},
	registerLightRef: (id, ref) => {
		get().lightRefs[id] = ref;
	},
	registerBloomMeshRef: (id, ref) => {
		get().bloomMeshRefs[id] = ref;
	},
	unregisterLightRef: (id) => {
		delete get().lightRefs[id];
	},
	unregisterBloomMeshRef: (id) => {
		delete get().bloomMeshRefs[id];
	},
}));

export function postprocessing() {
	return Object.assign(usePostProcessingStore.getState(), {
		set: usePostProcessingStore.setState,
	});
}
