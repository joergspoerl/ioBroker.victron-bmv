/*
 * Created with @iobroker/create-adapter v2.0.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import { Bmv_data, Bmv_meta_entry, VictronBmvCom } from "./victronBmvCom";

// Load your modules here, e.g.:
// import * as fs from "fs";

class victronBmv extends utils.Adapter {
	bmv: VictronBmvCom = new VictronBmvCom();
	lastResultTime = 0;
	watchDogintervalRef: ioBroker.Interval | undefined;
	watchDogIntervalTime = 10;
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: "victron-bmv",
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
	private async onReady(): Promise<void> {
		// Initialize your adapter here

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		this.log.info("config option2: " + this.config.serialPortPath);

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
		// /dev/tty.usbserial-FTG63ICY

		await this.initConnectionInfoObject();
		await this.initBmvObjects();

		this.watchDog(); // first connection
		this.watchDogintervalRef = this.setInterval(async () => {
			this.watchDog();
		}, this.watchDogIntervalTime * 1000);

		this.bmv.cb = async (data: Bmv_data) => {
			this.bmvCallback(data);
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
		// await this.setStateAsync("testVariable", true);

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		// await this.setStateAsync("testVariable", { val: true, ack: true });

		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		// await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

		// examples for the checkPassword/checkGroup functions
		let result = await this.checkPasswordAsync("admin", "iobroker");
		this.log.info("check user admin pw iobroker: " + result);

		result = await this.checkGroupAsync("admin", "admin");
		this.log.info("check group user admin group admin: " + result);
	}

	private async initConnectionInfoObject(): Promise<void> {
		await this.setObjectNotExistsAsync("info.connection", {
			_id: "info.connection",
			type: "state",
			common: {
				role: "indicator.connected",
				name: "If communication with circuit works",
				type: "boolean",
				read: true,
				write: false,
				def: false,
			},
			native: {},
		});
	}

	private async watchDog(): Promise<void> {
		const timeDiffToLastResult = Date.now() - this.lastResultTime;
		this.log.debug("watchdog interval");
		this.log.debug("watchdog interval lastResultTime: " + this.lastResultTime);
		this.log.debug("watchdog interval timeDiffToLastResult: " + timeDiffToLastResult);

		if (timeDiffToLastResult > 1000) {
			this.log.error("bmv connection lost !");

			try {
				// this.bmv.close();
				if (!this.bmv.isOpen()) {
					await this.bmv.open(this.config.serialPortPath);
				}
				await this.setInfoConnectionState(true);
			} catch (exception) {
				await this.setInfoConnectionState(false);
				this.log.error("open connection to bmv: " + exception);
			}
		}
	}

	private async bmvCallback(data: Bmv_data): Promise<void> {
		this.lastResultTime = Date.now();
		await this.setInfoConnectionState(true);
		this.log.debug("bmv callback: data:" + JSON.stringify(data));
		await this.setStateAsync("V", data.V, true);
		await this.setStateAsync("VS", data.VS, true);
		await this.setStateAsync("I", data.I, true);
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
	}
	private async setInfoConnectionState(state: boolean): Promise<void> {
		await this.setStateAsync("info.connection", state, true);
	}

	private async initBmvObjects(): Promise<void> {
		const propNames = Object.getOwnPropertyNames(this.bmv?.meta);

		for (let i = 0; i < propNames.length; i++) {
			const propName = propNames[i];
			const prop = (this.bmv?.meta as any)[propName] as Bmv_meta_entry;
			const type: ioBroker.CommonType = prop.type as ioBroker.CommonType;
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
	private onUnload(callback: () => void): void {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			clearInterval(this.watchDogintervalRef);
			this.bmv?.close();
			callback();
		} catch (e) {
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
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  */
	// private onMessage(obj: ioBroker.Message): void {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new victronBmv(options);
} else {
	// otherwise start the instance directly
	(() => new victronBmv())();
}
