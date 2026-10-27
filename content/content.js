(function () {
	const YTSpeedSettings = window.YTSpeedSettings;
	if (!YTSpeedSettings) {
		return;
	}

	const MIN = YTSpeedSettings.MIN_SPEED;

	// YouTube resets video.playbackRate when a video loads and after ads, so
	// our speed is re-applied on these events. Our own speed is the source of
	// truth: a rate change we didn't make is never adopted as the new speed.
	const ENFORCE_EVENTS = ["loadedmetadata", "play", "playing"];

	// for the remember current speed option
	const videoKey = () =>
		new URLSearchParams(location.search).get("v") || location.pathname;

	class Instance {
		/**
		 * @param {HTMLVideoElement} video
		 * @param {Element} volumeArea
		 */
		constructor(video, volumeArea) {
			this._video = video;
			this._volumeArea = volumeArea;
			this._settings = YTSpeedSettings.DEFAULTS;

			this._targetSpeed = YTSpeedSettings.DEFAULTS.playbackSpeed;
			this._videoId = videoKey();

			this._saveTimer = null;
			this._saving = false;
			this._saveAgain = false;

			this._ready = false; // settings loaded from storage yet?
			this._destroyed = false;
			this._cleanups = []; // undo functions run by destroy()

			this._removeExisting();
			this._build();
			this._bind();

			this._loadState();
			this._cleanups.push(
				YTSpeedSettings.onChange((next) => {
					const pending = this._saveTimer !== null || this._saving;
					this._settings = pending
						? { ...next, playbackSpeed: this._targetSpeed }
						: next;
					if (!pending) this._targetSpeed = next.playbackSpeed;
					this._render();
				}),
			);
		}

		_removeExisting() {
			const existing = document.querySelector(".yt-speed-slider-area");
			if (existing) existing.remove();
		}

		_build() {
			this._volumeArea.style.display = "none";

			// Built with DOM calls instead of innerHTML: static markup, but the
			// add-on linter (and reviewers) flag any innerHTML assignment.
			const SVG_NS = "http://www.w3.org/2000/svg";
			const make = (tag, className, attrs = {}, ns) => {
				const node = ns
					? document.createElementNS(ns, tag)
					: document.createElement(tag);
				if (className) node.setAttribute("class", className);
				for (const [name, value] of Object.entries(attrs))
					node.setAttribute(name, value);
				return node;
			};

			const area = make("div", "ytp-volume-area yt-speed-slider-area");

			// Button: speedometer icon + number (CSS cross-fades them on hover)
			const btn = make("button", "yt-speed-slider-btn", { type: "button" });
			const slot = make("span", "yt-speed-slider-slot");
			const icon = make(
				"svg",
				"yt-speed-slider-icon",
				{ viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
				SVG_NS,
			);
			icon.append(
				make(
					"path",
					null,
					{
						fill: "none",
						stroke: "currentColor",
						"stroke-width": "1.8",
						"stroke-linecap": "round",
						d: "M17.66 4.75A9.2 9.2 0 1 0 21 10.09",
					},
					SVG_NS,
				),
				make(
					"path",
					null,
					{
						fill: "currentColor",
						d: "M11.25 10.55L19.1 7.55 19.5 8.25 13.15 13.85Z",
					},
					SVG_NS,
				),
				make(
					"circle",
					null,
					{ fill: "currentColor", cx: "12.2", cy: "12.2", r: "1.9" },
					SVG_NS,
				),
			);
			const value = make("span", "yt-speed-slider-value");
			slot.append(icon, value);
			btn.append(slot);

			// Slider panel
			const panel = make("div", "yt-speed-slider-panel");
			const slider = make("div", "yt-speed-slider-slider", {
				tabindex: "0",
				role: "slider",
				"aria-label": "Playback speed",
				"aria-valuemin": String(MIN),
				"aria-valuenow": "1",
			});
			const trackBg = make("div", "yt-speed-slider-track-bg");
			const handle = make("div", "yt-speed-slider-handle");
			slider.append(trackBg, make("div", "yt-speed-slider-fill"), handle);
			panel.append(slider);

			area.append(btn, panel);
			this._volumeArea.insertAdjacentElement("afterend", area);

			this._area = area;
			this._btn = btn;
			this._valueEl = value;
			this._slider = slider;
			this._handle = handle;
		}

		_bind() {
			this._btn.addEventListener("click", () => this._setSpeed(1));

			this._slider.addEventListener(
				"pointerdown",
				this._onPointerDown.bind(this),
			);
			this._area.addEventListener("wheel", this._onWheel.bind(this), {
				passive: false,
			});
			this._slider.addEventListener("keydown", this._onKeydown.bind(this));

			this._area.addEventListener("focusin", (e) => {
				if (e.target.matches(":focus-visible"))
					this._area.classList.add("is-focused");
			});
			this._area.addEventListener("focusout", () => {
				this._area.classList.remove("is-focused");
			});

			const enforce = () => this._enforce();
			for (const type of ENFORCE_EVENTS)
				this._video.addEventListener(type, enforce);

			const onNavigate = () => this._onNavigate();
			document.addEventListener("yt-navigate-finish", onNavigate);

			this._cleanups.push(() => {
				for (const type of ENFORCE_EVENTS)
					this._video.removeEventListener(type, enforce);
				document.removeEventListener("yt-navigate-finish", onNavigate);
			});
		}

		// -- pointer drag --
		_onPointerDown(e) {
			this._slider.classList.add("dragging");
			this._slider.setPointerCapture(e.pointerId);
			// Measured once per drag. Like YouTube's own slider, the handle's
			// centre travels from half a handle in to half a handle from the end.
			const rect = this._slider.getBoundingClientRect();
			const handleW = this._handle.offsetWidth;
			this._applyPointerX(e.clientX, rect, handleW);

			const onMove = (ev) => this._applyPointerX(ev.clientX, rect, handleW);
			const onEnd = () => {
				this._flushSave();
				this._slider.classList.remove("dragging");
				this._slider.removeEventListener("pointermove", onMove);
				this._slider.removeEventListener("pointerup", onEnd);
				this._slider.removeEventListener("pointercancel", onEnd);
			};
			this._slider.addEventListener("pointermove", onMove);
			this._slider.addEventListener("pointerup", onEnd);
			this._slider.addEventListener("pointercancel", onEnd);
		}

		_applyPointerX(clientX, rect, handleW) {
			const travel = Math.max(1, rect.width - handleW);
			const ratio = Math.min(
				1,
				Math.max(0, (clientX - rect.left - handleW / 2) / travel),
			);

			const max = this._settings.maxSpeed;
			const raw = MIN + ratio * (max - MIN);
			const step = this._settings.speedIncrement;
			const snapped = Math.round(raw / step) * step;

			this._setSpeed(snapped);
		}

		// -- wheel + keyboard --
		_onWheel(e) {
			e.preventDefault();
			const dir = e.deltaY < 0 ? 1 : -1;
			this._nudge(dir);

			this._slider.classList.add("dragging");
			clearTimeout(this._wheelTimer);
			this._wheelTimer = setTimeout(
				() => this._slider.classList.remove("dragging"),
				300,
			);
		}

		_onKeydown(e) {
			switch (e.key) {
				case "ArrowRight":
				case "ArrowUp":
					e.preventDefault();
					this._nudge(1);
					break;
				case "ArrowLeft":
				case "ArrowDown":
					e.preventDefault();
					this._nudge(-1);
					break;
				case "Home":
					e.preventDefault();
					this._setSpeed(MIN);
					break;
				case "End":
					e.preventDefault();
					this._setSpeed(this._settings.maxSpeed);
					break;
				case "Enter":
				case " ":
					e.preventDefault();
					this._setSpeed(1);
					break;
			}
		}

		async _loadState() {
			this._settings = await YTSpeedSettings.get();
			if (this._destroyed) return;
			this._targetSpeed = this._settings.playbackSpeed;
			this._ready = true;
			if (!this._settings.rememberSpeed) this._setSpeed(1);
			else this._render();
		}

		_onNavigate() {
			if (!this._video.isConnected) return;
			const key = videoKey();
			if (key === this._videoId) return;
			this._videoId = key;
			if (!this._settings.rememberSpeed) this._setSpeed(1);
		}

		_nudge(direction) {
			this._setSpeed(
				this._targetSpeed + direction * this._settings.speedIncrement,
			);
		}

		_setSpeed(value) {
			const clamped = Math.min(
				this._settings.maxSpeed,
				YTSpeedSettings.clampSpeed(value),
			);
			this._applySpeed(Math.round(clamped * 100) / 100);
		}

		_applySpeed(speed) {
			this._targetSpeed = speed;
			this._settings = { ...this._settings, playbackSpeed: speed };
			this._render();
			this._scheduleSave();
		}

		_scheduleSave() {
			if (this._saveTimer !== null) return;
			this._saveTimer = setTimeout(() => this._flushSave(), 150);
		}

		async _flushSave() {
			if (this._saveTimer !== null) {
				clearTimeout(this._saveTimer);
				this._saveTimer = null;
			}
			if (this._saving) {
				this._saveAgain = true;
				return;
			}
			this._saving = true;
			try {
				do {
					this._saveAgain = false;
					await YTSpeedSettings.set({ playbackSpeed: this._targetSpeed });
				} while (this._saveAgain);
			} catch (e) {
			} finally {
				this._saving = false;
			}
		}

		// Puts our speed on the video if something else (YouTube) changed it.
		_pushRate() {
			const speed = this._settings.playbackSpeed;
			if (Math.abs(this._video.playbackRate - speed) > 0.001) {
				this._video.playbackRate = speed;
			}
		}

		_enforce() {
			// Before settings have loaded we'd only be enforcing the default (1x).
			if (this._ready && !this._destroyed) this._pushRate();
		}

		// True if this instance is still wired to this player and still in the DOM.
		isAttachedTo(video, volumeArea) {
			return (
				!this._destroyed &&
				this._video === video &&
				this._volumeArea === volumeArea &&
				this._area.isConnected &&
				volumeArea.nextElementSibling === this._area
			);
		}

		destroy() {
			this._destroyed = true;
			if (this._saveTimer !== null) this._flushSave(); // don't lose a pending save
			clearTimeout(this._wheelTimer);
			for (const undo of this._cleanups) undo();
			this._cleanups = [];
			this._area.remove();
		}

		_render() {
			const speed = this._settings.playbackSpeed;
			const max = this._settings.maxSpeed;

			this._pushRate();

			this._valueEl.textContent = speed.toFixed(2);
			this._slider.setAttribute("aria-valuenow", String(speed));
			this._slider.setAttribute("aria-valuemax", String(max));
			this._area.style.setProperty(
				"--yssp-value-w",
				max >= 10 ? "4.6ch" : "3.6ch",
			);

			const ratio = Math.min(1, Math.max(0, (speed - MIN) / (max - MIN)));
			this._slider.style.setProperty("--yssp-ratio", String(ratio));
		}
	}

	// YouTube is a SPA that builds and rebuilds its player controls whenever
	// it likes (first load, navigation, fullscreen, ads), so one attempt at
	// load time isn't enough. Instead we check on every DOM change (at most
	// once per frame) and (re)attach whenever the pill is missing.
	let current = null;

	function tryAttach() {
		const volumeArea = document.querySelector(
			".html5-video-player .ytp-volume-area:not(.yt-speed-slider-area)",
		);
		if (!volumeArea) return;

		// The player's own <video>, not just the first one on the page.
		const video = volumeArea
			.closest(".html5-video-player")
			.querySelector("video");
		if (!video) return;

		if (current && current.isAttachedTo(video, volumeArea)) return;

		if (current) current.destroy();
		current = new Instance(video, volumeArea);
	}

	let attachQueued = false;
	function scheduleAttach() {
		if (attachQueued) return;
		attachQueued = true;
		requestAnimationFrame(() => {
			attachQueued = false;
			tryAttach();
		});
	}

	new MutationObserver(scheduleAttach).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
	document.addEventListener("yt-navigate-finish", scheduleAttach);
	document.addEventListener("fullscreenchange", scheduleAttach);
	window.addEventListener("pageshow", scheduleAttach);

	tryAttach();
})();
