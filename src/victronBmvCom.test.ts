import { EventEmitter } from "events";
import { expect } from "chai";
import { VeDirectFrame } from "./veDirect/fields";
import { SerialPortLike } from "./victronBmvCom";
import { VictronBmvCom } from "./victronBmvCom";

class FakeSerialPort extends EventEmitter implements SerialPortLike {
	isOpen = false;
	setCalls = 0;
	closeCalls = 0;
	failOpen: Error | undefined;
	failSet: Error | undefined;
	failClose: Error | undefined;
	closeGate: Promise<void> | undefined;
	emitCloseOnClose = true;

	set(_options: Record<string, boolean>, callback: (error?: Error | null) => void): void {
		this.setCalls++;
		callback(this.failSet ?? null);
	}

	close(callback: (error?: Error | null) => void): void {
		this.closeCalls++;
		const finish = (): void => {
			if (this.failClose) {
				callback(this.failClose);
				return;
			}
			this.isOpen = false;
			if (this.emitCloseOnClose) this.emit("close");
			callback(null);
		};
		if (this.closeGate) void this.closeGate.then(finish);
		else finish();
	}
}

function makeFrame(fields: [string, string][]): Buffer {
	const body = Buffer.from(`\r\n${fields.map(([label, value]) => `${label}\t${value}\r\n`).join("")}Checksum\t`);
	let sum = 0;
	for (const byte of body) {
		sum = (sum + byte) & 0xff;
	}
	return Buffer.concat([body, Buffer.from([(256 - sum) & 0xff])]);
}

describe("VictronBmvCom serial lifecycle", () => {
	it("opens 19200 8N1-compatible serial and receives validated frames", async () => {
		const port = new FakeSerialPort();
		let factoryCalls = 0;
		let baudRate = 0;
		const frames: VeDirectFrame[] = [];
		const com = new VictronBmvCom((_path, options, callback) => {
			factoryCalls++;
			baudRate = options.baudRate;
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		com.onFrame = frame => frames.push(frame);

		await com.open("fake");
		port.emit("data", makeFrame([["V", "13118"], ["I", "-1000"]]));

		expect(com.isOpen()).to.equal(true);
		expect(factoryCalls).to.equal(1);
		expect(baudRate).to.equal(19200);
		expect(port.setCalls).to.equal(1);
		expect(frames).to.deep.equal([{ V: 13.118, I: -1 }]);
		await com.close();
		expect(com.isOpen()).to.equal(false);
		expect(port.closeCalls).to.equal(1);
	});

	it("handles open and set errors without an unhandled error event", async () => {
		for (const failure of ["open", "set"]) {
			const port = new FakeSerialPort();
			const error = new Error(`${failure} failed`);
			if (failure === "open") port.failOpen = error;
			else port.failSet = error;
			const reported: Error[] = [];
			const com = new VictronBmvCom((_path, _options, callback) => {
				process.nextTick(() => {
					if (failure !== "open") port.isOpen = true;
					callback(port.failOpen);
				});
				return port;
			});
			com.onError = error => reported.push(error);
			try {
				await com.open("fake");
				expect.fail("open should reject");
			} catch (actual) {
				expect(actual).to.equal(error);
			}
			expect(reported).to.deep.equal([error]);
			expect(com.isOpen()).to.equal(false);
			if (failure === "set") expect(port.closeCalls).to.equal(1);
			await com.close();
		}
	});

	it("uses only one port while an open is pending", async () => {
		const port = new FakeSerialPort();
		let factoryCalls = 0;
		let completeOpen!: () => void;
		const gate = new Promise<void>(resolve => completeOpen = resolve);
		const com = new VictronBmvCom((_path, _options, callback) => {
			factoryCalls++;
			void gate.then(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		const first = com.open("fake");
		const second = com.open("fake");
		completeOpen();
		await Promise.all([first, second]);
		expect(factoryCalls).to.equal(1);
		await com.close();
	});

	it("handles runtime errors and a close after an already closed port", async () => {
		const port = new FakeSerialPort();
		const reported: Error[] = [];
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		com.onError = error => reported.push(error);
		await com.open("fake");
		const error = new Error("runtime");
		port.emit("error", error);
		expect(reported).to.deep.equal([error]);
		port.isOpen = false;
		port.emit("close");
		await com.close();
		expect(port.closeCalls).to.equal(0);
	});

	it("rejects close errors without producing an unhandled error", async () => {
		const port = new FakeSerialPort();
		port.failClose = new Error("close failed");
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		await com.open("fake");
		try {
			await com.close();
			expect.fail("close should reject");
		} catch (error) {
			expect(error).to.equal(port.failClose);
			expect(com.isOpen()).to.equal(true);
		}
		port.failClose = undefined;
		await com.close();
		expect(com.isOpen()).to.equal(false);
	});

	it("keeps a new port referenced when an old port emits a late close event", async () => {
		const first = new FakeSerialPort();
		first.emitCloseOnClose = false;
		const second = new FakeSerialPort();
		let factoryCalls = 0;
		const com = new VictronBmvCom((_path, _options, callback) => {
			const port = factoryCalls++ === 0 ? first : second;
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});

		await com.open("first");
		await com.close();
		await com.open("second");
		first.emit("close");

		expect(com.isOpen()).to.equal(true);
		await com.close();
		expect(second.closeCalls).to.equal(1);
	});

	it("does not let a new open overtake a pending close", async () => {
		const first = new FakeSerialPort();
		let factoryCalls = 0;
		let releaseClose!: () => void;
		first.closeGate = new Promise<void>(resolve => releaseClose = resolve);
		const com = new VictronBmvCom((_path, _options, callback) => {
			factoryCalls++;
			const port = first;
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		await com.open("fake");
		const closing = com.close();
		const opening = com.open("fake");
		await new Promise(resolve => setImmediate(resolve));
		expect(factoryCalls).to.equal(1);
		releaseClose();
		await Promise.all([closing, opening]);
		expect(factoryCalls).to.equal(2);
		await com.close();
	});

	it("keeps a still-open port retryable when set cleanup close also fails", async () => {
		const port = new FakeSerialPort();
		port.failSet = new Error("set failed");
		port.failClose = new Error("cleanup close failed");
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		try {
			await com.open("fake");
			expect.fail("open should reject");
		} catch (error) {
			expect(error).to.equal(port.failSet);
		}
		expect(com.isOpen()).to.equal(true);
		expect(port.closeCalls).to.equal(1);

		port.failClose = undefined;
		await com.close();
		expect(port.closeCalls).to.equal(2);
		expect(com.isOpen()).to.equal(false);
	});

	it("rejects open and removes listeners when the port closes during set", async () => {
		const port = new FakeSerialPort();
		let finishSet!: (error?: Error | null) => void;
		port.set = (_options, callback) => {
			finishSet = callback;
		};
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		const opening = com.open("fake");
		await new Promise(resolve => setImmediate(resolve));
		port.isOpen = false;
		port.emit("close");
		finishSet(null);
		try {
			await opening;
			expect.fail("open should reject");
		} catch (error) {
			expect((error as Error).message).to.contain("closed while opening");
		}
		expect(com.isOpen()).to.equal(false);
		expect(port.listenerCount("data")).to.equal(0);
		expect(port.listenerCount("close")).to.equal(0);
		expect(port.listenerCount("error")).to.equal(0);
	});

	it("removes old listeners and ignores old data after an unexpected close", async () => {
		const ports = [new FakeSerialPort(), new FakeSerialPort()];
		const frames: VeDirectFrame[] = [];
		let factoryCalls = 0;
		const com = new VictronBmvCom((_path, _options, callback) => {
			const port = ports[factoryCalls++];
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		com.onFrame = frame => frames.push(frame);
		await com.open("first");
		ports[0].isOpen = false;
		ports[0].emit("close");
		expect(ports[0].listenerCount("data")).to.equal(0);
		expect(ports[0].listenerCount("close")).to.equal(0);
		expect(ports[0].listenerCount("error")).to.equal(0);

		await com.open("second");
		ports[0].emit("data", makeFrame([["I", "-1000"]]));
		ports[1].emit("data", makeFrame([["V", "13118"]]));
		expect(frames).to.deep.equal([{ V: 13.118 }]);
		await com.close();
	});

	it("supports factories with synchronous success and error callbacks", async () => {
		const successPort = new FakeSerialPort();
		const success = new VictronBmvCom((_path, _options, callback) => {
			successPort.isOpen = true;
			callback();
			return successPort;
		});
		await success.open("sync");
		expect(success.isOpen()).to.equal(true);
		await success.close();

		const errorPort = new FakeSerialPort();
		const expected = new Error("sync open failed");
		const reported: Error[] = [];
		const failure = new VictronBmvCom((_path, _options, callback) => {
			callback(expected);
			return errorPort;
		});
		failure.onError = error => reported.push(error);
		try {
			await failure.open("sync");
			expect.fail("open should reject");
		} catch (error) {
			expect(error).to.equal(expected);
		}
		expect(reported).to.deep.equal([expected]);
		expect(failure.isOpen()).to.equal(false);
	});

	it("times out an open callback and closes a late-opening port", async () => {
		const port = new FakeSerialPort();
		let openCallback!: (error?: Error | null) => void;
		const com = new VictronBmvCom((_path, _options, callback) => {
			openCallback = callback;
			return port;
		}, { openTimeoutMs: 20, closeTimeoutMs: 20 });
		try {
			await com.open("slow");
			expect.fail("open should time out");
		} catch (error) {
			expect((error as Error).message).to.contain("open timed out");
		}
		port.isOpen = true;
		openCallback();
		await new Promise(resolve => setImmediate(resolve));
		expect(port.closeCalls).to.equal(1);
		expect(port.isOpen).to.equal(false);
		expect(com.isOpen()).to.equal(false);
	});

	it("times out a set callback and cleans up the open port", async () => {
		const port = new FakeSerialPort();
		port.set = () => undefined;
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		}, { openTimeoutMs: 20, closeTimeoutMs: 20 });
		try {
			await com.open("slow-set");
			expect.fail("set should time out");
		} catch (error) {
			expect((error as Error).message).to.contain("set timed out");
		}
		expect(port.closeCalls).to.equal(1);
		expect(com.isOpen()).to.equal(false);
	});

	it("times out a close callback without losing a still-open port", async () => {
		const port = new FakeSerialPort();
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		}, { openTimeoutMs: 20, closeTimeoutMs: 20 });
		await com.open("slow-close");
		const realClose = port.close.bind(port);
		port.close = () => undefined;
		try {
			await com.close();
			expect.fail("close should time out");
		} catch (error) {
			expect((error as Error).message).to.contain("close timed out");
		}
		expect(com.isOpen()).to.equal(true);
		port.close = realClose;
		await com.close();
		expect(com.isOpen()).to.equal(false);
	});

	it("never lets a failed late close of an old port hijack the current session", async () => {
		const first = new FakeSerialPort();
		const second = new FakeSerialPort();
		const callbacks: ((error?: Error | null) => void)[] = [];
		const frames: VeDirectFrame[] = [];
		let factoryCalls = 0;
		const com = new VictronBmvCom((_path, _options, callback) => {
			const index = factoryCalls++;
			const port = index === 0 ? first : second;
			callbacks[index] = callback;
			if (index === 1) {
				process.nextTick(() => {
					port.isOpen = true;
					callback();
				});
			}
			return port;
		}, { openTimeoutMs: 20, closeTimeoutMs: 20, lateCloseRetryMs: 1 });
		com.onFrame = frame => frames.push(frame);
		try {
			await com.open("first");
			expect.fail("first open should time out");
		} catch {}
		await com.open("second");
		second.emit("data", makeFrame([["V", "13118"]]));

		first.failClose = new Error("late old close failed");
		first.isOpen = true;
		callbacks[0]();
		await new Promise(resolve => setImmediate(resolve));
		first.failClose = undefined;
		await new Promise(resolve => setTimeout(resolve, 10));
		second.emit("data", makeFrame([["I", "1000"]]));

		expect(frames).to.deep.equal([{ V: 13.118 }, { I: 1 }]);
		expect(first.closeCalls).to.equal(2);
		await com.close();
		expect(second.closeCalls).to.equal(1);
		expect(second.isOpen).to.equal(false);
	});

	it("creates a new operation for reopen immediately after aborting a pending open", async () => {
		const first = new FakeSerialPort();
		const second = new FakeSerialPort();
		const callbacks: ((error?: Error | null) => void)[] = [];
		let factoryCalls = 0;
		const com = new VictronBmvCom((_path, _options, callback) => {
			const index = factoryCalls++;
			const port = index === 0 ? first : second;
			callbacks[index] = callback;
			if (index === 1) {
				process.nextTick(() => {
					port.isOpen = true;
					callback();
				});
			}
			return port;
		});
		const firstOpen = com.open("first");
		const closing = com.close();
		const reopen = com.open("second");
		expect(reopen).not.to.equal(firstOpen);
		first.isOpen = true;
		callbacks[0]();
		await Promise.all([firstOpen.catch(() => undefined), closing, reopen]);
		expect(factoryCalls).to.equal(2);
		expect(first.closeCalls).to.equal(1);
		expect(com.isOpen()).to.equal(true);
		await com.close();
	});

	it("cleans references and listeners after a late open error following timeout", async () => {
		const first = new FakeSerialPort();
		let openCallback!: (error?: Error | null) => void;
		const com = new VictronBmvCom((_path, _options, callback) => {
			openCallback = callback;
			return first;
		}, { openTimeoutMs: 20, closeTimeoutMs: 20 });
		try {
			await com.open("first");
			expect.fail("open should time out");
		} catch {}
		expect(first.listenerCount("error")).to.equal(1);
		expect(first.listenerCount("close")).to.equal(1);
		openCallback(new Error("late open error"));
		await new Promise(resolve => setImmediate(resolve));
		expect(com.isOpen()).to.equal(false);
		expect(first.listenerCount("error")).to.equal(0);
		expect(first.listenerCount("close")).to.equal(0);
	});

	it("resets a partial frame before a later reconnect", async () => {
		const port = new FakeSerialPort();
		const frames: VeDirectFrame[] = [];
		const com = new VictronBmvCom((_path, _options, callback) => {
			process.nextTick(() => {
				port.isOpen = true;
				callback();
			});
			return port;
		});
		com.onFrame = frame => frames.push(frame);
		await com.open("fake");
		const frame = makeFrame([["V", "13118"]]);
		port.emit("data", frame.subarray(0, 10));
		await com.close();
		await com.open("fake");
		port.emit("data", frame);
		expect(frames).to.deep.equal([{ V: 13.118 }]);
		await com.close();
	});
});
