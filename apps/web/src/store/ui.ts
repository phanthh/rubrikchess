import { create } from 'zustand';

/** Session-only UI flags that must not drag the 3D game store into every page. */
export const useUi = create<{ zen: boolean; toggleZen: () => void }>((set) => ({
	zen: false,
	toggleZen: () => set((s) => ({ zen: !s.zen })),
}));
