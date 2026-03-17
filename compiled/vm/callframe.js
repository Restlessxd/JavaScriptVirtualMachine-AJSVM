export class CallFrame {
    closure;
    env;
    basePointer;
    isConstructorCall;
    constructedInstance;
    ip = 0;
    catchHandlers = [];
    constructor(closure, env, basePointer, isConstructorCall = false, constructedInstance = null) {
        this.closure = closure;
        this.env = env;
        this.basePointer = basePointer;
        this.isConstructorCall = isConstructorCall;
        this.constructedInstance = constructedInstance;
    }
}
