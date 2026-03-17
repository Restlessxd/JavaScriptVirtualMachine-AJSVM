import { Environment } from './environment.js';
import { CallFrame } from './callframe.js';
import { SuspendException, YieldException } from './exceptions.js';
export class ClosureHandler {
    vm;
    constructor(vm) {
        this.vm = vm;
    }
    callClosure(closure, argCount, basePointer, thisArg, argsArray, isConstructorCall = false) {
        if (closure.func.isGenerator) {
            if (isConstructorCall)
                throw new TypeError("Error: Generator functions cannot be used as constructors.");
            const args = argsArray || this.vm.stack.slice(basePointer + 1, basePointer + 1 + argCount);
            const childVm = this.vm.createChildVM();
            const newEnv = new Environment(closure.env);
            newEnv.variables[0] = thisArg !== undefined ? thisArg : closure;
            for (let i = 0; i < closure.func.arity; i++)
                newEnv.variables[i + 1] = i < args.length ? args[i] : undefined;
            if (closure.func.hasRest)
                newEnv.variables[closure.func.arity + 1] = args.slice(closure.func.arity);
            childVm.stack[childVm.sp++] = closure;
            childVm.fp++;
            if (childVm.frames[childVm.fp]) {
                const f = childVm.frames[childVm.fp];
                f.closure = closure;
                f.env = newEnv;
                f.basePointer = 0;
                f.isConstructorCall = false;
                f.constructedInstance = thisArg;
                f.catchHandlers.length = 0;
                f.ip = 0;
            }
            else {
                childVm.frames[childVm.fp] = new CallFrame(closure, newEnv, 0, false, thisArg);
            }
            let isFinished = false;
            let isFirstNext = true;
            if (closure.func.isAsync) {
                const asyncGeneratorObj = {
                    next: async (arg) => {
                        if (isFinished)
                            return { value: undefined, done: true };
                        if (!isFirstNext)
                            childVm.stack[childVm.sp++] = arg;
                        isFirstNext = false;
                        while (true) {
                            try {
                                childVm.run(0);
                                isFinished = true;
                                return { value: childVm.stack[--childVm.sp], done: true };
                            }
                            catch (e) {
                                if (e instanceof SuspendException) {
                                    try {
                                        const result = await e.promise;
                                        childVm.stack[childVm.sp++] = result;
                                    }
                                    catch (err) {
                                        if (!childVm.exceptionHandler.handleException(err, 0))
                                            throw err;
                                    }
                                }
                                else if (e instanceof YieldException) {
                                    return { value: e.value, done: false };
                                }
                                else {
                                    throw e;
                                }
                            }
                        }
                    },
                    [Symbol.asyncIterator]() { return this; }
                };
                this.vm.sp = basePointer;
                this.vm.stack[this.vm.sp++] = asyncGeneratorObj;
                return;
            }
            const generatorObj = {
                next: (arg) => {
                    if (isFinished)
                        return { value: undefined, done: true };
                    if (!isFirstNext)
                        childVm.stack[childVm.sp++] = arg;
                    isFirstNext = false;
                    try {
                        childVm.run(0);
                        isFinished = true;
                        return { value: childVm.stack[--childVm.sp], done: true };
                    }
                    catch (e) {
                        if (e instanceof YieldException)
                            return { value: e.value, done: false };
                        throw e;
                    }
                },
                [Symbol.iterator]() { return this; }
            };
            this.vm.sp = basePointer;
            this.vm.stack[this.vm.sp++] = generatorObj;
            return;
        }
        if (closure.func.isAsync) {
            if (isConstructorCall)
                throw new TypeError("Error: Async functions cannot be used as constructors.");
            const args = argsArray || this.vm.stack.slice(basePointer + 1, basePointer + 1 + argCount);
            const childVm = this.vm.createChildVM();
            const promise = childVm.closureHandler.executeAsyncClosure(closure, args, thisArg);
            this.vm.sp = basePointer;
            this.vm.stack[this.vm.sp++] = promise;
            return;
        }
        const newEnv = new Environment(closure.env);
        newEnv.variables[0] = thisArg !== undefined ? thisArg : closure;
        const arity = closure.func.arity;
        if (argsArray) {
            for (let i = 0; i < arity; i++)
                newEnv.variables[i + 1] = i < argsArray.length ? argsArray[i] : undefined;
            if (closure.func.hasRest)
                newEnv.variables[arity + 1] = argsArray.slice(arity);
        }
        else {
            for (let i = 0; i < arity; i++)
                newEnv.variables[i + 1] = i < argCount ? this.vm.stack[basePointer + 1 + i] : undefined;
            if (closure.func.hasRest) {
                const restCount = Math.max(0, argCount - arity);
                const restArr = new Array(restCount);
                for (let i = 0; i < restCount; i++)
                    restArr[i] = this.vm.stack[basePointer + 1 + arity + i];
                newEnv.variables[arity + 1] = restArr;
            }
        }
        if (this.vm.fp >= this.vm.MAX_CALL_STACK_SIZE - 1) {
            const err = new RangeError("Error: Maximum call stack size exceeded");
            if (!this.vm.exceptionHandler.handleException(err, 0))
                throw err;
            return;
        }
        this.vm.fp++;
        if (this.vm.frames[this.vm.fp]) {
            const f = this.vm.frames[this.vm.fp];
            f.closure = closure;
            f.env = newEnv;
            f.basePointer = basePointer;
            f.isConstructorCall = isConstructorCall;
            f.constructedInstance = thisArg;
            f.catchHandlers.length = 0;
            f.ip = 0;
        }
        else {
            this.vm.frames[this.vm.fp] = new CallFrame(closure, newEnv, basePointer, isConstructorCall, thisArg);
        }
    }
    async executeAsyncClosure(closure, args, thisArg) {
        const newEnv = new Environment(closure.env);
        newEnv.variables[0] = thisArg !== undefined ? thisArg : closure;
        for (let i = 0; i < closure.func.arity; i++)
            newEnv.variables[i + 1] = i < args.length ? args[i] : undefined;
        if (closure.func.hasRest)
            newEnv.variables[closure.func.arity + 1] = args.slice(closure.func.arity);
        this.vm.stack[0] = closure;
        this.vm.sp = 1;
        this.vm.fp = 0;
        if (this.vm.frames[0]) {
            const f = this.vm.frames[0];
            f.closure = closure;
            f.env = newEnv;
            f.basePointer = 0;
            f.isConstructorCall = false;
            f.constructedInstance = thisArg;
            f.catchHandlers.length = 0;
            f.ip = 0;
        }
        else {
            this.vm.frames[0] = new CallFrame(closure, newEnv, 0, false, thisArg);
        }
        while (this.vm.fp >= 0) {
            try {
                this.vm.run(0);
                break;
            }
            catch (e) {
                if (e instanceof SuspendException) {
                    try {
                        const result = await e.promise;
                        this.vm.stack[this.vm.sp++] = result;
                    }
                    catch (err) {
                        if (!this.vm.exceptionHandler.handleException(err, 0))
                            throw err;
                    }
                }
                else {
                    throw e;
                }
            }
        }
        return this.vm.stack[--this.vm.sp];
    }
}
