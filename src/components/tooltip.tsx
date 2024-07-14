import { useTooltipStore } from '@/store/tooltip';
import { useEffect, useRef } from 'react';

export function Tooltip() {
	const content = useTooltipStore((store) => store.content);

	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const target = ref.current;
		if (!target || !content) return;

		const listener = (e: MouseEvent) => {
			const { clientX, clientY } = e;
			target.style.top = `${clientY}px`;
			target.style.left = `${clientX}px`;
		};

		document.addEventListener('mousemove', listener);

		return () => {
			document.removeEventListener('mousemove', listener);
		};
	}, [ref.current, content]);

	return (
		<div
			className={'tooltip'}
			ref={ref}
			style={{
				opacity: content ? 1 : 0,
				transitionDelay: content ? '1000ms' : '0ms',
				transitionDuration: content ? '100ms' : '0ms',
			}}
		>
			{content}
		</div>
	);
}
