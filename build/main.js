"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VictronBmv = void 0;
const utils = __importStar(require("@iobroker/adapter-core"));
const fields_1 = require("./veDirect/fields");
const victronBmvCom_1 = require("./victronBmvCom");
const WATCHDOG_INTERVAL_MS = 1000;
const DATA_TIMEOUT_MS = 5000;
const RECONNECT_COOLDOWN_MS = 5000;
class VictronBmv extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: "victron-bmv" });
        this.bmv = new victronBmvCom_1.VictronBmvCom();
        this.lastFrameTime = 0;
        this.lastOpenAttempt = 0;
        this.frameQueue = Promise.resolve();
        this.unloaded = false;
        this.stateQueues = new Map();
        this.lastStateValues = new Map();
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
    async onReady() {
        if (this.unloaded) {
            return;
        }
        await this.initObjects();
        if (this.unloaded) {
            return;
        }
        await this.safeSetConnectionState(false);
        if (this.unloaded) {
            return;
        }
        if (!this.config.serialPortPath || this.config.serialPortPath === "/dev/xxx") {
            this.log.error("Configure a valid VE.Direct serial port before starting the adapter");
            return;
        }
        this.bmv.onValidFrame = () => {
            this.lastFrameTime = Date.now();
            void this.safeSetConnectionState(true);
        };
        this.bmv.onFrame = frame => {
            this.enqueueFrame({ ...frame });
        };
        this.bmv.onError = error => {
            this.log.error(`VE.Direct serial error: ${error.message}`);
        };
        if (this.unloaded) {
            return;
        }
        void this.watchDog();
        this.watchDogInterval = setInterval(() => void this.watchDog(), WATCHDOG_INTERVAL_MS);
    }
    async initObjects() {
        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                name: "Fresh valid VE.Direct frame received",
                type: "boolean",
                role: "indicator.connected",
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
        for (const field of Object.values(fields_1.VE_DIRECT_FIELDS)) {
            const common = {
                name: field.label,
                type: field.type,
                role: field.role,
                read: true,
                write: false,
                unit: field.unit,
            };
            await this.setObjectNotExistsAsync(field.id, { type: "state", common, native: {} });
            await this.extendObjectAsync(field.id, { common });
        }
    }
    watchDog() {
        const operation = this.performWatchDog();
        this.activeWatchDog = operation;
        const clear = () => {
            if (this.activeWatchDog === operation) {
                this.activeWatchDog = undefined;
            }
        };
        void operation.then(clear, clear);
        return operation;
    }
    async performWatchDog() {
        if (this.unloaded) {
            return;
        }
        const fresh = this.lastFrameTime > 0 && Date.now() - this.lastFrameTime < DATA_TIMEOUT_MS;
        if (fresh) {
            return;
        }
        await this.safeSetConnectionState(false);
        if (this.unloaded) {
            return;
        }
        const now = Date.now();
        if (now - this.lastOpenAttempt < RECONNECT_COOLDOWN_MS) {
            return;
        }
        this.lastOpenAttempt = now;
        try {
            if (this.bmv.isOpen()) {
                await this.bmv.close();
                if (this.unloaded) {
                    return;
                }
            }
            if (this.unloaded) {
                return;
            }
            await this.bmv.open(this.config.serialPortPath);
            // Opening a port is not a device connection. info.connection becomes
            // true only after the first checksum-valid frame.
        }
        catch (error) {
            if (!this.unloaded) {
                this.log.error(`Could not open/reopen VE.Direct port: ${this.errorText(error)}`);
                await this.safeSetConnectionState(false);
            }
        }
    }
    enqueueFrame(frame) {
        if (this.unloaded) {
            return;
        }
        const snapshot = { ...frame };
        const operation = this.frameQueue.then(() => this.publishFrame(snapshot));
        this.frameQueue = operation.catch(error => {
            this.log.error(`Could not process VE.Direct frame: ${this.errorText(error)}`);
        });
    }
    async publishFrame(frame) {
        if (this.unloaded) {
            return;
        }
        await this.safeSetConnectionState(true);
        for (const [key, value] of Object.entries(frame)) {
            if (this.unloaded) {
                return;
            }
            if (this.lastStateValues.has(key) && this.lastStateValues.get(key) === value) {
                continue;
            }
            try {
                await this.writeState(key, value);
                this.lastStateValues.set(key, value);
            }
            catch (error) {
                this.log.error(`Could not publish ${key}: ${this.errorText(error)}`);
            }
        }
    }
    writeState(key, value) {
        var _a;
        const previous = (_a = this.stateQueues.get(key)) !== null && _a !== void 0 ? _a : Promise.resolve();
        const result = previous.catch(() => undefined).then(() => this.setStateAsync(key, { val: value, ack: true })).then(() => undefined);
        const tracked = result.then(() => undefined, () => undefined);
        this.stateQueues.set(key, tracked);
        void tracked.then(() => {
            if (this.stateQueues.get(key) === tracked) {
                this.stateQueues.delete(key);
            }
        });
        return result;
    }
    async safeSetConnectionState(connected) {
        if (this.connectionRequested === connected) {
            return;
        }
        this.connectionRequested = connected;
        try {
            await this.writeState("info.connection", connected);
            this.connectionState = connected;
        }
        catch (error) {
            if (this.connectionRequested === connected) {
                this.connectionRequested = undefined;
            }
            this.log.error(`Could not update info.connection: ${this.errorText(error)}`);
        }
    }
    onUnload(callback) {
        if (this.unloaded) {
            callback();
            return;
        }
        this.unloaded = true;
        if (this.watchDogInterval) {
            clearInterval(this.watchDogInterval);
            this.watchDogInterval = undefined;
        }
        this.bmv.onFrame = undefined;
        this.bmv.onValidFrame = undefined;
        const pendingWatchDog = this.activeWatchDog;
        void this.bmv.close()
            .catch(error => this.log.error(`Error closing VE.Direct port: ${this.errorText(error)}`))
            .then(async () => {
            const pending = [...this.stateQueues.values()];
            if (pendingWatchDog) {
                pending.push(pendingWatchDog);
            }
            await Promise.all(pending.map(promise => promise.catch(() => undefined)));
        })
            .then(callback, callback);
    }
    errorText(error) {
        return error instanceof Error ? error.stack || error.message : String(error);
    }
}
exports.VictronBmv = VictronBmv;
if (require.main !== module) {
    module.exports = (options) => new VictronBmv(options);
    module.exports.VictronBmv = VictronBmv;
}
else {
    (() => new VictronBmv())();
}
//# sourceMappingURL=main.js.map