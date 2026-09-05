import { BoardTheme } from '@/utils/consts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ClockTenths = 'never' | 'lowtime' | 'always';

interface IPrefs {
	sound: boolean;
	volume: number; // 0..1
	animate: boolean;
	confirmResign: boolean;
	clockTenths: ClockTenths;
	clockBar: boolean;
	showThreats: boolean;
	theme: 'dark' | 'light';
	boardTheme: BoardTheme;
	highlightLastMove: boolean;
	set: (patch: Partial<Omit<IPrefs, 'set'>>) => void;
}

export const usePrefs = create<IPrefs>()(
	persist(
		(set) => ({
			sound: true,
			volume: 0.7,
			animate: true,
			confirmResign: true,
			clockTenths: 'lowtime',
			clockBar: true,
			showThreats: true,
			theme: 'dark',
			boardTheme: 'grey',
			highlightLastMove: true,
			set: (patch) => set(patch),
		}),
		{ name: 'rubrik-prefs' },
	),
);

export const prefs = () => usePrefs.getState();

function applyTheme(theme: IPrefs['theme']) {
	document.documentElement.classList.toggle('light', theme === 'light');
}
applyTheme(prefs().theme);
usePrefs.subscribe((s, prev) => s.theme !== prev.theme && applyTheme(s.theme));
