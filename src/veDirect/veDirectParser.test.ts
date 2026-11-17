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
	const empty = makeFrame([["V", "13118"], ["X_PAD", ""]]);
	const required = (empty[empty.length - 1] - target) & 0xff;
	const buildPadding = (sum: number, length: number): string | undefined => {
		if (length === 0) return sum === 0 ? "" : undefined;
		for (let byte = 32; byte <= 126; byte++) {
			if (byte === 0x3a) continue;
			const rest = sum - byte;
			if (rest < 32 * (length - 1) || rest > 126 * (length - 1)) continue;
			const tail = buildPadding(rest, length - 1);
			if (tail !== undefined) return String.fromCharCode(byte) + tail;
		}
		return undefined;
	};
	for (let length = 1; length <= 4; length++) {
		for (let sum = required; sum <= 126 * length; sum += 256) {
			const padding = buildPadding(sum, length);
			if (padding !== undefined) {
				return makeFrame([["V", "13118"], ["X_PAD", padding]]);
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

	it("ignores inherited property names without discarding known values", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(makeFrame([["toString", "123"], ["V", "13118"]]));
		expect(frames).to.deep.equal([{ V: 13.118 }]);
		expect(parser.unknownFields).to.equal(1);
		expect(parser.invalidFrames).to.equal(0);
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

	it("discards HEX-interrupted TEXT frames and resynchronizes at the next block", () => {
		const frame = makeFrame(officialFields);
		const next = makeFrame([["I", "1000"]]);
		for (const position of [0, 20, Math.floor(frame.length / 2), frame.length - 1, frame.length]) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			const withHex = Buffer.concat([
				frame.subarray(0, position),
				Buffer.from(":A1234\n"),
				frame.subarray(position),
				next,
			]);
			parser.receive(withHex);
			if (position === 0 || position === frame.length) {
				expect(frames.some(item => item.V === 26.201), `HEX outside TEXT at ${position}`).to.equal(true);
			} else {
				expect(frames.some(item => item.V !== undefined), `interrupted TEXT at ${position}`).to.equal(false);
			}
			expect(frames[frames.length - 1], `next block after HEX at ${position}`).to.deep.equal({ I: 1 });
		}
	});

	it("classifies real HEX after garbage without breaking orphan recovery", () => {
		for (const prefix of ["X\n", "X\r\n"]) {
			const stream = Buffer.concat([Buffer.from(prefix), Buffer.from(":A1234\n"), makeFrame([["V", "13118"]])]);
			for (let split = 0; split <= stream.length; split++) {
				const parser = new VeDirectParser();
				const frames = collect(parser);
				parser.receive(stream.subarray(0, split));
				parser.receive(stream.subarray(split));
				expect(frames, `${JSON.stringify(prefix)} split ${split}`).to.deep.equal([{ V: 13.118 }]);
				expect(parser.hexMessages, `${JSON.stringify(prefix)} split ${split}`).to.equal(1);
			}
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

	it("keeps checksum 0x3A plus following :A bytes identical at every chunk boundary", () => {
		const frame = makeFrameWithChecksum(0x3a);
		const next = makeFrame([["I", "1000"]]);
		const stream = Buffer.concat([
			frame.subarray(0, frame.length - 1),
			Buffer.from(":A1234\n"),
			frame.subarray(frame.length - 1),
			next,
		]);
		for (let split = 0; split <= stream.length; split++) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			parser.receive(stream.subarray(0, split));
			parser.receive(stream.subarray(split));
			expect(frames, `split ${split}`).to.deep.equal([{ V: 13.118 }, { I: 1 }]);
			expect(parser.checksumErrors, `split ${split}`).to.equal(0);
		}
	});

	it("immediately rejects a corrupted frame whose received checksum is 0x3A", () => {
		const frame = makeFrameWithChecksum(0x3a);
		frame[5] ^= 1;
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(frame);
		expect(frames).to.have.length(0);
		expect(parser.checksumErrors).to.equal(1);
	});

	it("recovers at every line-limit boundary, including 127 and 128 bytes", () => {
		for (const length of [127, 128, 129, 200]) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			parser.receive(Buffer.concat([Buffer.from("\r\n"), Buffer.from("X".repeat(length)), makeFrame([["V", "13118"]])]));
			expect(frames, `garbage length ${length}`).to.deep.equal([{ V: 13.118 }]);
			expect(parser.invalidFrames, `garbage length ${length}`).to.equal(1);
		}
	});

	it("resynchronizes on the first complete block after an orphaned checksum byte", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(Buffer.concat([Buffer.from([0xd8]), makeFrame([["I", "1000"]])]));
		expect(frames).to.deep.equal([{ I: 1 }]);
	});

	it("accepts every possible binary checksum byte", () => {
		for (let checksum = 0; checksum <= 0xff; checksum++) {
			const parser = new VeDirectParser();
			const frames = collect(parser);
			parser.receive(makeFrameWithChecksum(checksum));
			expect(frames, `checksum ${checksum}`).to.deep.equal([{ V: 13.118 }]);
		}
	});

	it("parses real BMV-602S production values with corrected semantics", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(makeFrame([
			["V", "13336"],
			["I", "2213"],
			["SOC", "1000"],
			["TTG", "-1"],
			["BMV", "602S"],
			["FW", "211"],
			["H1", "-651715"],
			["H3", "-398413"],
			["H4", "29"],
			["H6", "-73183800"],
		]));
		expect(frames).to.deep.equal([{
			V: 13.336,
			I: 2.213,
			SOC: 100,
			TTG: null,
			TTGInfinite: true,
			BMV: "602S",
			FW: "211",
			H1: -651.715,
			H3: -398.413,
			H4: 29,
			H6: -73183.8,
		}]);
	});

	it("bounds malformed input and recovers after reset", () => {
		const parser = new VeDirectParser();
		const frames = collect(parser);
		parser.receive(Buffer.from(`\r\n${"X".repeat(200)}`));
		expect(parser.invalidFrames).to.equal(1);
		parser.receive(makeFrame([["V", "13118"]]));
		expect(frames).to.deep.equal([{ V: 13.118 }]);
	});
});
