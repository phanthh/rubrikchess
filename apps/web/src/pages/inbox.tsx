import { Shell } from '@/components/shell';
import { Button } from '@/components/ui/button';
import { Conversation, conversations, sendMessage, thread } from '@/net/api';
import { onServerMsg, useNetStore } from '@/net/ws';
import { Message } from '@/types';
import { timeAgo } from '@/utils/clock';
import { cn } from '@/utils/ui';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

/** /inbox → conversation list; /inbox/:name → thread with that player. */
export function InboxPage() {
	const { name } = useParams();
	const navigate = useNavigate();
	const me = useNetStore((s) => s.me);
	const [convs, setConvs] = useState<Conversation[]>([]);
	const [msgs, setMsgs] = useState<Message[]>([]);
	const [draft, setDraft] = useState('');
	const list = useRef<HTMLDivElement>(null);

	const loadConvs = () =>
		conversations()
			.then(setConvs)
			.catch(() => undefined);
	const loadThread = () =>
		name &&
		thread(name)
			.then(setMsgs)
			.catch(() => setMsgs([]));

	useEffect(() => {
		void loadConvs();
		void loadThread();
		return onServerMsg((m) => {
			if (m.t !== 'pm') return;
			void loadConvs();
			if (m.from.name === name) setMsgs((prev) => [...prev, m.message]);
		});
		// oxlint-disable-next-line react-hooks/exhaustive-deps
	}, [name]);

	useEffect(() => {
		const el = list.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [msgs]);

	const submit = async () => {
		const text = draft.trim();
		if (!name || !text) return;
		setDraft('');
		const m = await sendMessage(name, text).catch(() => null);
		if (m) {
			setMsgs((prev) => [...prev, m]);
			void loadConvs();
		}
	};

	return (
		<Shell>
			<div className="grid gap-4 lg:grid-cols-[18rem_1fr] max-w-5xl mx-auto">
				<section className="box self-start">
					<div className="box-title">Inbox</div>
					{convs.length === 0 && (
						<div className="p-4 text-sm text-muted-foreground">
							No conversations yet. Message a player from their profile.
						</div>
					)}
					{convs.map((c) => (
						<Link
							key={c.user.id}
							to={`/inbox/${c.user.name}`}
							className={cn(
								'flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent/50 hover:no-underline',
								c.user.name === name && 'bg-accent/60',
							)}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className={cn('truncate', c.unread > 0 && 'font-semibold')}>
										{c.user.name}
									</span>
									{c.unread > 0 && (
										<span className="rounded-full bg-primary text-primary-foreground text-[10px] px-1.5">
											{c.unread}
										</span>
									)}
									<span className="ml-auto text-[11px] text-muted-foreground">
										{timeAgo(c.last.at)}
									</span>
								</div>
								<div className="text-xs text-muted-foreground truncate">{c.last.text}</div>
							</div>
						</Link>
					))}
				</section>
				<section className="box flex flex-col h-[70vh]">
					{name ? (
						<>
							<div className="box-title flex items-center">
								<Link
									to={`/u/${name}`}
									className="mr-auto normal-case tracking-normal text-sm font-semibold"
								>
									{name}
								</Link>
								<Button size="sm" variant="ghost" onClick={() => navigate(`/u/${name}`)}>
									profile
								</Button>
							</div>
							<div ref={list} className="flex-1 overflow-auto p-3 flex flex-col gap-1.5 text-sm">
								{msgs.map((m) => (
									<div
										key={m.id}
										className={cn(
											'max-w-[75%] rounded-lg px-3 py-1.5 break-words',
											m.from === me?.id ? 'self-end bg-primary/20' : 'self-start bg-muted',
										)}
										title={new Date(m.at).toLocaleString()}
									>
										{m.text}
									</div>
								))}
							</div>
							<input
								className="field rounded-none border-0 border-t border-border/60 focus:ring-0 bg-transparent px-3 py-2"
								value={draft}
								maxLength={500}
								placeholder={`Message ${name}…`}
								onChange={(e) => setDraft(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && submit()}
								autoFocus
							/>
						</>
					) : (
						<div className="m-auto text-sm text-muted-foreground">Pick a conversation.</div>
					)}
				</section>
			</div>
		</Shell>
	);
}
