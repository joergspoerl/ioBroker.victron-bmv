import { expect } from "chai";
import { decodeVeDirectField } from "./fields";

describe("VE.Direct field conversion", () => {
	it("uses the documented voltage, current, SOC and charge scales", () => {
		expect(decodeVeDirectField("V", "13118")).to.deep.equal({ V: 13.118 });
		expect(decodeVeDirectField("I", "-4368")).to.deep.equal({ I: -4.368 });
		expect(decodeVeDirectField("SOC", "1000")).to.deep.equal({ SOC: 100 });
		expect(decodeVeDirectField("CE", "-60")).to.deep.equal({ CE: -0.06 });
		expect(decodeVeDirectField("TTG", "240")).to.deep.equal({ TTG: 4, TTGInfinite: false });
	});

	it("fixes H4/H5/H6 and keeps the intentional H9 seconds-to-days conversion", () => {
		expect(decodeVeDirectField("H4", "1")).to.deep.equal({ H4: 1 });
		expect(decodeVeDirectField("H5", "2")).to.deep.equal({ H5: 2 });
		expect(decodeVeDirectField("H6", "-368537")).to.deep.equal({ H6: -368.537 });
		expect(decodeVeDirectField("H9", "172800")).to.deep.equal({ H9: 2 });
		expect(decodeVeDirectField("H9", "56")!.H9).to.be.closeTo(56 / 86400, 1e-12);
	});

	it("uses null for unavailable values and a separate infinite flag for TTG", () => {
		for (const label of ["CE", "SOC", "TTG", "T", "H1", "H6", "H9", "H10"]) {
			const decoded = decodeVeDirectField(label, "---");
			expect(decoded, label).not.to.equal(null);
			expect(Object.values(decoded!)[0], label).to.equal(null);
			for (const value of Object.values(decoded!)) {
				expect(typeof value === "number" && !Number.isFinite(value), label).to.equal(false);
			}
		}
		expect(decodeVeDirectField("TTG", "-1")).to.deep.equal({ TTG: null, TTGInfinite: true });
	});

	it("accepts ON/OFF case-insensitively and rejects malformed values", () => {
		for (const value of ["ON", "On", "on"]) {
			expect(decodeVeDirectField("Alarm", value)).to.deep.equal({ Alarm: true });
		}
		for (const value of ["OFF", "Off", "off"]) {
			expect(decodeVeDirectField("Relay", value)).to.deep.equal({ Relay: false });
		}
		expect(() => decodeVeDirectField("Alarm", "yes")).to.throw();
		expect(() => decodeVeDirectField("H4", "1.5")).to.throw();
		expect(() => decodeVeDirectField("V", "")).to.throw();
	});

	it("covers additional BMV fields without changing their identifiers", () => {
		expect(decodeVeDirectField("PID", "0x203")).to.deep.equal({ PID: "0x203" });
		expect(decodeVeDirectField("P", "-23")).to.deep.equal({ P: -23 });
		expect(decodeVeDirectField("VM", "25803")).to.deep.equal({ VM: 25.803 });
		expect(decodeVeDirectField("DM", "12")).to.deep.equal({ DM: 1.2 });
		expect(decodeVeDirectField("H17", "4106")).to.deep.equal({ H17: 41.06 });
		expect(decodeVeDirectField("H18", "9664")).to.deep.equal({ H18: 96.64 });
		expect(decodeVeDirectField("SER#", "ABC123")).to.deep.equal({ "SER#": "ABC123" });
		expect(decodeVeDirectField("FWE", "0307")).to.deep.equal({ FWE: "0307" });
		expect(decodeVeDirectField("MON", "1")).to.deep.equal({ MON: 1 });
	});

	it("ignores unknown fields without throwing", () => {
		expect(decodeVeDirectField("X_NEW", "123")).to.equal(null);
	});
});
