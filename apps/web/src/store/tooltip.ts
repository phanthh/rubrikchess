import { create } from 'zustand';

interface TooltipStore {
	content: string | null;
	setContent: (content: string | null) => void;
}

export const useTooltipStore = create<TooltipStore>((set, get) => ({
	content: null,
	setContent: (content) => set({ content }),
}));
