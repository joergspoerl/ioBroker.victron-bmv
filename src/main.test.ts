import { expect } from "chai";
import proxyquire from "proxyquire";
import * as sinon from "sinon";

const { VictronBmv } = proxyquire.noCallThru()("./main", {
	"@iobroker/adapter-core": { Adapter: class {} },
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
	adapter.log = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
	adapter.setStateAsync = sinon.stub().resolves();
	adapter.lastFrameTime = 0;
	adapter.lastOpenAttempt = 0;
	adapter.frameQueue = Promise.resolve();
	adapter.connectionState = undefined;
	adapter.unloaded = false;
	adapter.stateQueues = new Map();
	adapter.lastStateValues = new Map();
	return adapter;
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

		const first = adapter.publishFrame(frame);
		await new Promise(resolve => setImmediate(resolve));
		frame.V = 99;
		const second = adapter.publishFrame({ V: 13.2 });
		await new Promise(resolve => setImmediate(resolve));
		expect(adapter.setStateAsync.withArgs("V").callCount).to.equal(1);

		release();
		await Promise.all([first, second]);
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

describe("VE.Direct configuration lifecycle", () => {
	for (const path of ["", "/dev/xxx"]) {
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

	it("reports only a checksum-valid published frame as connected", async () => {
		const adapter = harness();
		await adapter.publishFrame({ V: 13.1 });
		expect(adapter.connectionState).to.equal(true);
		expect(adapter.setStateAsync.calledWith("info.connection", { val: true, ack: true })).to.equal(true);
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

	it("still finishes unload when close fails", async () => {
		const adapter = harness();
		adapter.bmv.close.rejects(new Error("close failed"));
		const callback = sinon.stub();
		adapter.onUnload(callback);
		await new Promise(resolve => setImmediate(resolve));
		expect(callback.calledOnce).to.equal(true);
	});
});
