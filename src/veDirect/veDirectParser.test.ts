import { expect } from "chai";
import { VeDirectFrame } from "./fields";
import { VeDirectParser } from "./veDirectParser";

type Field = [string, string];

function makeFrame(fields: Field[], leadingNewline = true): Buffer {
	const body = Buffer.from(`${leadingNewline ? "\r\n" : ""}${fields.map(([label, value]) => `${label}\t${value}\r\n`).join("")}Checksum\t`, "ascii");
	let sum = 0;
	for (const byte of body) {
		sum = (sum + byte) & 0xff;
	}
	return Buffer.concat([body, Buffer.from([(256 - sum) & 0xff])]);
}

function makeFrameWithChecksum(target: number): Buffer {
	for (let first = 32; first <= 126; first++) {
		for (let second = 32; second <= 126; second++) {
			const frame = makeFrame([["V", "13118"], ["X_PAD", String.fromCharCode(first, second)]]);
			if (frame[frame.length - 1] === target) {
				return frame;
			}
		}
	}
	throw new Error(`No fixture for checksum ${target}`);
}

function collect(parser: VeDirectParser): VeDirectFrame[] {
	const frames: VeDirectFrame[] = [];
	parser.onFrame = frame => frames.push(frame);
	return frames;
}

const officialFields: Field[] = [
	["PID", "0x203"],
	["V", "26201"],
	["I", "0"],
	["P", "0"],
	["CE", "0"],
	["SOC", "1000"],
	["TTG", "-1"],
	["Alarm", "OFF"],
	["Relay", "OFF"],
	["AR", "0"],
	["BMV", "700"],
	["FW", "0307"],
];

describe("VE.Direct byte parser", () => {
	it("accepts the exact official FAQ frame, including PID, P and TTG=-1", () => {
		const frame = makeFrame(officialFields);
		expect(frame[frame.length - 1]).to.equal(0xd8);
		const parser = new VeDirectParser();
		const frames = collect(parser);

		parser.receive(frame);

		expect(frames).to.have.length(1);
		expect(frames[0]).to.include({ PID: "0x203", V: 26.201, P: 0, SOC: 100, TTG: null, TTGInfinite: true, Alarm: false, Relay: false, BMV: "700", FW: "0307" });
		expect(parser.unknownFields).to.equal(0);
	});

	it("handles every possible chunk boundary", () => {
		const frame = makeFrame(officialFields);
		for (let split = 0; split <= frame.length; split++) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			parser.receive(frame.subarray(0, split));
			expect(frames, `before split ${split}`).to.have.length(split === frame.length ? 1 : 0);
			parser.receive(frame.subarray(split));
			expect(frames, `after split ${split}`).to.have.length(1);
			expect(frames[0].V).to.equal(26.201);
		}
	});

	it("completes immediately after the checksum byte without trailing CRLF", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(makeFrame([["V", "13118"]]));
		expect(frames).to.deep.equal([{ V: 13.118 }]);
	});

	it("handles binary checksum bytes including LF, CR, colon and 0xFF", () => {
		for (const checksum of [0x00, 0x0a, 0x0d, 0x3a, 0xff]) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			parser.receive(makeFrameWithChecksum(checksum));
			expect(frames, `checksum ${checksum}`).to.have.length(1);
			expect(frames[0].V).to.equal(13.118);
		}
	});

	it("rejects a corrupted frame without publishing or mutating data", () => {
		const frame = makeFrame(officialFields);
		frame[15] ^= 1;
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(frame);
		expect(frames).to.have.length(0);
		expect(parser.checksumErrors).to.equal(1);
	});

	it("ignores unknown fields and keeps known values", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(makeFrame([["X_NEW", "abc"], ["V", "13118"]]));
		expect(frames).to.deep.equal([{ V: 13.118 }]);
		expect(parser.unknownFields).to.equal(1);
	});

	it("publishes only fields contained in each of multiple blocks", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(Buffer.concat([
			makeFrame([["V", "13118"], ["I", "1000"]]),
			makeFrame([["H4", "3"], ["H5", "1"]]),
		]));
		expect(frames).to.deep.equal([{ V: 13.118, I: 1 }, { H4: 3, H5: 1 }]);
		expect(frames[0]).not.to.have.property("H4");
		expect(frames[1]).not.to.have.property("V");
	});

	it("excludes asynchronous HEX messages before, during and after TEXT frames", () => {
		const frame = makeFrame(officialFields);
		for (const position of [0, 20, Math.floor(frame.length / 2), frame.length - 1, frame.length]) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			const withHex = Buffer.concat([frame.subarray(0, position), Buffer.from(":A1234\n"), frame.subarray(position)]);
			parser.receive(withHex);
			expect(frames, `HEX at ${position}`).to.have.length(1);
			expect(frames[0].V).to.equal(26.201);
			expect(parser.hexMessages).to.equal(1);
		}
	});

	it("handles several HEX messages and resynchronizes the next TEXT frame", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		const frame = makeFrame([["V", "13118"]]);
		parser.receive(Buffer.concat([Buffer.from(":A1\n:A2\n"), frame, Buffer.from(":A3\n"), frame]));
		expect(frames).to.deep.equal([{ V: 13.118 }, { V: 13.118 }]);
		expect(parser.hexMessages).to.equal(3);
	});

	it("treats a checksum-valid unknown-only block as valid liveness without invalidating it", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		let validFrames = 0;
		parser.onValidFrame = () => validFrames++;
		parser.receive(makeFrame([["X_NEW", "123"]]));
		expect(frames).to.have.length(0);
		expect(validFrames).to.equal(1);
		expect(parser.invalidFrames).to.equal(0);
		expect(parser.unknownFields).to.equal(1);
	});

	it("bounds malformed input and recovers after reset", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(Buffer.from("X".repeat(200)));
		expect(parser.invalidFrames).to.equal(1);
		parser.receive(makeFrame([["V", "13118"]]));
		expect(frames).to.deep.equal([{ V: 13.118 }]);
	});
});
