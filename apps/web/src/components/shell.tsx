import { AuthDialog, AuthMode } from '@/components/auth-dialog';
import { applyAuth } from '@/net/auth';
import { PrefsDialog } from '@/components/prefs-dialog';
import { RulesButton } from '@/components/rules-panel';
import { Tooltip } from '@/components/tooltip';
import { liveGames, logout, setName } from '@/net/api';
import { connect, useNetStore } from '@/net/ws';
import { useUi } from '@/store/ui';
import { cn } from '@/utils/ui';
import { ChevronDown, Settings, Swords } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { toast } from 'sonner';

const NAV = [
	['/', 'Play'],
	['/puzzle', 'Puzzles'],
	['/tv', 'Watch'],
	['/tournaments', 'Arena'],
	['/players', 'Players'],
	['/local', 'Sandbox'],
	['/learn', 'Learn'],
] as const;

/** Page frame: top bar with nav, connection state, prefs and the user menu. */
export function Shell({ children, fill }: { children: ReactNode; fill?: boolean }) {
	const me = useNetStore((s) => s.me);
	const connected = useNetStore((s) => s.connected);
	const online = useNetStore((s) => s.online);
	const [prefsOpen, setPrefsOpen] = useState(false);
	const [authMode, setAuthMode] = useState<AuthMode | null>(null);
	const [menu, setMenu] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const zen = useUi((s) => s.zen);
	const [myTurn, setMyTurn] = useState<{ id: string; opponent: string }[]>([]);
	useEffect(connect, []);

	// Games waiting on me (correspondence inbox): plies parity tells whose move it is.
	useEffect(() => {
		if (!me) return;
		const poll = () =>
			liveGames()
				.then((games) =>
					setMyTurn(
						games
							.filter((g) => (g.plies % 2 === 0 ? g.white.id : g.black.id) === me.id)
							.map((g) => ({
								id: g.id,
								opponent: (g.white.id === me.id ? g.black : g.white).name,
							})),
					),
				)
				.catch(() => undefined);
		poll();
		const t = setInterval(poll, 20_000);
		return () => clearInterval(t);
	}, [me]);

	useEffect(() => {
		if (!menu) return;
		const onDown = (e: MouseEvent) =>
			!menuRef.current?.contains(e.target as Node) && setMenu(false);
		document.addEventListener('mousedown', onDown);
		return () => document.removeEventListener('mousedown', onDown);
	}, [menu]);

	const rename = async () => {
		const name = prompt('New name (3–32 chars, letters/digits/_/-)', me?.name);
		if (!name || name === me?.name) return;
		try {
			useNetStore.setState({ me: await setName(name) });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<div className="h-full flex flex-col">
			<header
				className={cn(
					'h-12 shrink-0 flex items-center gap-1 px-3 sm:px-5 border-b border-border/60 bg-card/80 backdrop-blur z-40',
					fill && zen && 'hidden',
				)}
			>
				<Link
					to="/"
					className="flex items-center gap-2 mr-4 text-foreground hover:no-underline font-bold tracking-tight"
				>
					<Logo />
					<span className="hidden sm:inline">Rubrik Chess</span>
				</Link>
				<nav className="flex items-center gap-0.5 text-sm">
					{NAV.map(([to, label]) => (
						<NavLink
							key={to}
							to={to}
							end={to === '/'}
							className={({ isActive }) =>
								cn(
									'px-2 sm:px-2.5 py-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent hover:no-underline',
									isActive && 'text-foreground bg-accent/70',
									to !== '/' && to !== '/puzzle' && 'hidden sm:block',
								)
							}
						>
							{label}
						</NavLink>
					))}
				</nav>
				<div className="ml-auto flex items-center gap-1">
					{myTurn.length > 0 && !location.pathname.startsWith(`/g/${myTurn[0].id}`) && (
						<Link
							to={`/g/${myTurn[0].id}`}
							title={`Your move against ${myTurn[0].opponent}`}
							className="flex items-center gap-1 px-2 py-1 mr-1 rounded-full bg-secondary/20 text-secondary text-xs font-semibold hover:no-underline"
						>
							<Swords className="h-3.5 w-3.5" />
							{myTurn.length}
						</Link>
					)}
					{connected && online > 0 && (
						<span className="hidden sm:inline text-xs text-muted-foreground mr-1">
							{online} online
						</span>
					)}
					<span
						title={connected ? 'connected' : 'reconnecting…'}
						className={cn(
							'h-2 w-2 rounded-full mr-1 sm:mr-2',
							connected ? 'bg-secondary' : 'bg-destructive animate-pulse',
						)}
					/>
					<span className="hidden sm:block">
						<RulesButton />
					</span>
					<button
						className="p-2 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
						title="Preferences"
						onClick={() => setPrefsOpen(true)}
					>
						<Settings className="h-4 w-4" />
					</button>
					<div ref={menuRef} className="relative">
						<button
							className="flex items-center gap-1.5 px-2 py-1.5 rounded text-sm hover:bg-accent"
							onClick={() => setMenu(!menu)}
						>
							<span className="max-w-20 sm:max-w-32 truncate">{me?.name ?? '…'}</span>
							{me && <span className="text-brag font-medium">{Math.round(me.rating)}</span>}
							<ChevronDown className="h-3 w-3 text-muted-foreground" />
						</button>
						{menu && me && (
							<div className="absolute right-0 mt-1 w-48 box bg-popover text-popover-foreground py-1 text-sm shadow-lg">
								<div className="sm:hidden border-b border-border/60 mb-1 pb-1">
									{NAV.filter(([to]) => to !== '/' && to !== '/puzzle').map(([to, label]) => (
										<MenuItem key={to} to={to} onClick={() => setMenu(false)}>
											{label}
										</MenuItem>
									))}
								</div>
								{me.registered ? (
									<>
										<MenuItem to={`/u/${me.name}`} onClick={() => setMenu(false)}>
											Profile
										</MenuItem>
										<MenuItem
											onClick={() => {
												setMenu(false);
												setAuthMode('password');
											}}
										>
											Change password
										</MenuItem>
										<MenuItem
											onClick={() => {
												setMenu(false);
												applyAuth(logout).catch((e) => toast.error(String(e)));
											}}
										>
											Sign out
										</MenuItem>
									</>
								) : (
									<>
										<div className="px-3 py-1.5 text-xs text-muted-foreground">
											Anonymous · rating {Math.round(me.rating)}
										</div>
										<MenuItem
											onClick={() => {
												setMenu(false);
												setAuthMode('login');
											}}
										>
											Sign in
										</MenuItem>
										<MenuItem
											onClick={() => {
												setMenu(false);
												setAuthMode('register');
											}}
										>
											Register
										</MenuItem>
										<MenuItem
											onClick={() => {
												setMenu(false);
												void rename();
											}}
										>
											Change name
										</MenuItem>
									</>
								)}
							</div>
						)}
					</div>
				</div>
			</header>
			<main className={cn('flex-1 min-h-0', !fill && 'overflow-auto')}>
				{fill ? (
					children
				) : (
					<div className="mx-auto w-full max-w-6xl px-3 sm:px-5 py-5">{children}</div>
				)}
			</main>
			<PrefsDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} />
			<AuthDialog mode={authMode} onClose={() => setAuthMode(null)} />
			<Tooltip />
		</div>
	);
}

function MenuItem({
	to,
	onClick,
	children,
}: {
	to?: string;
	onClick?: () => void;
	children: ReactNode;
}) {
	const cls =
		'block w-full text-left px-3 py-1.5 hover:bg-accent text-popover-foreground hover:no-underline';
	return to ? (
		<Link to={to} className={cls} onClick={onClick}>
			{children}
		</Link>
	) : (
		<button className={cls} onClick={onClick}>
			{children}
		</button>
	);
}

function Logo() {
	return (
		<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
			<g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
				<path d="M12 2.5 21 7v10l-9 4.5L3 17V7z" />
				<path d="M3 7l9 4.5L21 7M12 11.5V21.5" />
				<path d="M7.5 4.75l9 4.5M7.5 9.25l9 4.5M7.5 13.75l9 4.5" opacity="0.45" />
			</g>
		</svg>
	);
}
