export class SuspendException extends Error {
    promise;
    constructor(promise) {
        super("Suspend");
        this.promise = promise;
    }
}
export class YieldException extends Error {
    value;
    constructor(value) {
        super("Yield");
        this.value = value;
    }
}
