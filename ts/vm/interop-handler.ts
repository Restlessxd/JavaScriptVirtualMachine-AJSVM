import { VM } from './vm.js';
import { HeapType, isPointer, getPointerValue } from './heap.js';
import { Environment } from './environment.js';
import { CallFrame } from './callframe.js';

export class InteropHandler {
    constructor(private vm: VM) {}

    public unwrapForNative(arg: any, targetFrameCount: number): any {
        if (typeof arg === 'number' && isPointer(arg)) {
            const ptr = getPointerValue(arg);
            const type = this.vm.heap.view.getUint8(ptr);
            if (type === HeapType.OBJECT) {
                return new Proxy({}, {
                    get: (target, prop) => {
                        if (typeof prop === 'string') {
                            const val = this.vm.heap.getProperty(ptr, prop);
                            return this.unwrapForNative(val, targetFrameCount);
                        }
                        return undefined;
                    },
                    set: (target, prop, value) => {
                        if (typeof prop === 'string') {
                            this.vm.heap.setProperty(ptr, prop, value);
                            return true;
                        }
                        return false;
                    },
                    has: (target, prop) => {
                        if (typeof prop === 'string') {
                            return this.vm.heap.getKeys(ptr).includes(prop);
                        }
                        return false;
                    },
                    ownKeys: () => this.vm.heap.getKeys(ptr),
                    getOwnPropertyDescriptor: (target, prop) => {
                        if (typeof prop === 'string' && this.vm.heap.getKeys(ptr).includes(prop)) {
                            return { enumerable: true, configurable: true, writable: true };
                        }
                        return undefined;
                    }
                });
            } else if (type === HeapType.ARRAY) {
                return new Proxy([], {
                    get: (target, prop) => {
                        if (prop === 'length') return this.vm.heap.getArrayLength(ptr);
                        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                            const index = Number(prop);
                            if (index >= 0 && index < this.vm.heap.getArrayLength(ptr)) {
                                const val = this.vm.heap.getArrayElement(ptr, index);
                                return this.unwrapForNative(val, targetFrameCount);
                            }
                        }
                        return (Array.prototype as any)[prop];
                    },
                    set: (target, prop, value) => {
                        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                            this.vm.heap.setArrayElement(ptr, Number(prop), value);
                            return true;
                        }
                        if (prop === 'length') return true;
                        return false;
                    },
                    has: (target, prop) => {
                        if (prop === 'length') return true;
                        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                            const index = Number(prop);
                            return index >= 0 && index < this.vm.heap.getArrayLength(ptr);
                        }
                        return prop in Array.prototype;
                    },
                    ownKeys: () => {
                        const len = this.vm.heap.getArrayLength(ptr);
                        const keys: string[] = ['length'];
                        for (let i = 0; i < len; i++) { keys.push(String(i)); }
                        return keys;
                    },
                    getOwnPropertyDescriptor: (target, prop) => {
                        if (prop === 'length') { return { enumerable: false, configurable: false, writable: true }; }
                        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
                            const index = Number(prop);
                            if (index >= 0 && index < this.vm.heap.getArrayLength(ptr)) {
                                return { enumerable: true, configurable: true, writable: true };
                            }
                        }
                        return undefined;
                    }
                });
            }
        }
        return this.wrapClosureForNative(arg, targetFrameCount);
    }

    public wrapClosureForNative(arg: any, targetFrameCount: number): any {
        if (arg && typeof arg === 'object' && arg.type === 'closure') {
            return (...callbackArgs: any[]) => {
                if (arg.func.isAsync) {
                    const childVm = this.vm.createChildVM();
                    return childVm.closureHandler.executeAsyncClosure(arg, callbackArgs);
                }
                const initialFrameCount = this.vm.fp + 1;
                const currentCalleeIndex = this.vm.sp;
                this.vm.stack[this.vm.sp++] = arg;
                for (let i = 0; i < callbackArgs.length; i++) this.vm.stack[this.vm.sp++] = callbackArgs[i];
                const newEnv = new Environment(arg.env);
                newEnv.variables[0] = arg;
                for (let i = 0; i < arg.func.arity; i++) newEnv.variables[i + 1] = callbackArgs[i];
                if (arg.func.hasRest) newEnv.variables[arg.func.arity + 1] = callbackArgs.slice(arg.func.arity);
                this.vm.fp++;
                if (this.vm.frames[this.vm.fp]) {
                    const f = this.vm.frames[this.vm.fp];
                    f.closure = arg; f.env = newEnv; f.basePointer = currentCalleeIndex; f.isConstructorCall = false; f.constructedInstance = undefined; f.catchHandlers.length = 0; f.ip = 0;
                } else {
                    this.vm.frames[this.vm.fp] = new CallFrame(arg, newEnv, currentCalleeIndex);
                }
                this.vm.run(initialFrameCount);
                return this.vm.stack[--this.vm.sp];
            };
        }
        return arg;
    }
}