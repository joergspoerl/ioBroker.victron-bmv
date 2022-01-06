"use strict";
/*
 * Created with @iobroker/create-adapter v2.0.1
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = __importStar(require("@iobroker/adapter-core"));
const victron_bmv_1 = require("./victron_bmv");
// Load your modules here, e.g.:
// import * as fs from "fs";
class Jstest extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "jstest",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        this.log.info("config option1: " + this.config.option1);
        this.log.info("config option2: " + this.config.option2);
        this.log.info("config option2: " + this.config.serialPortPath);
        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */
        // /dev/tty.usbserial-FTG63ICY
        this.bmv = new victron_bmv_1.Victron_bmv(this.config.serialPortPath);
        await this.initBmvObjects();
        // this.intervalRef = this.setInterval(async () => {
        // 	this.log.info("interval: ");
        // 	await this.setStateAsync("bmv-value", Math.random());
        // }, 60000);
        this.bmv.cb = async (data) => {
            //this.log.info("bmv callback: data:" + JSON.stringify(data));
            await this.setStateAsync("V", data.V, true);
            await this.setStateAsync("VS", data.VS, true);
            await this.setStateAsync("I", data.VS, true);
            await this.setStateAsync("CE", data.CE, true);
            await this.setStateAsync("SOC", data.SOC, true);
            await this.setStateAsync("TTG", data.TTG, true);
            await this.setStateAsync("Alarm", data.Alarm, true);
            await this.setStateAsync("Relay", data.Relay, true);
            await this.setStateAsync("AR", data.AR, true);
            await this.setStateAsync("BMV", data.BMV, true);
            await this.setStateAsync("FW", data.FW, true);
            await this.setStateAsync("H1", data.H1, true);
            await this.setStateAsync("H2", data.H2, true);
            await this.setStateAsync("H3", data.H3, true);
            await this.setStateAsync("H4", data.H4, true);
            await this.setStateAsync("H5", data.H5, true);
            await this.setStateAsync("H6", data.H6, true);
            await this.setStateAsync("H7", data.H7, true);
            await this.setStateAsync("H8", data.H8, true);
            await this.setStateAsync("H9", data.H9, true);
            await this.setStateAsync("H10", data.H10, true);
            await this.setStateAsync("H11", data.H11, true);
            await this.setStateAsync("H12", data.H12, true);
            await this.setStateAsync("H13", data.H13, true);
            await this.setStateAsync("H14", data.H14, true);
            await this.setStateAsync("H15", data.H15, true);
            await this.setStateAsync("H16", data.H16, true);
            return;
        };
        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        //this.subscribeStates("*");
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates("lights.*");
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates("*");
        /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        await this.setStateAsync("testVariable", true);
        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        await this.setStateAsync("testVariable", { val: true, ack: true });
        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });
        // examples for the checkPassword/checkGroup functions
        let result = await this.checkPasswordAsync("admin", "iobroker");
        this.log.info("check user admin pw iobroker: " + result);
        result = await this.checkGroupAsync("admin", "admin");
        this.log.info("check group user admin group admin: " + result);
    }
    async initBmvObjects() {
        var _a, _b;
        const propNames = Object.getOwnPropertyNames((_a = this.bmv) === null || _a === void 0 ? void 0 : _a.meta);
        for (let i = 0; i < propNames.length; i++) {
            const propName = propNames[i];
            const prop = ((_b = this.bmv) === null || _b === void 0 ? void 0 : _b.meta)[propName];
            const type = prop.type;
            let name = prop.label;
            if (prop.unit && prop.unit.length > 0) {
                name += " ( " + prop.unit + " )";
            }
            await this.setObjectNotExistsAsync(propName, {
                type: "state",
                common: {
                    name: name,
                    type: type,
                    role: prop.role,
                    read: true,
                    write: false,
                    unit: prop.unit,
                },
                native: {},
            });
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        var _a;
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);
            (_a = this.bmv) === null || _a === void 0 ? void 0 : _a.close();
            callback();
        }
        catch (e) {
            callback();
        }
    }
    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  */
    // private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    // 	if (obj) {
    // 		// The object was changed
    // 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    // 	} else {
    // 		// The object was deleted
    // 		this.log.info(`object ${id} deleted`);
    // 	}
    // }
    /**
     * Is called if a subscribed state changes
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        }
        else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new Jstest(options);
}
else {
    // otherwise start the instance directly
    (() => new Jstest())();
}
//# sourceMappingURL=main.js.map