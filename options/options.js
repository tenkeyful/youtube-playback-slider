const YTSpeedSettings = window.YTSpeedSettings;
let statusTimer = null;

const els = () => {
	const ids = ["max-speed", "current-speed", "remember-speed", "status"];
	const found = {};
	for (const id of ids) found[id] = document.getElementById(id);
	return found;
};

const setStatus = (el, text) => {
	el.status.textContent = text;
	if (statusTimer !== null) window.clearTimeout(statusTimer);
	statusTimer = window.setTimeout(() => {
		el.status.textContent = "";
		statusTimer = null;
	}, 1400);
};

const fillForm = (el, settings) => {
	el["max-speed"].value = settings.maxSpeed;
	el["current-speed"].value = settings.playbackSpeed;
	el["remember-speed"].checked = settings.rememberSpeed;
};

async function init() {
	const el = els();
	fillForm(el, await YTSpeedSettings.get());

	el["max-speed"].addEventListener("change", async () => {
		const saved = await YTSpeedSettings.set({
			maxSpeed: el["max-speed"].value,
		});
		el["max-speed"].value = saved.maxSpeed;
		setStatus(el, "Saved");
	});

	el["current-speed"].addEventListener("change", async () => {
		const saved = await YTSpeedSettings.set({
			playbackSpeed: el["current-speed"].value,
		});
		el["current-speed"].value = saved.playbackSpeed;
		setStatus(el, "Saved");
	});

	el["remember-speed"].addEventListener("change", async () => {
		const saved = await YTSpeedSettings.set({
			rememberSpeed: el["remember-speed"].checked,
		});
		el["remember-speed"].checked = saved.rememberSpeed;
		setStatus(el, "Saved");
	});

	YTSpeedSettings.onChange((next) => {
		if (document.activeElement !== el["max-speed"])
			el["max-speed"].value = next.maxSpeed;
		if (document.activeElement !== el["current-speed"])
			el["current-speed"].value = next.playbackSpeed;
		el["remember-speed"].checked = next.rememberSpeed;
	});
}

document.addEventListener(
	"DOMContentLoaded",
	() => {
		init();
	},
	{ once: true },
);
