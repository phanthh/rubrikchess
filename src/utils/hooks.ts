import { useTooltipStore } from '@/store/tooltip';
import { MeshProps } from '@react-three/fiber';
import { useState, useEffect, useRef, useMemo } from 'react';

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

export const usePrevious = <T>(value: T, defaultValue: T) => {
	const ref = useRef<T>(defaultValue);
	useEffect(() => {
		ref.current = value;
	});
	return ref.current;
};

export const usePreventPropagation = () => {
	const props = useMemo(() => {
		return {
			onPointerDown: (e) => e.stopPropagation(),
			onPointerEnter: (e) => e.stopPropagation(),
			onPointerLeave: (e) => e.stopPropagation(),
			onPointerOver: (e) => e.stopPropagation(),
			onPointerUp: (e) => e.stopPropagation(),
			onClick: (e) => e.stopPropagation(),
		} as MeshProps as any;
	}, []);
	return props;
};
