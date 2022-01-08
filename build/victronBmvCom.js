"use strict";
/* eslint-disable prettier/prettier */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VictronBmvCom = void 0;
const SerialPort = require("serialport");
class VictronBmvCom {
    constructor() {
        this.frame = new Buffer(0); // in buffer
        this.self = this; // reference to itself
        this.cb = () => { return; };
        // data structure
        this.data = {
            "V": 0,
            "VS": 0,
            "I": 0,
            "CE": 0,
            "SOC": 0,
            "TTG": 0,
            "Alarm": false,
            "Relay": false,
            "AR": 0,
            "BMV": "",
            "FW": "",
            "H1": 0,
            "H2": 0,
            "H3": 0,
            "H4": 0,
            "H5": 0,
            "H6": 0,
            "H7": 0,
            "H8": 0,
            "H9": 0,
            "H10": 0,
            "H11": 0,
            "H12": 0,
            "H13": 0,
            "H14": 0,
            "H15": 0,
            "H16": 0,
        };
        this.meta = {
            "V": { type: "number", role: "value.voltage", scale: function (v) { return v / 1000; }, unit: "V", label: "Battery voltage", descr: " this readout is useful to make a rough estimation of the battery’s state- of - charge.A 12 V battery is considered empty when it cannot maintain a voltage of 10.5 V under load conditions.Excessive voltage drops for a charged battery when under heavy load can also indicate that battery capacity is insufficient. " },
            "VS": { type: "number", role: "value.voltage", scale: function (v) { return v / 1000; }, unit: "V", label: "Starter battery voltage", descr: "this readout is useful to make a rough estimation of the starter battery’s state- of - charge." },
            "I": { type: "number", role: "value.current", scale: function (v) { return v / 1000; }, unit: "A", label: "Current", descr: " this represents the actual current flowing in to or out of the battery. A discharge current is indicated as a negative value (current flowing out of the battery).If for example a DC to AC inverter draws 5 A from the battery, it will be displayed as –5.0 A." },
            "CE": { type: "number", role: "value.power.consumption", scale: function (v) { return v / 1000; }, unit: "Ah", label: "Consumend Energy", descr: " this displays the amount of Ah consumed from the battery.A fully charged battery sets this readout to 0.0 Ah  (synchronised system). If a current of 12 A is drawn from the battery for a period of 3hours, this readout will show –36.0 Ah. " },
            "SOC": { type: "number", role: "value.battery", scale: function (v) { return v / 10; }, unit: "%", label: "State-of-charge", descr: " this is the best way to monitor the actual state of the battery. This readout represents the current amount of energy left in the battery. A fully charged battery will be indicated by a value of 100.0%. A fully discharged battery will be indicated by a value of 0.0%" },
            "TTG": { type: "number", role: "state", scale: function (v) { return v / 60; }, unit: "h", label: "Time-to-go", descr: " this is an estimation of how long the battery can support the present load until it needs recharging. " },
            "Alarm": { type: "boolean", role: "state", scale: function (v) { return v == "ON" ? true : false; }, unit: "", label: "Alarm", descr: "" },
            "Relay": { type: "boolean", role: "state", scale: function (v) { return v == "ON" ? true : false; }, unit: "", label: "Relay", descr: "" },
            "AR": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "", label: "AR", descr: "" },
            "BMV": { type: "string", role: "state", scale: function (v) { return v; }, unit: "", label: "Device", descr: "" },
            "FW": { type: "string", role: "state", scale: function (v) { return v; }, unit: "", label: "Version", descr: "Firmware version" },
            "H1": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "Ah", label: "deepest discharge", descr: "The depth of the deepest discharge. This is the largest value recorded for Ah consumed . " },
            "H2": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "Ah", label: "last discharge", descr: "The depth of the last discharge. This is the largest value recorded for Ah consumed since the last synchronisation. " },
            "H3": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "Ah", label: "average discharge", descr: "The depth of the average discharge. " },
            "H4": { type: "number", role: "state", scale: function (v) { return v / 100; }, unit: "", label: "number of cycles", descr: "The number of charge cycles. A charge cycle is counted every time the sate of charge drops below 65 %, then rises above 90 % " },
            "H5": { type: "number", role: "state", scale: function (v) { return v / 100; }, unit: "", label: "number of full discharges", descr: "The number of full discharges. A full discharge is counted when the state of charge reaches 0 %. " },
            "H6": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "Ah", label: "The cumulative number of Amp hours drawn from the battery", descr: "" },
            "H7": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "V", label: "The minimum battery voltage.", descr: "" },
            "H8": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "V", label: "The maximum battery voltage. ", descr: "" },
            "H9": { type: "number", role: "state", scale: function (v) { return v / 60 / 60 / 24; }, unit: "The number of days since the last full charge. ", label: "", descr: "" },
            "H10": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "", label: "The number of times the BMV has automatically synchronised. ", descr: "" },
            "H11": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "", label: "The number of low voltage alarms. ", descr: "" },
            "H12": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "", label: "The number of high voltage alarms. ", descr: "" },
            "H13": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "", label: "The number of low starter battery voltage alarms.", descr: "" },
            "H14": { type: "number", role: "state", scale: function (v) { return parseFloat(v); }, unit: "", label: "The number of high starter battery voltage alarms.", descr: "" },
            "H15": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "V", label: "The minimum starter battery voltage", descr: "" },
            "H16": { type: "number", role: "state", scale: function (v) { return v / 1000; }, unit: "V", label: "The maximum starter battery voltage. ", descr: "" }
        };
        // this.port = new SerialPort(serialportPath)
        // this.open(serialportPath)
    }
    receiveBmv() {
        if (this.port) {
            const parser = this.port.pipe(new SerialPort.parsers.Delimiter({ delimiter: '\r\n' }));
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            // on recive data event
            parser.on('data', function (data) {
                //line = new Buffer(data).toString('ascii');
                const line = new Buffer(data);
                //console.log("DATA->" , line)
                self.frame = Buffer.concat([self.frame, line, Buffer.from("\r\n")]);
                // Detect end of frame
                if (line.toString().startsWith("Checksum")) {
                    //console.log("detect end of frame")
                    // Modulo256
                    let sum = 0;
                    for (let i = 0; i < self.frame.length; i++) {
                        sum = (sum + self.frame[i]) % 256;
                    }
                    if (sum == 0) {
                        // frame is ok
                        self.parseValues(self.frame);
                        self.cb(self.data);
                    }
                    else {
                        //console.log("frame error !!!");
                    }
                    // reset frame
                    self.frame = new Buffer(0);
                }
            });
        }
    }
    // convert frame to javascript object
    parseValues(frame) {
        //console.log("parseValues");
        const lines = new Buffer(frame).toString('ascii').split('\r\n');
        for (let i = 0; i < lines.length - 2; i++) {
            const line = lines[i].split('\t');
            this.data[line[0]] = this.meta[line[0]].scale(line[1]);
        }
    }
    //this.port
    async open(serialportPath) {
        return new Promise((resolve, reject) => {
            // open serial port
            this.port = new SerialPort(serialportPath, {
                baudRate: 19200,
            }, (error) => {
                if (error) {
                    console.log("BMV error:", error);
                    reject("bmv error" + error);
                }
                else {
                    if (this.port) {
                        this.port.set({
                            "dtr": false,
                            "rts": false,
                            "cts": false,
                            //"dts": false,
                            "brk": false,
                        });
                        console.log("bmv port is open");
                        this.receiveBmv();
                    }
                    resolve();
                }
            });
        });
    }
    close() {
        if (this.port && this.isOpen) {
            this.port.close();
        }
    }
    isOpen() {
        return (this.port && this.port.isOpen) ? true : false;
    }
}
exports.VictronBmvCom = VictronBmvCom;
//# sourceMappingURL=victronBmvCom.js.map