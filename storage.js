// { playbackSpeed: number, speedIncrement: number, maxSpeed: number, rememberSpeed: boolean }

(function (global) {
	const KEY = "yt-speed-slider";

	const MIN_SPEED = 0.25;
	const ABS_MAX_SPEED = 16;

	const DEFAULTS = Object.freeze({
		playbackSpeed: 1,
		speedIncrement: 0.25,
		maxSpeed: 2,

		// true: every video starts at the last speed the user set
		// false: every new video starts at 1x
		rememberSpeed: true,
	});

	const clamp = (value, min, max, fallback) => {
		const n = typeof value === "number" ? value : parseFloat(value);
		return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
	};

	const clampSpeed = (v) =>
		clamp(v, MIN_SPEED, ABS_MAX_SPEED, DEFAULTS.playbackSpeed);
	const clampMaxSpeed = (v) => clamp(v, 1, ABS_MAX_SPEED, DEFAULTS.maxSpeed);
	const clampIncrement = (v) =>
		Number(clamp(v, 0.05, 4, DEFAULTS.speedIncrement).toFixed(2));

	const normalize = (value) => {
		const src = typeof value === "object" && value !== null ? value : {};
		const maxSpeed = clampMaxSpeed(src.maxSpeed);

		return {
			playbackSpeed: Math.min(maxSpeed, clampSpeed(src.playbackSpeed)),
			speedIncrement: clampIncrement(src.speedIncrement),
			maxSpeed,
			rememberSpeed:
				typeof src.rememberSpeed === "boolean"
					? src.rememberSpeed
					: DEFAULTS.rememberSpeed,
		};
	};

	async function get() {
		try {
			const stored = (await browser.storage.local.get(KEY))[KEY];
			return normalize(stored);
		} catch (e) {
			return normalize(null);
		}
	}

	let writeQueue = Promise.resolve();

	function set(patch) {
		const run = async () => {
			const next = normalize({ ...(await get()), ...patch });
			await browser.storage.local.set({ [KEY]: next });
			return next;
		};

		const result = writeQueue.then(run);
		writeQueue = result.catch(() => {});
		return result;
	}

	// Returns a function that removes the listener again.
	function onChange(callback) {
		const listener = (changes, area) => {
			if (area === "local" && changes[KEY]) {
				callback(normalize(changes[KEY].newValue));
			}
		};
		browser.storage.onChanged.addListener(listener);
		return () => browser.storage.onChanged.removeListener(listener);
	}

	global.YTSpeedSettings = {
		MIN_SPEED,
		DEFAULTS,
		clampSpeed,
		get,
		set,
		onChange,
	};
})(typeof window !== "undefined" ? window : globalThis);
