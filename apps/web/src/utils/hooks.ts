import { useTooltipStore } from '@/store/tooltip';
import { MeshProps } from '@react-three/fiber';
import { useState, useEffect, useMemo } from 'react';

export const useInteractiveMesh = (
	{
		normal,
		hover,
		active,
		tooltip,
	}: {
		normal: string;
		hover: string;
		active: string;
		tooltip?: string;
	},
	isActive = false,
) => {
	const [color, setColor] = useState(normal);
	const [hovered, setHovered] = useState(false);
	const setContent = useTooltipStore((store) => store.setContent);

	useEffect(() => {
		if (!tooltip) return;
		if (hovered) {
			setContent(tooltip);
		} else {
			setContent(null);
		}
	}, [tooltip, hovered, setContent]);

	useEffect(() => {
		setColor(isActive ? active : hovered ? hover : normal);
		if (hovered) {
			document.body.style.cursor = 'pointer';
		}
		return () => {
			document.body.style.cursor = 'auto';
			setColor(normal);
		};
	}, [hovered, isActive, normal, hover, active]);

	return [
		color,
		{
			onPointerEnter: () => setHovered(true),
			onPointerLeave: () => setHovered(false),
		} as Partial<MeshProps>,
		hovered,
	] as const;
};

/** Cells sit inside each other's raycast; stop events at the first hit so one click = one cell. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

export const usePreventPropagation = () => {
	const props = useMemo(() => {
		return {
			onPointerDown: stop,
			onPointerEnter: stop,
			onPointerLeave: stop,
			onPointerOver: stop,
			onPointerUp: stop,
			onClick: stop,
		} satisfies MeshProps;
	}, []);
	return props;
};
