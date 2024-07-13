import { useTooltipStore } from '@/store/tooltip';
import { MeshProps } from '@react-three/fiber';
import { useState, useEffect, useRef } from 'react';

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
	}, [tooltip, hovered]);

	useEffect(() => {
		setColor(isActive ? active : hovered ? hover : normal);
		if (hovered) {
			document.body.style.cursor = 'pointer';
		}
		return () => {
			document.body.style.cursor = 'auto';
			setColor(normal);
		};
	}, [hovered, isActive]);

	return [
		color,
		{
			onPointerEnter: () => setHovered(true),
			onPointerLeave: () => setHovered(false),
		} as Partial<MeshProps>,
	] as const;
};

export const usePrevious = <T>(value: T) => {
	const ref = useRef<T>();
	useEffect(() => {
		ref.current = value;
	});
	return ref.current;
};
