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
