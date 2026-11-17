import { EventEmitter } from "events";
import { expect } from "chai";
import proxyquire from "proxyquire";
import * as sinon from "sinon";
import { VeDirectParser } from "./veDirect/veDirectParser";
import { VictronBmvCom } from "./victronBmvCom";

class Adapter extends EventEmitter {}

class LateSerialPort extends EventEmitter {
	isOpen = false;
	closeCalls = 0;
	set(_options: Record<string, boolean>, callback: (error?: Error | null) => void): void {
		callback(null);
	}
	close(callback: (error?: Error | null) => void): void {
		this.closeCalls++;
		if (this.closeCalls === 1) {
			callback(new Error("late close failed"));
			return;
		}
		this.isOpen = false;
		this.emit("close");
		callback(null);
	}
}

const { VictronBmv } = proxyquire.noCallThru()("./main", {
	"@iobroker/adapter-core": { Adapter },
}) as typeof import("./main");

function harness(): any {
	const adapter = Object.create(VictronBmv.prototype);
	adapter.bmv = {
		isOpen: sinon.stub().returns(false),
		open: sinon.stub().resolves(),
		close: sinon.stub().resolves(),
		onFrame: undefined,
		onError: undefined,
	};
	adapter.config = { serialPortPath: "/dev/fake" };
	adapter.serialPortPath = "/dev/fake";
	adapter.log = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
	adapter.setStateAsync = sinon.stub().resolves();
	adapter.lastFrameTime = 0;
	adapter.lastOpenAttempt = 0;
	adapter.activeWatchDog = undefined;
	adapter.readyPromise = undefined;
	adapter.unloadPromise = undefined;
	adapter.frameQueue = Promise.resolve();
	adapter.connectionState = undefined;
	adapter.connectionRequested = undefined;
	adapter.unloaded = false;
	adapter.stateQueues = new Map();
	adapter.lastStateValues = new Map();
	return adapter;
}

function makeFrame(fields: [string, string][]): Buffer {
	const body = Buffer.from(`\r\n${fields.map(([label, value]) => `${label}\t${value}\r\n`).join("")}Checksum\t`);
	let sum = 0;
	for (const byte of body) sum = (sum + byte) & 0xff;
	return Buffer.concat([body, Buffer.from([(256 - sum) & 0xff])]);
}

describe("VE.Direct ioBroker state publication", () => {
	it("publishes only fields actually contained in each block", async () => {
		const adapter = harness();
		await adapter.publishFrame({ V: 13.118, I: -1 });
		await adapter.publishFrame({ H4: 3, H5: 1 });

		expect(adapter.setStateAsync.calledWith("V", { val: 13.118, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("I", { val: -1, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("H4", { val: 3, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("H5", { val: 1, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("H6")).to.equal(false);
		expect(adapter.lastStateValues.has("H1")).to.equal(false);
	});

	it("uses immutable snapshots and serializes writes per state", async () => {
		const adapter = harness();
		let release!: () => void;
		const gate = new Promise<void>(resolve => release = resolve);
		adapter.setStateAsync.withArgs("V").onFirstCall().returns(gate);
		const frame = { V: 13.1 };

		adapter.enqueueFrame(frame);
		frame.V = 99;
		adapter.enqueueFrame({ V: 13.2 });
		await new Promise(resolve => setImmediate(resolve));
		expect(adapter.setStateAsync.withArgs("V").callCount).to.equal(1);

		release();
		await adapter.frameQueue;
		const values = adapter.setStateAsync.getCalls().filter((call: any) => call.args[0] === "V").map((call: any) => call.args[1].val);
		expect(values).to.deep.equal([13.1, 13.2]);
		expect(adapter.lastStateValues.get("V")).to.equal(13.2);
	});

	it("retries a failed state write without an unhandled rejection", async () => {
		const adapter = harness();
		adapter.setStateAsync.withArgs("V").onFirstCall().rejects(new Error("database unavailable"));
		await adapter.publishFrame({ V: 13.1 });
		await adapter.publishFrame({ V: 13.1 });

		expect(adapter.setStateAsync.withArgs("V").callCount).to.equal(2);
		expect(adapter.log.error.called).to.equal(true);
	});

	it("deduplicates against the newest requested connection state, not an older completed one", async () => {
		const adapter = harness();
		let releaseFalse!: () => void;
		adapter.setStateAsync.withArgs("info.connection", { val: false, ack: true }).returns(new Promise<void>(resolve => releaseFalse = resolve));

		await adapter.safeSetConnectionState(true);
		const olderFalse = adapter.safeSetConnectionState(false);
		await new Promise(resolve => setImmediate(resolve));
		const newestTrue = adapter.safeSetConnectionState(true);
		releaseFalse();
		await Promise.all([olderFalse, newestTrue]);
		await new Promise(resolve => setImmediate(resolve));

		const values = adapter.setStateAsync.getCalls().filter((call: any) => call.args[0] === "info.connection").map((call: any) => call.args[1].val);
		expect(values).to.deep.equal([true, false, true]);
		expect(adapter.connectionState).to.equal(true);
	});
});

describe("VE.Direct ready and object lifecycle", () => {
	for (const method of ["setObjectNotExistsAsync", "extendObjectAsync"]) {
		it(`handles ${method} failures through the real ready event without unhandled rejection`, async () => {
			const adapter: any = new VictronBmv();
			const expected = new Error("object db unavailable");
			adapter.config = { serialPortPath: "/dev/fake" };
			adapter.log = { error: sinon.stub() };
			adapter.setStateAsync = sinon.stub().resolves();
			adapter.setObjectNotExistsAsync = sinon.stub().resolves();
			adapter.extendObjectAsync = sinon.stub().resolves();
			adapter[method].rejects(expected);

			adapter.emit("ready");
			await adapter.readyPromise;
			await new Promise(resolve => setImmediate(resolve));
			expect(adapter.log.error.called).to.equal(true);
			expect(adapter.log.error.firstCall.args[0]).to.contain("object db unavailable");
			expect(adapter.watchDogInterval).to.equal(undefined);
		});
	}

	it("migrates existing info.connection metadata", async () => {
		const adapter = harness();
		adapter.setObjectNotExistsAsync = sinon.stub().resolves();
		adapter.extendObjectAsync = sinon.stub().resolves();
		await adapter.initObjects();
		expect(adapter.extendObjectAsync.calledWith("info.connection", {
			common: {
				name: "Fresh valid VE.Direct frame received",
				type: "boolean",
				role: "indicator.connected",
				read: true,
				write: false,
				def: false,
			},
		})).to.equal(true);
	});

	it("publishes the protocol field description with every field object", async () => {
		const adapter = harness();
		adapter.setObjectNotExistsAsync = sinon.stub().resolves();
		adapter.extendObjectAsync = sinon.stub().resolves();
		await adapter.initObjects();

		const fieldCalls = adapter.extendObjectAsync.getCalls().filter((call: any) => call.args[0] !== "info.connection");
		expect(fieldCalls.length).to.be.greaterThan(0);
		for (const call of fieldCalls) {
			expect(call.args[1].common.desc, call.args[0]).to.be.a("string");
			expect(call.args[1].common.desc, call.args[0]).not.to.equal("");
		}
		expect(fieldCalls.find((call: any) => call.args[0] === "V").args[1].common.desc).to.contain("mV");
		expect(fieldCalls.find((call: any) => call.args[0] === "H9").args[1].common.desc).to.contain("Seconds");
	});

	it("stops object initialization after unload and waits for the pending ready operation", async () => {
		const adapter = harness();
		let release!: () => void;
		const gate = new Promise<void>(resolve => release = resolve);
		adapter.setObjectNotExistsAsync = sinon.stub().returns(gate);
		adapter.extendObjectAsync = sinon.stub().resolves();
		adapter.handleReady();
		await new Promise(resolve => setImmediate(resolve));
		const callback = sinon.stub();
		adapter.onUnload(callback);
		expect(callback.called).to.equal(false);
		release();
		await adapter.readyPromise;
		await adapter.unloadPromise;
		expect(adapter.setObjectNotExistsAsync.callCount).to.equal(1);
		expect(adapter.extendObjectAsync.called).to.equal(false);
		expect(callback.calledOnce).to.equal(true);
	});
});

describe("VE.Direct configuration lifecycle", () => {
	for (const path of ["", "/dev/xxx", "   ", " /dev/xxx "]) {
		it(`clears a previous connection state for invalid path ${JSON.stringify(path)}`, async () => {
			const adapter = harness();
			adapter.config.serialPortPath = path;
			adapter.initObjects = sinon.stub().resolves();
			adapter.connectionState = true;
			await adapter.onReady();
			expect(adapter.setStateAsync.calledWith("info.connection", { val: false, ack: true })).to.equal(true);
			expect(adapter.connectionState).to.equal(false);
			expect(adapter.watchDogInterval).to.equal(undefined);
		});
	}
	it("trims a valid serial path before opening", async () => {
		const adapter = harness();
		adapter.config.serialPortPath = "  /dev/fake  ";
		adapter.initObjects = sinon.stub().resolves();
		adapter.watchDog = sinon.stub().resolves();
		await adapter.onReady();
		if (adapter.watchDogInterval) clearInterval(adapter.watchDogInterval);
		expect(adapter.serialPortPath).to.equal("/dev/fake");
	});
});

describe("VE.Direct watchdog", () => {
	it("does not report a device connection merely because opening the port succeeded", async () => {
		const adapter = harness();
		await adapter.watchDog();

		expect(adapter.bmv.open.calledOnce).to.equal(true);
		expect(adapter.setStateAsync.calledWith("info.connection", { val: false, ack: true })).to.equal(true);
		expect(adapter.setStateAsync.calledWith("info.connection", { val: true, ack: true })).to.equal(false);
	});

	it("keeps a fresh valid frame connected without reopening", async () => {
		const adapter = harness();
		adapter.lastFrameTime = Date.now();
		await adapter.watchDog();
		expect(adapter.bmv.open.called).to.equal(false);
		expect(adapter.bmv.close.called).to.equal(false);
	});

	it("closes and reopens an open but stale port and reports not connected", async () => {
		const adapter = harness();
		adapter.bmv.isOpen.returns(true);
		await adapter.watchDog();

		expect(adapter.bmv.close.calledOnce).to.equal(true);
		expect(adapter.bmv.open.calledOnce).to.equal(true);
		expect(adapter.connectionState).to.equal(false);
	});

	it("does not start another open during reconnect cooldown", async () => {
		const adapter = harness();
		await adapter.watchDog();
		await adapter.watchDog();
		expect(adapter.bmv.open.calledOnce).to.equal(true);
	});

	it("uses real parser checksums for liveness and state publication", async () => {
		const adapter = harness();
		const parser = new VeDirectParser();
		parser.onValidFrame = () => adapter.bmv.onValidFrame?.();
		parser.onFrame = frame => adapter.bmv.onFrame?.(frame);
		adapter.initObjects = sinon.stub().resolves();
		adapter.watchDog = sinon.stub().resolves();
		await adapter.onReady();
		if (adapter.watchDogInterval) clearInterval(adapter.watchDogInterval);

		const corrupted = makeFrame([["V", "13118"]]);
		corrupted[5] ^= 1;
		parser.receive(corrupted);
		await new Promise(resolve => setImmediate(resolve));
		expect(adapter.connectionState).to.equal(false);
		expect(adapter.setStateAsync.calledWith("V")).to.equal(false);

		parser.receive(makeFrame([["V", "13118"]]));
		await adapter.frameQueue;
		await new Promise(resolve => setImmediate(resolve));
		expect(adapter.connectionState).to.equal(true);
		expect(adapter.setStateAsync.calledWith("V", { val: 13.118, ack: true })).to.equal(true);
		expect(parser.checksumErrors).to.equal(1);
	});

	it("deduplicates overlapping watchdog runs", async () => {
		const adapter = harness();
		let release!: () => void;
		adapter.bmv.open.returns(new Promise<void>(resolve => release = resolve));
		const first = adapter.watchDog();
		const second = adapter.watchDog();
		expect(second).to.equal(first);
		release();
		await first;
		expect(adapter.bmv.open.calledOnce).to.equal(true);
	});

	it("does not reconnect when a fresh frame arrives during the connection-state await", async () => {
		const adapter = harness();
		adapter.bmv.isOpen.returns(true);
		let releaseFalse!: () => void;
		adapter.setStateAsync.withArgs("info.connection", { val: false, ack: true }).returns(new Promise<void>(resolve => releaseFalse = resolve));
		const watchdog = adapter.watchDog();
		await new Promise(resolve => setImmediate(resolve));
		adapter.bmv.onValidFrame = () => {
			adapter.lastFrameTime = Date.now();
			void adapter.safeSetConnectionState(true);
		};
		adapter.bmv.onValidFrame();
		releaseFalse();
		await watchdog;
		expect(adapter.bmv.close.called).to.equal(false);
		expect(adapter.bmv.open.called).to.equal(false);
	});

	it("does not reopen after unload while a watchdog close is pending", async () => {
		const adapter = harness();
		adapter.bmv.isOpen.returns(true);
		let releaseClose!: () => void;
		adapter.bmv.close.returns(new Promise<void>(resolve => releaseClose = resolve));
		const callback = sinon.stub();
		const watchdog = adapter.watchDog();
		await new Promise(resolve => setImmediate(resolve));

		adapter.onUnload(callback);
		expect(callback.called).to.equal(false);
		releaseClose();
		await watchdog;
		await new Promise(resolve => setImmediate(resolve));
		expect(adapter.bmv.open.called).to.equal(false);
		expect(callback.calledOnce).to.equal(true);
	});
});

describe("VE.Direct unload", () => {
	it("writes a final acknowledged not-connected state before the callback", async () => {
		const adapter = harness();
		await adapter.publishFrame({ V: 13.1 });
		const callback = sinon.stub();
		adapter.onUnload(callback);
		await adapter.unloadPromise;
		expect(adapter.setStateAsync.lastCall.args).to.deep.equal(["info.connection", { val: false, ack: true }]);
		expect(adapter.connectionState).to.equal(false);
		expect(callback.calledOnce).to.equal(true);
	});

	it("waits for the asynchronous port close and calls back once", async () => {
		const adapter = harness();
		let release!: () => void;
		adapter.bmv.close.returns(new Promise<void>(resolve => release = resolve));
		const callback = sinon.stub();
		adapter.onUnload(callback);
		expect(callback.called).to.equal(false);
		release();
		await new Promise(resolve => setImmediate(resolve));
		expect(callback.calledOnce).to.equal(true);
		expect(adapter.unloaded).to.equal(true);
		expect(adapter.bmv.onFrame).to.equal(undefined);
	});

	it("bounds a pending native open and autonomously retries a late close after unload", async () => {
		const adapter = harness();
		const port = new LateSerialPort();
		let openCallback!: (error?: Error | null) => void;
		const com = new VictronBmvCom((_path, _options, callback) => {
			openCallback = callback;
			return port;
		}, { openTimeoutMs: 20, closeTimeoutMs: 5, lateCloseRetryMs: 1 });
		adapter.bmv = com;
		const opening = com.open("pending");
		const callback = sinon.stub();
		adapter.onUnload(callback);
		await adapter.unloadPromise;
		await opening.catch(() => undefined);
		expect(callback.calledOnce).to.equal(true);
		expect(port.closeCalls).to.equal(0);

		port.isOpen = true;
		openCallback();
		await new Promise(resolve => setTimeout(resolve, 30));
		expect(port.closeCalls).to.equal(2);
		expect(port.isOpen).to.equal(false);
		expect(com.isOpen()).to.equal(false);
	});

	it("still finishes unload when close fails", async () => {
		const adapter = harness();
		adapter.bmv.close.rejects(new Error("close failed"));
		const callback = sinon.stub();
		adapter.onUnload(callback);
		await new Promise(resolve => setImmediate(resolve));
		expect(callback.calledOnce).to.equal(true);
	});
});
