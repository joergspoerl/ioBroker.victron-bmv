import * as utils from "@iobroker/adapter-core";
import { VE_DIRECT_FIELDS, VeDirectFrame, VeDirectValue } from "./veDirect/fields";
import { VictronBmvCom } from "./victronBmvCom";

const WATCHDOG_INTERVAL_MS = 1000;
const DATA_TIMEOUT_MS = 5000;
const RECONNECT_COOLDOWN_MS = 5000;

export class VictronBmv extends utils.Adapter {
	readonly bmv = new VictronBmvCom();
	private lastFrameTime = 0;
	private lastOpenAttempt = 0;
	private serialPortPath = "";
	private watchDogInterval: ReturnType<typeof setInterval> | undefined;
	private activeWatchDog: Promise<void> | undefined;
	private readyPromise: Promise<void> | undefined;
	private frameQueue: Promise<void> = Promise.resolve();
	private connectionState: boolean | undefined;
	private connectionRequested: boolean | undefined;
	private unloaded = false;
	private unloadPromise: Promise<void> | undefined;
	private readonly stateQueues = new Map<string, Promise<void>>();
	private readonly lastStateValues = new Map<string, VeDirectValue>();

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({ ...options, name: "victron-bmv" });
		this.on("ready", this.handleReady.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	private handleReady(): void {
		if (this.readyPromise) {
			return;
		}
		const operation = this.onReady().catch(async error => {
			this.log.error(`Could not initialize VE.Direct adapter: ${this.errorText(error)}`);
			await this.safeSetConnectionState(false);
		});
		this.readyPromise = operation;
		void operation.catch(error => {
			this.log.error(`VE.Direct ready handler failed: ${this.errorText(error)}`);
		});
	}

	private async onReady(): Promise<void> {
		if (this.unloaded) {
			return;
		}
		await this.initObjects();
		if (this.unloaded) {
			return;
		}
		await this.safeSetConnectionState(false);
		if (this.unloaded) {
			return;
		}
		this.serialPortPath = (this.config.serialPortPath || "").trim();
		if (!this.serialPortPath || this.serialPortPath === "/dev/xxx") {
			this.log.error("Configure a valid VE.Direct serial port before starting the adapter");
			return;
		}
		this.bmv.onValidFrame = () => {
			this.lastFrameTime = Date.now();
			void this.safeSetConnectionState(true);
		};
		this.bmv.onFrame = frame => {
			this.enqueueFrame({ ...frame });
		};
		this.bmv.onError = error => {
			this.log.error(`VE.Direct serial error: ${error.message}`);
		};
		if (this.unloaded) {
			return;
		}
		void this.watchDog();
		this.watchDogInterval = setInterval(() => void this.watchDog(), WATCHDOG_INTERVAL_MS);
	}

	private async initObjects(): Promise<void> {
		const connectionCommon: ioBroker.StateCommon = {
			name: "Fresh valid VE.Direct frame received",
			type: "boolean",
			role: "indicator.connected",
			read: true,
			write: false,
			def: false,
		};
		await this.setObjectNotExistsAsync("info.connection", {
			type: "state",
			common: connectionCommon,
			native: {},
		});
		if (this.unloaded) return;
		await this.extendObjectAsync("info.connection", { common: connectionCommon });
		if (this.unloaded) return;
		for (const field of Object.values(VE_DIRECT_FIELDS)) {
			if (this.unloaded) return;
			const common: ioBroker.StateCommon = {
				name: field.label,
				type: field.type,
				role: field.role,
				desc: field.descr,
				read: true,
				write: false,
				unit: field.unit,
			};
			await this.setObjectNotExistsAsync(field.id, { type: "state", common, native: {} });
			if (this.unloaded) return;
			await this.extendObjectAsync(field.id, { common });
			if (this.unloaded) return;
		}
	}

	private watchDog(): Promise<void> {
		if (this.activeWatchDog) {
			return this.activeWatchDog;
		}
		const operation = this.performWatchDog();
		this.activeWatchDog = operation;
		const clear = (): void => {
			if (this.activeWatchDog === operation) {
				this.activeWatchDog = undefined;
			}
		};
		void operation.then(clear, clear);
		return operation;
	}

	private isFresh(): boolean {
		return this.lastFrameTime > 0 && Date.now() - this.lastFrameTime < DATA_TIMEOUT_MS;
	}

	private async performWatchDog(): Promise<void> {
		if (this.unloaded || !this.serialPortPath) {
			return;
		}
		if (this.isFresh()) {
			return;
		}
		await this.safeSetConnectionState(false);
		if (this.unloaded || this.isFresh()) {
			return;
		}
		const now = Date.now();
		if (now - this.lastOpenAttempt < RECONNECT_COOLDOWN_MS) {
			return;
		}
		this.lastOpenAttempt = now;
		try {
			if (this.bmv.isOpen()) {
				await this.bmv.close();
				if (this.unloaded) {
					return;
				}
			}
			if (this.unloaded) {
				return;
			}
			await this.bmv.open(this.serialPortPath);
			// Opening a port is not a device connection. info.connection becomes
			// true only after the first checksum-valid frame.
		} catch (error) {
			if (!this.unloaded) {
				this.log.error(`Could not open/reopen VE.Direct port: ${this.errorText(error)}`);
				await this.safeSetConnectionState(false);
			}
		}
	}

	private enqueueFrame(frame: VeDirectFrame): void {
		if (this.unloaded) {
			return;
		}
		const snapshot = { ...frame };
		const operation = this.frameQueue.then(() => this.publishFrame(snapshot));
		this.frameQueue = operation.catch(error => {
			this.log.error(`Could not process VE.Direct frame: ${this.errorText(error)}`);
		});
	}

	private async publishFrame(frame: VeDirectFrame): Promise<void> {
		if (this.unloaded) {
			return;
		}
		await this.safeSetConnectionState(true);
		for (const [key, value] of Object.entries(frame)) {
			if (this.unloaded) {
				return;
			}
			if (this.lastStateValues.has(key) && this.lastStateValues.get(key) === value) {
				continue;
			}
			try {
				await this.writeState(key, value);
				this.lastStateValues.set(key, value);
			} catch (error) {
				this.log.error(`Could not publish ${key}: ${this.errorText(error)}`);
			}
		}
	}

	private writeState(key: string, value: VeDirectValue): Promise<void> {
		const previous = this.stateQueues.get(key) ?? Promise.resolve();
		const result = previous.catch(() => undefined).then(() => this.setStateAsync(key, { val: value, ack: true })).then(() => undefined);
		const tracked = result.then(() => undefined, () => undefined);
		this.stateQueues.set(key, tracked);
		void tracked.then(() => {
			if (this.stateQueues.get(key) === tracked) {
				this.stateQueues.delete(key);
			}
		});
		return result;
	}

	private async safeSetConnectionState(connected: boolean): Promise<void> {
		if (this.connectionRequested === connected) {
			return;
		}
		this.connectionRequested = connected;
		try {
			await this.writeState("info.connection", connected);
			this.connectionState = connected;
		} catch (error) {
			if (this.connectionRequested === connected) {
				this.connectionRequested = undefined;
			}
			this.log.error(`Could not update info.connection: ${this.errorText(error)}`);
		}
	}

	private onUnload(callback: () => void): void {
		if (this.unloadPromise) {
			void this.unloadPromise.then(callback, callback);
			return;
		}
		this.unloaded = true;
		if (this.watchDogInterval) {
			clearInterval(this.watchDogInterval);
			this.watchDogInterval = undefined;
		}
		this.bmv.onFrame = undefined;
		this.bmv.onValidFrame = undefined;
		const pendingWatchDog = this.activeWatchDog;
		const pendingReady = this.readyPromise;
		const operation = (async () => {
			const pending: Promise<void>[] = [
				this.bmv.close().catch(error => this.log.error(`Error closing VE.Direct port: ${this.errorText(error)}`)),
			];
			if (pendingWatchDog) pending.push(pendingWatchDog.catch(() => undefined));
			if (pendingReady) pending.push(pendingReady.catch(() => undefined));
			await Promise.all(pending);
			await this.safeSetConnectionState(false);
			await Promise.all([...this.stateQueues.values()].map(promise => promise.catch(() => undefined)));
		})();
		this.unloadPromise = operation;
		void operation.then(callback, error => {
			this.log.error(`Error during VE.Direct unload: ${this.errorText(error)}`);
			callback();
		});
	}

	private errorText(error: unknown): string {
		return error instanceof Error ? error.stack || error.message : String(error);
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new VictronBmv(options);
	module.exports.VictronBmv = VictronBmv;
} else {
	(() => new VictronBmv())();
}
