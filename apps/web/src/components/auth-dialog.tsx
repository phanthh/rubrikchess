import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { login, register } from '@/net/api';
import { applyAuth } from '@/net/auth';
import { useState } from 'react';
import { toast } from 'sonner';

export type AuthMode = 'register' | 'login';

export function AuthDialog({ mode, onClose }: { mode: AuthMode | null; onClose: () => void }) {
	const [name, setName] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const isRegister = mode === 'register';

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		try {
			await applyAuth(() => (isRegister ? register(name, password) : login(name, password)));
			setName('');
			setPassword('');
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={mode !== null} onClose={onClose} title={isRegister ? 'Create account' : 'Sign in'}>
			<form className="flex flex-col gap-3" onSubmit={submit}>
				{isRegister && (
					<p className="text-sm text-muted-foreground">
						Claims your current anonymous player, rating included. 3–32 chars, letters, digits, _ and -.
					</p>
				)}
				<input
					className="field"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="username"
					autoComplete="username"
					autoFocus
				/>
				<input
					className="field"
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="password"
					autoComplete={isRegister ? 'new-password' : 'current-password'}
				/>
				<Button type="submit" disabled={!name || !password || busy}>
					{isRegister ? 'Register' : 'Sign in'}
				</Button>
			</form>
		</Dialog>
	);
}
