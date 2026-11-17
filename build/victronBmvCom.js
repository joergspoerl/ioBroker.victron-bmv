"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VictronBmvCom = exports.SERIAL_CLOSE_TIMEOUT_MS = exports.SERIAL_OPEN_TIMEOUT_MS = void 0;
const veDirectParser_1 = require("./veDirect/veDirectParser");
exports.SERIAL_OPEN_TIMEOUT_MS = 10000;
exports.SERIAL_CLOSE_TIMEOUT_MS = 5000;
class SerialOperationTimeoutError extends Error {
    constructor(operation, timeoutMs) {
        super(`Serial ${operation} timed out after ${timeoutMs} ms`);
        this.name = "SerialOperationTimeoutError";
    }
}
const defaultPortFactory = (path, options, callback) => {
    // Load native bindings only for a real open, not for parser/unit tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SerialPort } = require("serialport");
    return new SerialPort({ path, baudRate: options.baudRate }, callback);
};
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
class VictronBmvCom {
    constructor(portFactory = defaultPortFactory, options = {}) {
        var _a, _b, _c;
        this.portFactory = portFactory;
        this.parser = new veDirectParser_1.VeDirectParser();
        this.closeRequestId = 0;
        this.openCloseRequestId = 0;
        this.portStates = new WeakMap();
        this.closeWaiters = new WeakMap();
        this.errorListener = (error) => {
            this.reportError(error);
        };
        this.openTimeoutMs = (_a = options.openTimeoutMs) !== null && _a !== void 0 ? _a : exports.SERIAL_OPEN_TIMEOUT_MS;
        this.closeTimeoutMs = (_b = options.closeTimeoutMs) !== null && _b !== void 0 ? _b : exports.SERIAL_CLOSE_TIMEOUT_MS;
        this.lateCloseRetryMs = (_c = options.lateCloseRetryMs) !== null && _c !== void 0 ? _c : 1000;
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
    }
    isOpen() {
        var _a;
        return ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) === true;
    }
    open(serialportPath) {
        const closeRequest = this.closeRequestId;
        if (this.openPromise && this.openCloseRequestId === closeRequest) {
            return this.openPromise;
        }
        const operation = this.performOpen(serialportPath, closeRequest);
        this.openCloseRequestId = closeRequest;
        this.openPromise = operation;
        const clear = () => {
            if (this.openPromise === operation) {
                this.openPromise = undefined;
            }
        };
        void operation.then(clear, clear);
        return operation;
    }
    async performOpen(serialportPath, closeRequest) {
        if (this.closePromise) {
            await this.closePromise.catch(() => undefined);
        }
        this.assertNotCloseRequested(closeRequest);
        const existing = this.port;
        if (existing) {
            const state = this.portStates.get(existing);
            if (existing.isOpen && (state === null || state === void 0 ? void 0 : state.ready) && !state.closed) {
                return;
            }
            if (existing.isOpen || (state === null || state === void 0 ? void 0 : state.closePending)) {
                await this.closePort(existing);
            }
            else if ((state === null || state === void 0 ? void 0 : state.failed) && !state.closed) {
                // Keep its late-open callback/listeners alive, but do not let it
                // become the current session after a replacement opens.
                this.port = undefined;
            }
            else {
                this.cleanupPort(existing);
            }
        }
        this.assertNotCloseRequested(closeRequest);
        this.parser.reset();
        const openResult = deferred();
        let port;
        const state = {
            closed: false,
            ready: false,
            failed: false,
            closePending: false,
            rejectPending: openResult.reject,
            closeListener: () => undefined,
            dataListener: () => undefined,
        };
        const openCallback = (error) => {
            // A factory may legally call back synchronously. Deferring guarantees
            // that the returned port and all listeners have been installed first.
            queueMicrotask(() => {
                if (state.failed) {
                    if (error || !(port === null || port === void 0 ? void 0 : port.isOpen)) {
                        state.closed = true;
                        this.cleanupPort(port);
                    }
                    else {
                        void this.closeLatePort(port);
                    }
                    return;
                }
                if (error) {
                    openResult.reject(error);
                }
                else {
                    openResult.resolve();
                }
            });
        };
        try {
            port = this.portFactory(serialportPath, { baudRate: 19200 }, openCallback);
            state.closeListener = () => this.handlePortClosed(port);
            state.dataListener = data => {
                if (this.port !== port || !state.ready || state.closed) {
                    return;
                }
                try {
                    this.parser.receive(Buffer.from(data));
                }
                catch (error) {
                    this.reportError(error);
                }
            };
            this.portStates.set(port, state);
            this.port = port;
            port.on("error", this.errorListener);
            port.on("close", state.closeListener);
            await this.withTimeout(openResult.promise, this.openTimeoutMs, "open");
            state.rejectPending = undefined;
            this.assertPortUsable(port, state);
            this.assertNotCloseRequested(closeRequest);
            const setResult = deferred();
            state.rejectPending = setResult.reject;
            port.set({ dtr: false, rts: false, cts: false, brk: false }, error => {
                if (error)
                    setResult.reject(error);
                else
                    setResult.resolve();
            });
            await this.withTimeout(setResult.promise, this.openTimeoutMs, "set");
            state.rejectPending = undefined;
            this.assertPortUsable(port, state);
            this.assertNotCloseRequested(closeRequest);
            port.on("data", state.dataListener);
            state.ready = true;
        }
        catch (error) {
            const normalized = this.asError(error);
            state.failed = true;
            state.ready = false;
            state.rejectPending = undefined;
            if (port) {
                await this.handleOpenFailure(port, normalized);
            }
            throw normalized;
        }
    }
    close() {
        this.closeRequestId++;
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
        await this.closePort(port);
    }
    async closePort(port) {
        const state = this.portStates.get(port);
        if (!state || state.closed) {
            this.cleanupPort(port);
            return;
        }
        if (!port.isOpen && !state.closePending) {
            this.cleanupPort(port);
            return;
        }
        state.ready = false;
        port.removeListener("data", state.dataListener);
        if (this.port === port) {
            this.parser.reset();
        }
        const closeEvent = deferred();
        const waiter = () => closeEvent.resolve();
        let waiters = this.closeWaiters.get(port);
        if (!waiters) {
            waiters = new Set();
            this.closeWaiters.set(port, waiters);
        }
        waiters.add(waiter);
        try {
            if (state.closePending) {
                await this.withTimeout(closeEvent.promise, this.closeTimeoutMs, "close");
            }
            else {
                const callbackResult = deferred();
                state.closePending = true;
                port.close(error => {
                    if (error) {
                        state.closePending = false;
                        callbackResult.reject(error);
                        return;
                    }
                    this.handlePortClosed(port);
                    callbackResult.resolve();
                });
                await this.withTimeout(Promise.race([callbackResult.promise, closeEvent.promise]), this.closeTimeoutMs, "close");
            }
        }
        catch (error) {
            // An outstanding close stays pending while the port reports itself
            // closed, so a later attempt waits for it instead of replacing it.
            state.ready = false;
            if (port.isOpen) {
                state.closePending = false;
            }
            throw error;
        }
        finally {
            const registered = this.closeWaiters.get(port);
            registered === null || registered === void 0 ? void 0 : registered.delete(waiter);
            if ((registered === null || registered === void 0 ? void 0 : registered.size) === 0) {
                this.closeWaiters.delete(port);
            }
        }
    }
    async handleOpenFailure(port, error) {
        const state = this.portStates.get(port);
        this.parser.reset();
        if (state) {
            port.removeListener("data", state.dataListener);
        }
        try {
            if ((port.isOpen || (state === null || state === void 0 ? void 0 : state.closePending)) && !(state === null || state === void 0 ? void 0 : state.closed)) {
                await this.closePort(port);
            }
            else if (!(error instanceof SerialOperationTimeoutError && (state === null || state === void 0 ? void 0 : state.failed))) {
                this.cleanupPort(port);
            }
        }
        catch (closeError) {
            this.reportError(closeError);
        }
        this.reportError(error);
    }
    async closeLatePort(port) {
        const state = this.portStates.get(port);
        while (state && !state.closed) {
            try {
                await this.closePort(port);
                return;
            }
            catch (error) {
                this.reportError(error);
                await this.delay(this.lateCloseRetryMs);
            }
        }
        this.cleanupPort(port);
    }
    delay(milliseconds) {
        return new Promise(resolve => {
            const timer = setTimeout(resolve, milliseconds);
            if (typeof timer.unref === "function")
                timer.unref();
        });
    }
    handlePortClosed(port) {
        var _a;
        const state = this.portStates.get(port);
        if (!state || state.closed) {
            return;
        }
        state.closed = true;
        state.ready = false;
        state.closePending = false;
        (_a = state.rejectPending) === null || _a === void 0 ? void 0 : _a.call(state, new Error("Serial port closed while opening"));
        state.rejectPending = undefined;
        const waiters = this.closeWaiters.get(port);
        if (waiters) {
            for (const waiter of [...waiters])
                waiter();
        }
        if (this.port === port) {
            this.port = undefined;
            this.parser.reset();
        }
        this.cleanupPort(port);
    }
    assertPortUsable(port, state) {
        if (state.closed || !port.isOpen) {
            throw new Error("Serial port closed while opening");
        }
    }
    assertNotCloseRequested(closeRequest) {
        if (closeRequest !== this.closeRequestId) {
            throw new Error("Serial open cancelled by close request");
        }
    }
    cleanupPort(port) {
        const state = this.portStates.get(port);
        if (this.port === port) {
            this.port = undefined;
        }
        if (state) {
            port.removeListener("data", state.dataListener);
            port.removeListener("close", state.closeListener);
            state.ready = false;
        }
        port.removeListener("error", this.errorListener);
    }
    withTimeout(promise, timeoutMs, operation) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new SerialOperationTimeoutError(operation, timeoutMs)), timeoutMs);
            if (typeof timer.unref === "function") {
                timer.unref();
            }
            promise.then(value => {
                clearTimeout(timer);
                resolve(value);
            }, error => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    asError(error) {
        return error instanceof Error ? error : new Error(String(error));
    }
    reportError(error) {
        const normalized = this.asError(error);
        if (this.onError) {
            this.onError(normalized);
        }
    }
}
exports.VictronBmvCom = VictronBmvCom;
//# sourceMappingURL=victronBmvCom.js.map