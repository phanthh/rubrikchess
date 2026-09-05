import { BoardTheme } from '@/utils/consts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ClockTenths = 'never' | 'lowtime' | 'always';

interface IPrefs {
	sound: boolean;
	volume: number; // 0..1
	animate: boolean;
	confirmResign: boolean;
	/** Ask before sending a move (touch-screen safety). */
	confirmMove: boolean;
	clockTenths: ClockTenths;
	clockBar: boolean;
	showThreats: boolean;
	theme: 'dark' | 'light';
	boardTheme: BoardTheme;
	highlightLastMove: boolean;
	/** Play on the unfolded 2D net instead of the 3D cube. */
	view2d: boolean;
	/** Lifetime tactics solved on this device. */
	puzzlesSolved: number;
	set: (patch: Partial<Omit<IPrefs, 'set'>>) => void;
}

export const usePrefs = create<IPrefs>()(
	persist(
		(set) => ({
			sound: true,
			volume: 0.7,
			animate: true,
			confirmResign: true,
			confirmMove: false,
			clockTenths: 'lowtime',
			clockBar: true,
			showThreats: true,
			theme: 'dark',
			boardTheme: 'grey',
			highlightLastMove: true,
			view2d: false,
			puzzlesSolved: 0,
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
