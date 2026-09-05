import { cn } from '@/utils/ui';
import { X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';

/** Minimal modal: overlay + box, closes on Escape / backdrop click. */
export function Dialog({
	open,
	onClose,
	title,
	children,
	className,
}: {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);

	if (!open) return null;
	return (
		<div
			className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150"
			onMouseDown={onClose}
		>
			<div
				role="dialog"
				aria-modal
				className={cn(
					'box max-h-full w-[28rem] max-w-full overflow-auto flex flex-col animate-in zoom-in-95 duration-150',
					className,
				)}
				onMouseDown={(e) => e.stopPropagation()}
			>
				{title !== undefined && (
					<div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
						<h2 className="text-base font-semibold mr-auto">{title}</h2>
						<button
							className="text-muted-foreground hover:text-foreground"
							onClick={onClose}
							aria-label="Close"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				)}
				<div className="p-4 flex flex-col gap-3">{children}</div>
			</div>
		</div>
	);
}
