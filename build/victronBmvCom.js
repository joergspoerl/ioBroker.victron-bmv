"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VictronBmvCom = void 0;
const veDirectParser_1 = require("./veDirect/veDirectParser");
const defaultPortFactory = (path, options, callback) => {
    // Load native bindings only for a real open, not for parser/unit tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SerialPort = require("serialport");
    return new SerialPort(path, options, callback);
};
class VictronBmvCom {
    constructor(portFactory = defaultPortFactory) {
        this.portFactory = portFactory;
        this.parser = new veDirectParser_1.VeDirectParser();
        this.closeListeners = new WeakMap();
        this.errorListener = (error) => {
            this.reportError(error);
        };
        this.parser.onFrame = frame => {
            if (this.onFrame) {
                this.onFrame({ ...frame });
            }
        };
        this.parser.onValidFrame = () => {
            if (this.onValidFrame) {
                this.onValidFrame();
            }
        };
        this.dataListener = data => {
            try {
                this.parser.receive(Buffer.from(data));
            }
            catch (error) {
                this.reportError(error);
            }
        };
    }
    isOpen() {
        var _a;
        return ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) === true;
    }
    async open(serialportPath) {
        if (this.closePromise) {
            await this.closePromise.catch(() => undefined);
        }
        if (this.isOpen()) {
            return;
        }
        if (this.openPromise) {
            return this.openPromise;
        }
        this.parser.reset();
        const operation = new Promise((resolve, reject) => {
            let port;
            try {
                port = this.portFactory(serialportPath, { baudRate: 19200 }, openError => {
                    if (openError) {
                        this.openFailed(port, openError);
                        reject(openError);
                        return;
                    }
                    port.set({ dtr: false, rts: false, cts: false, brk: false }, setError => {
                        if (setError) {
                            this.openFailed(port, setError);
                            reject(setError);
                            return;
                        }
                        port.on("data", this.dataListener);
                        const closeListener = () => {
                            if (this.port === port) {
                                this.port = undefined;
                                this.parser.reset();
                            }
                        };
                        this.closeListeners.set(port, closeListener);
                        port.on("close", closeListener);
                        resolve();
                    });
                });
                this.port = port;
                port.on("error", this.errorListener);
            }
            catch (error) {
                reject(error);
            }
        });
        this.openPromise = operation;
        try {
            await operation;
        }
        finally {
            this.openPromise = undefined;
        }
    }
    close() {
        if (this.closePromise) {
            return this.closePromise;
        }
        const operation = this.performClose();
        this.closePromise = operation;
        const clear = () => {
            if (this.closePromise === operation) {
                this.closePromise = undefined;
            }
        };
        void operation.then(clear, clear);
        return operation;
    }
    async performClose() {
        if (this.openPromise) {
            await this.openPromise.catch(() => undefined);
        }
        const port = this.port;
        if (!port) {
            this.parser.reset();
            return;
        }
        port.removeListener("data", this.dataListener);
        this.parser.reset();
        try {
            if (port.isOpen) {
                await new Promise((resolve, reject) => {
                    port.close(error => error ? reject(error) : resolve());
                });
            }
            if (port.isOpen) {
                throw new Error("Serial port remained open after close");
            }
            this.cleanupPort(port);
        }
        catch (error) {
            if (port.isOpen) {
                // Keep a still-open port referenced and retryable. Never lose it or
                // remove its error listener while the OS resource is alive.
                this.port = port;
            }
            else {
                this.cleanupPort(port);
            }
            throw error;
        }
    }
    openFailed(port, error) {
        if (this.port === port) {
            this.port = undefined;
        }
        this.parser.reset();
        port.removeListener("data", this.dataListener);
        this.removeCloseListener(port);
        if (port.isOpen) {
            port.close(closeError => {
                if (closeError) {
                    this.reportError(closeError);
                }
            });
        }
        else {
            port.removeListener("error", this.errorListener);
        }
        this.reportError(error);
    }
    cleanupPort(port) {
        if (this.port === port) {
            this.port = undefined;
        }
        port.removeListener("data", this.dataListener);
        this.removeCloseListener(port);
        port.removeListener("error", this.errorListener);
    }
    removeCloseListener(port) {
        const listener = this.closeListeners.get(port);
        if (listener) {
            port.removeListener("close", listener);
            this.closeListeners.delete(port);
        }
    }
    reportError(error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (this.onError) {
            this.onError(normalized);
        }
    }
}
exports.VictronBmvCom = VictronBmvCom;
//# sourceMappingURL=victronBmvCom.js.map