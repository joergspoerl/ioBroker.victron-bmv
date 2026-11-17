import { VeDirectFrame } from "./veDirect/fields";
import { VeDirectParser } from "./veDirect/veDirectParser";

export interface SerialPortLike {
	isOpen: boolean;
	on(event: "data", listener: (data: Buffer) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
	on(event: "close", listener: () => void): this;
	removeListener(event: "data", listener: (data: Buffer) => void): this;
	removeListener(event: "error", listener: (error: Error) => void): this;
	removeListener(event: "close", listener: () => void): this;
	set(options: Record<string, boolean>, callback: (error?: Error | null) => void): void;
	close(callback: (error?: Error | null) => void): void;
}

export type SerialPortFactory = (path: string, options: { baudRate: number }, callback: (error?: Error | null) => void) => SerialPortLike;

export const SERIAL_OPEN_TIMEOUT_MS = 10000;
export const SERIAL_CLOSE_TIMEOUT_MS = 5000;

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (error: Error) => void;
}

interface PortState {
	closed: boolean;
	ready: boolean;
	failed: boolean;
	rejectPending: ((error: Error) => void) | undefined;
	closeListener: () => void;
	dataListener: (data: Buffer) => void;
}

class SerialOperationTimeoutError extends Error {
	constructor(operation: string, timeoutMs: number) {
		super(`Serial ${operation} timed out after ${timeoutMs} ms`);
		this.name = "SerialOperationTimeoutError";
	}
}

const defaultPortFactory: SerialPortFactory = (path, options, callback) => {
	// Load native bindings only for a real open, not for parser/unit tests.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { SerialPort } = require("serialport") as typeof import("serialport");
	return new SerialPort({ path, baudRate: options.baudRate }, callback) as unknown as SerialPortLike;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

export class VictronBmvCom {
	onFrame: ((frame: VeDirectFrame) => void) | undefined;
	onValidFrame: (() => void) | undefined;
	onError: ((error: Error) => void) | undefined;
	readonly parser = new VeDirectParser();
	private port: SerialPortLike | undefined;
	private openPromise: Promise<void> | undefined;
	private closePromise: Promise<void> | undefined;
	private closeRequestId = 0;
	private readonly portStates = new WeakMap<SerialPortLike, PortState>();
	private readonly closeWaiters = new WeakMap<SerialPortLike, () => void>();
	private readonly openTimeoutMs: number;
	private readonly closeTimeoutMs: number;

	constructor(
		private readonly portFactory: SerialPortFactory = defaultPortFactory,
		options: { openTimeoutMs?: number; closeTimeoutMs?: number } = {},
	) {
		this.openTimeoutMs = options.openTimeoutMs ?? SERIAL_OPEN_TIMEOUT_MS;
		this.closeTimeoutMs = options.closeTimeoutMs ?? SERIAL_CLOSE_TIMEOUT_MS;
		this.parser.onFrame = frame => {
			if (this.onFrame) {
				this.onFrame({ ...frame });
			}
		};
		this.parser.onValidFrame = () => {
			if (this.onValidFrame) {
				this.onValidFrame();
			}
		};
	}

	isOpen(): boolean {
		return this.port?.isOpen === true;
	}

	open(serialportPath: string): Promise<void> {
		if (this.openPromise) {
			return this.openPromise;
		}
		const operation = this.performOpen(serialportPath, this.closeRequestId);
		this.openPromise = operation;
		const clear = (): void => {
			if (this.openPromise === operation) {
				this.openPromise = undefined;
			}
		};
		void operation.then(clear, clear);
		return operation;
	}

	private async performOpen(serialportPath: string, closeRequest: number): Promise<void> {
		if (this.closePromise) {
			await this.closePromise.catch(() => undefined);
		}
		this.assertNotCloseRequested(closeRequest);

		const existing = this.port;
		if (existing) {
			const state = this.portStates.get(existing);
			if (existing.isOpen && state?.ready && !state.closed) {
				return;
			}
			if (existing.isOpen) {
				await this.closePort(existing);
			} else if (state?.failed && !state.closed) {
				// Keep its late-open callback/listeners alive, but do not let it
				// become the current session after a replacement opens.
				this.port = undefined;
			} else {
				this.cleanupPort(existing);
			}
		}
		this.assertNotCloseRequested(closeRequest);
		this.parser.reset();

		const openResult = deferred<void>();
		let port: SerialPortLike;
		const state: PortState = {
			closed: false,
			ready: false,
			failed: false,
			rejectPending: openResult.reject,
			closeListener: () => undefined,
			dataListener: () => undefined,
		};
		const openCallback = (error?: Error | null): void => {
			// A factory may legally call back synchronously. Deferring guarantees
			// that the returned port and all listeners have been installed first.
			queueMicrotask(() => {
				if (state.failed) {
					if (!error && port?.isOpen) {
						void this.closeLatePort(port);
					}
					return;
				}
				if (error) {
					openResult.reject(error);
				} else {
					openResult.resolve();
				}
			});
		};

		try {
			port = this.portFactory(serialportPath, { baudRate: 19200 }, openCallback);
			state.closeListener = () => this.handlePortClosed(port);
			state.dataListener = data => {
				if (this.port !== port || !state.ready || state.closed) {
					return;
				}
				try {
					this.parser.receive(Buffer.from(data));
				} catch (error) {
					this.reportError(error);
				}
			};
			this.portStates.set(port, state);
			this.port = port;
			port.on("error", this.errorListener);
			port.on("close", state.closeListener);

			await this.withTimeout(openResult.promise, this.openTimeoutMs, "open");
			state.rejectPending = undefined;
			this.assertPortUsable(port, state);
			this.assertNotCloseRequested(closeRequest);

			const setResult = deferred<void>();
			state.rejectPending = setResult.reject;
			port.set({ dtr: false, rts: false, cts: false, brk: false }, error => {
				if (error) setResult.reject(error);
				else setResult.resolve();
			});
			await this.withTimeout(setResult.promise, this.openTimeoutMs, "set");
			state.rejectPending = undefined;
			this.assertPortUsable(port, state);
			this.assertNotCloseRequested(closeRequest);

			port.on("data", state.dataListener);
			state.ready = true;
		} catch (error) {
			const normalized = this.asError(error);
			state.failed = true;
			state.ready = false;
			state.rejectPending = undefined;
			if (port!) {
				await this.handleOpenFailure(port, normalized);
			}
			throw normalized;
		}
	}

	close(): Promise<void> {
		this.closeRequestId++;
		if (this.port) {
			this.portStates.get(this.port)?.rejectPending?.(new Error("Serial close requested"));
		}
		if (this.closePromise) {
			return this.closePromise;
		}
		const operation = this.performClose();
		this.closePromise = operation;
		const clear = (): void => {
			if (this.closePromise === operation) {
				this.closePromise = undefined;
			}
		};
		void operation.then(clear, clear);
		return operation;
	}

	private async performClose(): Promise<void> {
		if (this.openPromise) {
			await this.openPromise.catch(() => undefined);
		}
		const port = this.port;
		if (!port) {
			this.parser.reset();
			return;
		}
		await this.closePort(port);
	}

	private async closePort(port: SerialPortLike): Promise<void> {
		const state = this.portStates.get(port);
		if (!state || state.closed || !port.isOpen) {
			this.cleanupPort(port);
			return;
		}
		state.ready = false;
		port.removeListener("data", state.dataListener);
		if (this.port === port) {
			this.parser.reset();
		}

		const callbackResult = deferred<void>();
		const closeEvent = deferred<void>();
		this.closeWaiters.set(port, () => closeEvent.resolve());
		try {
			port.close(error => error ? callbackResult.reject(error) : callbackResult.resolve());
			await this.withTimeout(Promise.race([callbackResult.promise, closeEvent.promise]), this.closeTimeoutMs, "close");
			if (!state.closed && port.isOpen) {
				throw new Error("Serial port remained open after close");
			}
			this.cleanupPort(port);
		} catch (error) {
			if (!state.closed && port.isOpen) {
				// Keep a still-open port referenced and retryable. Never lose it or
				// remove its error listener while the OS resource is alive.
				this.port = port;
				state.ready = false;
			} else {
				this.cleanupPort(port);
			}
			throw error;
		} finally {
			this.closeWaiters.delete(port);
		}
	}

	private async handleOpenFailure(port: SerialPortLike, error: Error): Promise<void> {
		const state = this.portStates.get(port);
		this.parser.reset();
		if (state) {
			port.removeListener("data", state.dataListener);
		}
		try {
			if (port.isOpen && !state?.closed) {
				await this.closePort(port);
			} else if (!(error instanceof SerialOperationTimeoutError && state?.failed)) {
				this.cleanupPort(port);
			}
		} catch (closeError) {
			this.reportError(closeError);
		}
		this.reportError(error);
	}

	private async closeLatePort(port: SerialPortLike): Promise<void> {
		try {
			await this.closePort(port);
		} catch (error) {
			this.reportError(error);
		}
	}

	private handlePortClosed(port: SerialPortLike): void {
		const state = this.portStates.get(port);
		if (!state || state.closed) {
			return;
		}
		state.closed = true;
		state.ready = false;
		state.rejectPending?.(new Error("Serial port closed while opening"));
		state.rejectPending = undefined;
		this.closeWaiters.get(port)?.();
		if (this.port === port) {
			this.port = undefined;
			this.parser.reset();
		}
		this.cleanupPort(port);
	}

	private assertPortUsable(port: SerialPortLike, state: PortState): void {
		if (state.closed || !port.isOpen) {
			throw new Error("Serial port closed while opening");
		}
	}

	private assertNotCloseRequested(closeRequest: number): void {
		if (closeRequest !== this.closeRequestId) {
			throw new Error("Serial open cancelled by close request");
		}
	}

	private cleanupPort(port: SerialPortLike): void {
		const state = this.portStates.get(port);
		if (this.port === port) {
			this.port = undefined;
		}
		if (state) {
			port.removeListener("data", state.dataListener);
			port.removeListener("close", state.closeListener);
			state.ready = false;
		}
		port.removeListener("error", this.errorListener);
	}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => reject(new SerialOperationTimeoutError(operation, timeoutMs)), timeoutMs);
			if (typeof timer.unref === "function") {
				timer.unref();
			}
			promise.then(
				value => {
					clearTimeout(timer);
					resolve(value);
				},
				error => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}

	private readonly errorListener = (error: Error): void => {
		this.reportError(error);
	};

	private asError(error: unknown): Error {
		return error instanceof Error ? error : new Error(String(error));
	}

	private reportError(error: unknown): void {
		const normalized = this.asError(error);
		if (this.onError) {
			this.onError(normalized);
		}
	}
}

export type Bmv_data = VeDirectFrame;
