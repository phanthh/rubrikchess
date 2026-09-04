import { create } from 'zustand';

interface TooltipStore {
	content: string | null;
	setContent: (content: string | null) => void;
}

export const useTooltipStore = create<TooltipStore>((set) => ({
	content: null,
	setContent: (content) => set({ content }),
}));
