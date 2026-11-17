"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VeDirectParser = void 0;
const fields_1 = require("./fields");
const COLON = 0x3a;
const LF = 0x0a;
const CR = 0x0d;
const MAX_FRAME_BYTES = 8192;
const MAX_LINE_BYTES = 128;
const CHECKSUM_LABEL = Buffer.from("Checksum\t", "ascii");
/** Byte-oriented VE.Direct TEXT parser with asynchronous HEX exclusion. */
class VeDirectParser {
    constructor() {
        this.checksumErrors = 0;
        this.invalidFrames = 0;
        this.unknownFields = 0;
        this.invalidValues = 0;
        this.hexMessages = 0;
        this.frame = Buffer.alloc(0);
        this.line = [];
        this.records = {};
        this.expectChecksum = false;
        this.hexCandidate = false;
        this.inHex = false;
        this.discarding = false;
        this.discardSawCR = false;
        this.malformed = false;
    }
    receive(data) {
        for (const byte of data) {
            if (this.discarding) {
                if (byte === CR) {
                    this.discardSawCR = true;
                    continue;
                }
                if (byte === LF) {
                    const restart = this.discardSawCR;
                    this.discarding = false;
                    this.discardSawCR = false;
                    if (restart) {
                        // The leading CRLF is part of the next frame checksum.
                        this.processTextByte(CR);
                        this.processTextByte(LF);
                    }
                    continue;
                }
                this.discardSawCR = false;
                continue;
            }
            if (this.inHex) {
                if (byte === LF) {
                    this.inHex = false;
                    this.hexMessages++;
                }
                continue;
            }
            if (this.hexCandidate) {
                this.hexCandidate = false;
                if (byte === 0x41) { // asynchronous HEX messages start with :A
                    this.inHex = true;
                    continue;
                }
                // A colon can itself be the binary checksum value. If no 'A'
                // follows, process it normally before the current byte.
                this.processTextByte(COLON);
            }
            if (byte === COLON) {
                this.hexCandidate = true;
                continue;
            }
            this.processTextByte(byte);
        }
        if (this.hexCandidate && this.expectChecksum && this.isValidChecksumByte(COLON)) {
            this.hexCandidate = false;
            this.processTextByte(COLON);
        }
    }
    isValidChecksumByte(byte) {
        let checksum = byte;
        for (const frameByte of this.frame) {
            checksum = (checksum + frameByte) & 0xff;
        }
        return checksum === 0;
    }
    reset() {
        this.frame = Buffer.alloc(0);
        this.line = [];
        this.records = {};
        this.expectChecksum = false;
        this.hexCandidate = false;
        this.inHex = false;
        this.discarding = false;
        this.discardSawCR = false;
        this.malformed = false;
    }
    processTextByte(byte) {
        if (this.expectChecksum) {
            this.frame = Buffer.concat([this.frame, Buffer.from([byte])]);
            this.completeFrame();
            return;
        }
        this.appendTextByte(byte);
    }
    appendTextByte(byte) {
        if (this.frame.length >= MAX_FRAME_BYTES || this.line.length >= MAX_LINE_BYTES) {
            this.invalidFrames++;
            this.reset();
            this.discarding = true;
            return;
        }
        this.frame = Buffer.concat([this.frame, Buffer.from([byte])]);
        this.line.push(byte);
        if (byte === LF) {
            this.finishLine();
            this.line = [];
            return;
        }
        if (Buffer.from(this.line).equals(CHECKSUM_LABEL)) {
            this.expectChecksum = true;
        }
    }
    finishLine() {
        let line = this.line;
        if (line[line.length - 1] === LF) {
            line = line.slice(0, -1);
        }
        if (line[line.length - 1] === CR) {
            line = line.slice(0, -1);
        }
        if (line.length === 0) {
            return;
        }
        const tab = line.indexOf(0x09);
        if (tab <= 0) {
            this.malformed = true;
            return;
        }
        const label = Buffer.from(line.slice(0, tab)).toString("ascii");
        const value = Buffer.from(line.slice(tab + 1)).toString("ascii");
        try {
            const decoded = (0, fields_1.decodeVeDirectField)(label, value);
            if (decoded === null) {
                this.unknownFields++;
                return;
            }
            Object.assign(this.records, decoded);
        }
        catch (_a) {
            this.invalidValues++;
            this.malformed = true;
        }
    }
    completeFrame() {
        let checksum = 0;
        for (const byte of this.frame) {
            checksum = (checksum + byte) & 0xff;
        }
        if (checksum !== 0) {
            this.checksumErrors++;
        }
        else if (this.malformed) {
            this.invalidFrames++;
        }
        else {
            if (this.onValidFrame) {
                this.onValidFrame();
            }
            if (Object.keys(this.records).length > 0 && this.onFrame) {
                this.onFrame({ ...this.records });
            }
        }
        this.reset();
    }
}
exports.VeDirectParser = VeDirectParser;
//# sourceMappingURL=veDirectParser.js.map