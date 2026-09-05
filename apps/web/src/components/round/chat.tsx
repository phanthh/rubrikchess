import { send, useNetStore } from '@/net/ws';
import { cn } from '@/utils/ui';
import { useEffect, useRef, useState } from 'react';

export type ChatLine = { user?: string; text: string; at: number };

export function Chat({
	gameId,
	lines,
	watchers,
	className,
	onSend,
}: {
	gameId: string;
	lines: ChatLine[];
	/** Shown as "n watching"; omit for non-game chats. */
	watchers?: number;
	className?: string;
	/** Override the transport (default: game room chat). */
	onSend?: (text: string) => void;
}) {
	const me = useNetStore((s) => s.me);
	const [draft, setDraft] = useState('');
	const list = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = list.current;
		if (!el || lines.length === 0) return;
		el.scrollTop = el.scrollHeight;
	}, [lines.length]);

	const submit = () => {
		const text = draft.trim();
		if (!text) return;
		if (onSend) onSend(text);
		else send({ t: 'chat', game_id: gameId, text });
		setDraft('');
	};

	return (
		<div className={cn('box flex flex-col min-h-0', className)}>
			<div className="box-title flex items-center">
				<span className="mr-auto">Chat</span>
				{watchers !== undefined && (
					<span className="normal-case tracking-normal font-normal">{watchers} watching</span>
				)}
			</div>
			<div ref={list} className="flex-1 min-h-0 overflow-auto p-2 text-sm flex flex-col gap-0.5">
				{lines.length === 0 && <span className="text-xs text-muted-foreground">Say hi.</span>}
				{lines.map((m, i) =>
					m.user ? (
						<div key={i} className="break-words">
							<span
								className={cn('font-medium', m.user === me?.name ? 'text-primary' : 'text-brag')}
							>
								{m.user}
							</span>{' '}
							{m.text}
						</div>
					) : (
						<div key={i} className="text-xs text-muted-foreground italic">
							{m.text}
						</div>
					),
				)}
			</div>
			<input
				className="field rounded-none border-0 border-t border-border/60 focus:ring-0 bg-transparent px-3 py-2"
				value={draft}
				maxLength={300}
				placeholder="Type a message…"
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => e.key === 'Enter' && submit()}
			/>
		</div>
	);
}
