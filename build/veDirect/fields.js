"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VE_DIRECT_FIELDS = void 0;
exports.decodeVeDirectField = decodeVeDirectField;
function numeric(scale = 1) {
    return value => {
        if (value === "---") {
            return null;
        }
        if (!/^[+-]?\d+$/.test(value)) {
            throw new Error(`Invalid numeric value: ${value}`);
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid number: ${value}`);
        }
        return Number((parsed * scale).toFixed(12));
    };
}
function text(value) {
    return value;
}
function onOff(value) {
    const normalized = value.toLowerCase();
    if (normalized !== "on" && normalized !== "off") {
        throw new Error(`Invalid ON/OFF value: ${value}`);
    }
    return normalized === "on";
}
function define(id, type, role, unit, label, decode, descr = "") {
    return {
        id,
        type,
        role,
        unit,
        label,
        descr,
        decode: value => ({ [id]: decode(value) }),
    };
}
const fields = [
    define("V", "number", "value.voltage", "V", "Main battery voltage", numeric(0.001), "Main or channel 1 voltage, transmitted in mV"),
    define("VS", "number", "value.voltage", "V", "Auxiliary/starter voltage", numeric(0.001), "Auxiliary voltage, transmitted in mV"),
    define("I", "number", "value.current", "A", "Main battery current", numeric(0.001), "Signed battery current, transmitted in mA"),
    define("P", "number", "value.power", "W", "Instantaneous power", numeric(1), "Signed instantaneous power"),
    define("CE", "number", "value", "Ah", "Consumed charge", numeric(0.001), "Consumed amp-hours; null when unavailable/unsynchronised"),
    define("SOC", "number", "value.battery", "%", "State of charge", numeric(0.1), "Transmitted in per mille; null when unavailable"),
    {
        id: "TTG",
        type: "number",
        role: "value.interval",
        unit: "h",
        label: "Time to go",
        descr: "Minutes converted to hours; -1 means infinite",
        decode: value => {
            if (value === "---") {
                return { TTG: null, TTGInfinite: null };
            }
            const minutes = numeric(1)(value);
            if (minutes === -1) {
                return { TTG: null, TTGInfinite: true };
            }
            if (minutes === null || minutes < 0) {
                throw new Error(`Invalid TTG value: ${value}`);
            }
            return { TTG: minutes / 60, TTGInfinite: false };
        },
    },
    define("TTGInfinite", "boolean", "state", "", "Time-to-go is infinite", value => value === "true", "Synthetic status derived from TTG=-1"),
    define("Alarm", "boolean", "state", "", "Alarm active", onOff, "Case-insensitive ON/OFF"),
    define("Relay", "boolean", "state", "", "Relay active", onOff, "Case-insensitive ON/OFF"),
    define("AR", "number", "state", "", "Alarm reason", numeric(1), "Raw alarm-reason bitfield"),
    define("BMV", "string", "state", "", "Device model (deprecated)", text, "Use PID for model identification when available"),
    define("FW", "string", "state", "", "Firmware version", text, "16-bit firmware version"),
    define("FWE", "string", "state", "", "Extended firmware version", text, "24-bit firmware version"),
    define("PID", "string", "state", "", "Product ID", text, "Product identifier such as 0x203"),
    define("SER#", "string", "state", "", "Serial number", text, "Device serial number"),
    define("MON", "number", "state", "", "DC monitor mode", numeric(1), "Raw DC-monitor mode value"),
    define("VM", "number", "value.voltage", "V", "Midpoint voltage", numeric(0.001), "Transmitted in mV"),
    define("DM", "number", "value", "%", "Midpoint deviation", numeric(0.1), "Transmitted in per mille, displayed in percent"),
    define("T", "number", "value.temperature", "°C", "Battery temperature", numeric(), "Null when no temperature sensor is connected"),
    define("H1", "number", "state", "Ah", "Deepest discharge", numeric(0.001), "Transmitted in mAh"),
    define("H2", "number", "state", "Ah", "Last discharge", numeric(0.001), "Transmitted in mAh"),
    define("H3", "number", "state", "Ah", "Average discharge", numeric(0.001), "Transmitted in mAh"),
    define("H4", "number", "state", "", "Charge cycles", numeric(1), "Unitless count"),
    define("H5", "number", "state", "", "Full discharges", numeric(1), "Unitless count"),
    define("H6", "number", "state", "Ah", "Cumulative charge drawn", numeric(0.001), "Signed cumulative amp-hours, transmitted in mAh"),
    define("H7", "number", "value.voltage", "V", "Minimum main battery voltage", numeric(0.001), "Transmitted in mV"),
    define("H8", "number", "value.voltage", "V", "Maximum main battery voltage", numeric(0.001), "Transmitted in mV"),
    define("H9", "number", "value.interval", "d", "Time since last full charge", numeric(1 / 86400), "Seconds converted to days"),
    define("H10", "number", "state", "", "Automatic synchronizations", numeric(1), "Unitless count"),
    define("H11", "number", "state", "", "Low main voltage alarms", numeric(1), "Unitless count"),
    define("H12", "number", "state", "", "High main voltage alarms", numeric(1), "Unitless count"),
    define("H13", "number", "state", "", "Low auxiliary voltage alarms", numeric(1), "Unitless count"),
    define("H14", "number", "state", "", "High auxiliary voltage alarms", numeric(1), "Unitless count"),
    define("H15", "number", "value.voltage", "V", "Minimum auxiliary voltage", numeric(0.001), "Transmitted in mV"),
    define("H16", "number", "value.voltage", "V", "Maximum auxiliary voltage", numeric(0.001), "Transmitted in mV"),
    define("H17", "number", "value.energy", "kWh", "Discharged/produced energy", numeric(0.01), "Transmitted in 0.01 kWh"),
    define("H18", "number", "value.energy", "kWh", "Cumulative charged energy", numeric(0.01), "Transmitted in 0.01 kWh"),
];
exports.VE_DIRECT_FIELDS = Object.create(null);
for (const field of fields) {
    exports.VE_DIRECT_FIELDS[field.id] = field;
}
function decodeVeDirectField(label, value) {
    if (!Object.prototype.hasOwnProperty.call(exports.VE_DIRECT_FIELDS, label)) {
        return null;
    }
    return exports.VE_DIRECT_FIELDS[label].decode(value);
}
//# sourceMappingURL=fields.js.map