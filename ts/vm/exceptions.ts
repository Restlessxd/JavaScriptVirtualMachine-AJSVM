export class SuspendException extends Error {
    constructor(public promise: Promise < any > ) {
        super("Suspend");
    }
}

export class YieldException extends Error {
    constructor(public value: any) {
        super("Yield");
    }
}