import { EventEmitter } from "events";
import { VeDirectFrame } from "./veDirect/fields";
import { VeDirectParser } from "./veDirect/veDirectParser";

export interface SerialPortLike extends EventEmitter {
	isOpen: boolean;
	set(options: Record<string, boolean>, callback: (error?: Error | null) => void): void;
	close(callback: (error?: Error | null) => void): void;
}

export type SerialPortFactory = (path: string, options: { baudRate: number }, callback: (error?: Error | null) => void) => SerialPortLike;

const defaultPortFactory: SerialPortFactory = (path, options, callback) => {
	// Load native bindings only for a real open, not for parser/unit tests.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const SerialPort = require("serialport") as typeof import("serialport");
	return new SerialPort(path, options, callback) as unknown as SerialPortLike;
};

export class VictronBmvCom {
	onFrame: ((frame: VeDirectFrame) => void) | undefined;
	onValidFrame: (() => void) | undefined;
	onError: ((error: Error) => void) | undefined;
	readonly parser = new VeDirectParser();
	private port: SerialPortLike | undefined;
	private openPromise: Promise<void> | undefined;
	private closePromise: Promise<void> | undefined;
	private readonly closeListeners = new WeakMap<SerialPortLike, () => void>();
	private readonly dataListener: (data: Buffer) => void;

	constructor(private readonly portFactory: SerialPortFactory = defaultPortFactory) {
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
		this.dataListener = data => {
			try {
				this.parser.receive(Buffer.from(data));
			} catch (error) {
				this.reportError(error);
			}
		};
	}

	isOpen(): boolean {
		return this.port?.isOpen === true;
	}

	async open(serialportPath: string): Promise<void> {
		if (this.closePromise) {
			await this.closePromise.catch(() => undefined);
		}
		if (this.isOpen()) {
			return;
		}
		if (this.openPromise) {
			return this.openPromise;
		}
		this.parser.reset();
		const operation = new Promise<void>((resolve, reject) => {
			let port: SerialPortLike;
			try {
				port = this.portFactory(serialportPath, { baudRate: 19200 }, openError => {
					if (openError) {
						this.openFailed(port, openError);
						reject(openError);
						return;
					}
					port.set({ dtr: false, rts: false, cts: false, brk: false }, setError => {
						if (setError) {
							this.openFailed(port, setError);
							reject(setError);
							return;
						}
						port.on("data", this.dataListener);
						const closeListener = (): void => {
							if (this.port === port) {
								this.port = undefined;
								this.parser.reset();
							}
						};
						this.closeListeners.set(port, closeListener);
						port.on("close", closeListener);
						resolve();
					});
				});
				this.port = port;
				port.on("error", this.errorListener);
			} catch (error) {
				reject(error);
			}
		});
		this.openPromise = operation;
		try {
			await operation;
		} finally {
			this.openPromise = undefined;
		}
	}

	close(): Promise<void> {
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
		port.removeListener("data", this.dataListener);
		this.parser.reset();
		try {
			if (port.isOpen) {
				await new Promise<void>((resolve, reject) => {
					port.close(error => error ? reject(error) : resolve());
				});
			}
			if (port.isOpen) {
				throw new Error("Serial port remained open after close");
			}
			this.cleanupPort(port);
		} catch (error) {
			if (port.isOpen) {
				// Keep a still-open port referenced and retryable. Never lose it or
				// remove its error listener while the OS resource is alive.
				this.port = port;
			} else {
				this.cleanupPort(port);
			}
			throw error;
		}
	}

	private openFailed(port: SerialPortLike, error: Error): void {
		if (this.port === port) {
			this.port = undefined;
		}
		this.parser.reset();
		port.removeListener("data", this.dataListener);
		this.removeCloseListener(port);
		if (port.isOpen) {
			port.close(closeError => {
				if (closeError) {
					this.reportError(closeError);
				}
			});
		} else {
			port.removeListener("error", this.errorListener);
		}
		this.reportError(error);
	}

	private cleanupPort(port: SerialPortLike): void {
		if (this.port === port) {
			this.port = undefined;
		}
		port.removeListener("data", this.dataListener);
		this.removeCloseListener(port);
		port.removeListener("error", this.errorListener);
	}

	private removeCloseListener(port: SerialPortLike): void {
		const listener = this.closeListeners.get(port);
		if (listener) {
			port.removeListener("close", listener);
			this.closeListeners.delete(port);
		}
	}

	private readonly errorListener = (error: Error): void => {
		this.reportError(error);
	};

	private reportError(error: unknown): void {
		const normalized = error instanceof Error ? error : new Error(String(error));
		if (this.onError) {
			this.onError(normalized);
		}
	}
}

export type Bmv_data = VeDirectFrame;
