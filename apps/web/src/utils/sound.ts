import { prefs } from '@/store/prefs';

export type SoundName = 'move' | 'capture' | 'rotate' | 'lowtime' | 'end' | 'notify' | 'error';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio() {
	if (!ctx) {
		ctx = new AudioContext();
		master = ctx.createGain();
		master.connect(ctx.destination);
	}
	if (ctx.state === 'suspended') void ctx.resume();
	master!.gain.value = prefs().volume;
	return { ctx, out: master! };
}

function tone(
	ctx: AudioContext,
	out: AudioNode,
	freq: number,
	at: number,
	dur: number,
	type: OscillatorType = 'sine',
	gain = 0.4,
	glideTo?: number,
) {
	const osc = ctx.createOscillator();
	const g = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, at);
	if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
	g.gain.setValueAtTime(gain, at);
	g.gain.exponentialRampToValueAtTime(0.001, at + dur);
	osc.connect(g).connect(out);
	osc.start(at);
	osc.stop(at + dur + 0.02);
}

function noise(
	ctx: AudioContext,
	out: AudioNode,
	at: number,
	dur: number,
	gain: number,
	filterFrom: number,
	filterTo: number,
) {
	const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	const src = ctx.createBufferSource();
	src.buffer = buf;
	const f = ctx.createBiquadFilter();
	f.type = 'bandpass';
	f.Q.value = 0.8;
	f.frequency.setValueAtTime(filterFrom, at);
	f.frequency.exponentialRampToValueAtTime(filterTo, at + dur);
	const g = ctx.createGain();
	g.gain.setValueAtTime(gain, at);
	g.gain.exponentialRampToValueAtTime(0.001, at + dur);
	src.connect(f).connect(g).connect(out);
	src.start(at);
}

/** Synthesised cues; no asset files to ship or license. */
export function play(name: SoundName) {
	if (!prefs().sound) return;
	let a: ReturnType<typeof audio>;
	try {
		a = audio();
	} catch {
		return;
	}
	const { ctx, out } = a;
	const t = ctx.currentTime;
	switch (name) {
		case 'move':
			noise(ctx, out, t, 0.08, 0.5, 2500, 600);
			tone(ctx, out, 180, t, 0.09, 'sine', 0.35, 90);
			break;
		case 'capture':
			noise(ctx, out, t, 0.16, 0.7, 1800, 200);
			tone(ctx, out, 140, t, 0.18, 'triangle', 0.5, 50);
			break;
		case 'rotate':
			noise(ctx, out, t, 0.45, 0.35, 300, 2400);
			tone(ctx, out, 110, t + 0.3, 0.12, 'sine', 0.3, 70);
			break;
		case 'lowtime':
			tone(ctx, out, 880, t, 0.08, 'square', 0.12);
			tone(ctx, out, 880, t + 0.14, 0.08, 'square', 0.12);
			break;
		case 'end':
			[523.25, 659.25, 783.99].forEach((f, i) => tone(ctx, out, f, t + i * 0.06, 0.7, 'triangle', 0.22));
			break;
		case 'notify':
			tone(ctx, out, 660, t, 0.12, 'sine', 0.3);
			tone(ctx, out, 880, t + 0.13, 0.2, 'sine', 0.3);
			break;
		case 'error':
			tone(ctx, out, 220, t, 0.18, 'sawtooth', 0.15, 160);
			break;
	}
}
