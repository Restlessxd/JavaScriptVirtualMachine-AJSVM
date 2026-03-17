import { Opcode } from '../types.js';
import { CustomHeap, HeapType, makePointer, isPointer, getPointerValue } from './heap.js';
import { Environment } from './environment.js';
import { SuspendException, YieldException } from './exceptions.js';
import { CallFrame } from './callframe.js';
import { ExceptionHandler } from './exception-handler.js';
import { InteropHandler } from './interop-handler.js';
import { ClosureHandler } from './closure-handler.js';
export { Environment };
export class VM {
    stack = new Array(65536);
    frames = new Array(10000);
    constants = [];
    heap;
    globalEnv;
    reverseOpcodeMap = new Array(256).fill(0);
    fp = -1;
    sp = 0;
    MAX_CALL_STACK_SIZE = 10000;
    bytecode;
    pushUndefOpcode = 0;
    returnOpcode = 0;
    exceptionHandler;
    interopHandler;
    closureHandler;
    constructor(bytecode) {
        this.bytecode = bytecode;
        const codeStartOffset = this.parseBytecode();
        this.exceptionHandler = new ExceptionHandler(this);
        this.interopHandler = new InteropHandler(this);
        this.closureHandler = new ClosureHandler(this);
        const mainChunk = this.bytecode.subarray(codeStartOffset);
        const mainWordcode = this.decodeChunk(mainChunk);
        /**
         * главная функция
         * TODO: Реализация блокировки выполнения функции при изменении вм
         */
        //@ts-ignore
        const mainFn = {
            type: 'function',
            name: 'script',
            arity: 0,
            hasRest: false,
            bytecode: mainChunk,
            wordcode: mainWordcode
        };
        this.globalEnv = new Environment();
        this.globalEnv.isCaptured = true;
        const mainClosure = {
            type: 'closure',
            func: mainFn,
            env: this.globalEnv
        };
        this.stack[0] = mainClosure;
        this.sp = 1;
        this.globalEnv.variables[0] = mainClosure;
        this.heap = new CustomHeap(1024 * 1024 * 10, () => this.collectRoots());
        this.frames[0] = new CallFrame(mainClosure, this.globalEnv, 0);
        this.frames[0].ip = 0;
        this.fp = 0;
    }
    decodeChunk(chunk) {
        const wordcode = new Int32Array(chunk.length);
        let ip = 0;
        while (ip < chunk.length) {
            const opcode = this.reverseOpcodeMap[chunk[ip]];
            wordcode[ip] = opcode;
            ip++;
            switch (opcode) {
                case Opcode.PUSH_INT8:
                case Opcode.CALL:
                case Opcode.NEW:
                case Opcode.SUPER_CONSTRUCTOR:
                case Opcode.CONSOLE_LOG:
                case Opcode.CONSOLE_WARN:
                case Opcode.CONSOLE_ERROR:
                    wordcode[ip] = chunk[ip];
                    if (opcode === Opcode.PUSH_INT8 && wordcode[ip] > 127)
                        wordcode[ip] -= 256;
                    ip++;
                    break;
                case Opcode.PUSH_CONST:
                case Opcode.STORE_LOCAL:
                case Opcode.LOAD_LOCAL:
                case Opcode.MAKE_ARRAY:
                case Opcode.MAKE_OBJECT:
                case Opcode.REST_OBJECT:
                case Opcode.LOAD_GLOBAL:
                case Opcode.TYPEOF_GLOBAL:
                case Opcode.STORE_GLOBAL:
                case Opcode.DELETE_GLOBAL:
                case Opcode.MAKE_CLOSURE:
                case Opcode.INVOKE_SPREAD:
                    wordcode[ip] = (chunk[ip] << 8) | chunk[ip + 1];
                    ip += 2;
                    break;
                case Opcode.JUMP:
                case Opcode.JUMP_IF_FALSE:
                case Opcode.JUMP_IF_TRUE:
                case Opcode.JUMP_IF_NOT_NULLISH:
                case Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT:
                case Opcode.SETUP_CATCH: {
                    let offset = (chunk[ip] << 8) | chunk[ip + 1];
                    if (offset >= 0x8000)
                        offset -= 0x10000;
                    wordcode[ip] = offset;
                    ip += 2;
                    break;
                }
                case Opcode.STORE_VAR:
                case Opcode.LOAD_VAR:
                    wordcode[ip] = chunk[ip];
                    ip++;
                    wordcode[ip] = (chunk[ip] << 8) | chunk[ip + 1];
                    ip += 2;
                    break;
                case Opcode.INVOKE:
                case Opcode.INVOKE_SUPER:
                    wordcode[ip] = (chunk[ip] << 8) | chunk[ip + 1];
                    ip += 2;
                    wordcode[ip] = chunk[ip];
                    ip++;
                    break;
                case Opcode.GET_NAMED_PROPERTY:
                case Opcode.SET_NAMED_PROPERTY:
                    wordcode[ip] = (chunk[ip] << 8) | chunk[ip + 1];
                    ip += 2;
                    wordcode[ip] = (chunk[ip] << 8) | chunk[ip + 1];
                    ip += 2;
                    break;
            }
        }
        return wordcode;
    }
    parseBytecode() {
        const view = new DataView(this.bytecode.buffer, this.bytecode.byteOffset, this.bytecode.byteLength);
        const padLen = view.getUint16(0, false);
        let offset = 2 + padLen;
        const hashOffset = offset;
        // --- ВАЛИДАЦИЯ ЦЕЛОСТНОСТИ БАЙТ-КОДА ---
        const expectedHash = view.getUint32(offset, false);
        offset += 4; // хэш скипается
        let hash = 2166136261;
        for (let i = hashOffset + 4; i < this.bytecode.length; i++) {
            hash ^= this.bytecode[i];
            hash = Math.imul(hash, 16777619);
        }
        if ((hash >>> 0) !== expectedHash) {
            //убирается при компиляции с production: true
            throw new Error("VM Panic: Bytecode integrity check failed! Tampering detected.");
        }
        offset += 2; // версия скипается
        // заголовок
        const constantsCount = view.getUint16(offset, false);
        offset += 2;
        // динамические теги типов
        const tagNum = view.getUint8(offset++);
        const tagStr = view.getUint8(offset++);
        const tagFunc = view.getUint8(offset++);
        const tagBigInt = view.getUint8(offset++);
        // парс перемешанных опкодов
        for (let i = 0; i < 256; i++) {
            const shuffled = view.getUint8(offset++);
            this.reverseOpcodeMap[shuffled] = i;
            if (i === Opcode.PUSH_UNDEFINED)
                this.pushUndefOpcode = shuffled;
            if (i === Opcode.RETURN)
                this.returnOpcode = shuffled;
        }
        // пул констант
        for (let i = 0; i < constantsCount; i++) {
            const type = view.getUint8(offset);
            offset += 1;
            if (type === tagNum) {
                this.constants.push(view.getFloat64(offset, false));
                offset += 8;
            }
            else if (type === tagStr) {
                const stringLength = view.getUint16(offset, false);
                offset += 2;
                const strXorKey = view.getUint8(offset++);
                const stringBytes = this.bytecode.subarray(offset, offset + stringLength).slice();
                // строка шифруется хор-ом, нижние префиксы используются для того, что бы терсер их минифицировал
                this.constants.push({ _isEnc: true, _encBytes: stringBytes, _encKey: strXorKey });
                offset += stringLength;
            }
            else if (type === tagBigInt) {
                const bigintLength = view.getUint16(offset, false);
                offset += 2;
                const biXorKey = view.getUint8(offset++);
                const bigintBytes = this.bytecode.subarray(offset, offset + bigintLength).slice();
                for (let j = 0; j < bigintLength; j++)
                    bigintBytes[j] ^= biXorKey;
                this.constants.push(BigInt(new TextDecoder().decode(bigintBytes)));
                offset += bigintLength;
            }
            else if (type === tagFunc) {
                const arity = view.getUint8(offset++);
                const flags = view.getUint8(offset++);
                const hasRest = (flags & 1) === 1;
                const isAsync = (flags & 2) === 2;
                const isGenerator = (flags & 4) === 4;
                const nameLength = view.getUint16(offset, false);
                offset += 2;
                const fnXorKey = view.getUint8(offset++);
                const nameBytes = this.bytecode.subarray(offset, offset + nameLength).slice();
                for (let j = 0; j < nameLength; j++)
                    nameBytes[j] ^= fnXorKey;
                const name = new TextDecoder().decode(nameBytes);
                offset += nameLength;
                const chunkLength = view.getUint32(offset, false);
                offset += 4;
                const chunk = this.bytecode.subarray(offset, offset + chunkLength);
                offset += chunkLength;
                const wordcode = this.decodeChunk(chunk);
                this.constants.push({
                    type: 'function',
                    name,
                    arity,
                    hasRest,
                    isAsync,
                    isGenerator,
                    bytecode: chunk,
                    wordcode
                });
            }
            else {
                throw new Error(`error: Unsupported constant type ${type} while parsing at offset ${offset - 1}.`);
            }
        }
        return offset;
    }
    collectRoots() {
        const roots = [];
        for (let i = 0; i < this.sp; i++)
            roots.push(this.stack[i]);
        for (let i = 0; i < this.globalEnv.variables.length; i++)
            roots.push(this.globalEnv.variables[i]);
        for (let i = 0; i <= this.fp; i++) {
            const env = this.frames[i].env;
            if (env)
                for (let j = 0; j < env.variables.length; j++)
                    roots.push(env.variables[j]);
        }
        return roots;
    }
    run(targetFrameCount = 0) {
        // Локальное кэширование состояния (ISC).
        let frames = this.frames;
        let stack = this.stack;
        let frame = this.frames[this.fp];
        let wordcode = frame.closure.func.wordcode;
        let ip = frame.ip;
        let env = frame.env;
        let sp = this.sp;
        const constants = this.constants;
        const heap = this.heap;
        // расшифровка строк
        const resolveConst = (index) => {
            const c = constants[index];
            if (c && c._isEnc) {
                const b = c._encBytes;
                const d = new Uint8Array(b.length);
                const k = c._encKey;
                for (let i = 0; i < b.length; i++)
                    d[i] = b[i] ^ k;
                return new TextDecoder().decode(d);
            }
            return c;
        };
        /**
         * Состояния save,restore
         */
        const saveState = () => {
            frame.ip = ip;
            this.sp = sp;
        };
        const restoreState = () => {
            frame = frames[this.fp];
            wordcode = frame.closure.func.wordcode;
            ip = frame.ip;
            env = frame.env;
            sp = this.sp;
        };
        /**
         * Состояния save,restore END
         */
        // главный цикл работы
        while (this.fp >= targetFrameCount) {
            try {
                while (this.fp >= targetFrameCount) {
                    const opcode = wordcode[ip++];
                    switch (opcode) {
                        case Opcode.HALT:
                            saveState();
                            return;
                        case Opcode.SETUP_CATCH: {
                            let offset = wordcode[ip];
                            ip += 2;
                            frame.catchHandlers.push({
                                catchIp: ip + offset,
                                stackDepth: sp
                            });
                            break;
                        }
                        case Opcode.POP_CATCH: {
                            frame.catchHandlers.pop();
                            break;
                        }
                        case Opcode.THROW: {
                            throw stack[--sp];
                            break;
                        }
                        case Opcode.GET_FOR_IN_ITERATOR: {
                            const obj = stack[--sp];
                            function* enumerate(o, h) {
                                if (typeof o === 'number' && isPointer(o)) {
                                    for (const k of h.getKeys(getPointerValue(o)))
                                        yield k;
                                }
                                else if (o != null) {
                                    for (const k in o)
                                        yield k;
                                }
                            }
                            stack[sp++] = enumerate(obj, heap);
                            break;
                        }
                        case Opcode.GET_FOR_OF_ITERATOR: {
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj) && heap.view.getUint8(getPointerValue(obj)) === HeapType.ARRAY) {
                                const ptr = getPointerValue(obj);
                                function* enumerateHeapArray(h, p) {
                                    const len = h.getArrayLength(p);
                                    for (let i = 0; i < len; i++) {
                                        yield h.getArrayElement(p, i);
                                    }
                                }
                                stack[sp++] = enumerateHeapArray(heap, ptr);
                            }
                            else if (obj != null && typeof obj[Symbol.iterator] === 'function') {
                                stack[sp++] = obj[Symbol.iterator]();
                            }
                            else {
                                throw new TypeError(`${typeof obj} is not iterable`);
                            }
                            break;
                        }
                        case Opcode.GET_ASYNC_ITERATOR: {
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj) && heap.view.getUint8(getPointerValue(obj)) === HeapType.ARRAY) {
                                const ptr = getPointerValue(obj);
                                async function* enumerateHeapArrayAsync(h, p) {
                                    const len = h.getArrayLength(p);
                                    for (let i = 0; i < len; i++) {
                                        yield h.getArrayElement(p, i);
                                    }
                                }
                                stack[sp++] = enumerateHeapArrayAsync(heap, ptr);
                            }
                            else if (obj != null && typeof obj[Symbol.asyncIterator] === 'function') {
                                stack[sp++] = obj[Symbol.asyncIterator]();
                            }
                            else if (obj != null && typeof obj[Symbol.iterator] === 'function') {
                                const syncIter = obj[Symbol.iterator]();
                                stack[sp++] = {
                                    async next() {
                                        return Promise.resolve(syncIter.next());
                                    }
                                };
                            }
                            else {
                                throw new TypeError(`${typeof obj} is not async iterable`);
                            }
                            break;
                        }
                        case Opcode.ITERATOR_NEXT: {
                            const iter = stack[--sp];
                            const res = iter.next();
                            stack[sp++] = iter;
                            stack[sp++] = res.value;
                            stack[sp++] = res.done;
                            break;
                        }
                        case Opcode.ASYNC_ITERATOR_NEXT: {
                            const iter = stack[--sp];
                            stack[sp++] = iter;
                            stack[sp++] = iter.next();
                            break;
                        }
                        case Opcode.UNPACK_ITERATOR_RESULT: {
                            const res = stack[--sp];
                            const iter = stack[--sp];
                            stack[sp++] = iter;
                            stack[sp++] = res.value;
                            stack[sp++] = res.done;
                            break;
                        }
                        case Opcode.MAKE_CLASS: {
                            const superclass = stack[--sp];
                            env.isCaptured = true;
                            const klass = {
                                type: 'closure',
                                //@ts-ignore
                                func: {
                                    type: 'function',
                                    name: 'class',
                                    arity: 0,
                                    hasRest: false,
                                    bytecode: new Uint8Array([this.pushUndefOpcode, this.returnOpcode]),
                                    wordcode: new Int32Array([Opcode.PUSH_UNDEFINED, Opcode.RETURN])
                                },
                                env: env,
                            };
                            const prototype = Object.create(superclass ? superclass.prototype : Object.prototype);
                            prototype.constructor = klass;
                            Object.defineProperty(klass, 'prototype', {
                                value: prototype,
                                writable: false
                            });
                            stack[sp++] = klass;
                            break;
                        }
                        case Opcode.DEFINE_METHOD: {
                            const methodName = stack[--sp];
                            const methodClosure = stack[--sp];
                            const klass = stack[sp - 1];
                            klass.prototype[methodName] = methodClosure;
                            break;
                        }
                        case Opcode.MAKE_CLOSURE: {
                            const constIndex = wordcode[ip];
                            ip += 2;
                            const func = constants[constIndex];
                            env.isCaptured = true;
                            const closure = {
                                type: 'closure',
                                func: func,
                                env: env
                            };
                            stack[sp++] = closure;
                            break;
                        }
                        case Opcode.PUSH_CONST: {
                            const constIndex = wordcode[ip];
                            ip += 2;
                            stack[sp++] = resolveConst(constIndex);
                            break;
                        }
                        case Opcode.STORE_VAR: {
                            const hops = wordcode[ip];
                            ip++;
                            const varIndex = wordcode[ip];
                            ip += 2;
                            let targetEnv = env;
                            for (let i = 0; i < hops; i++)
                                targetEnv = targetEnv.outer;
                            targetEnv.variables[varIndex] = stack[sp - 1];
                            break;
                        }
                        case Opcode.STORE_LOCAL: {
                            const varIndex = wordcode[ip];
                            ip += 2;
                            env.variables[varIndex] = stack[sp - 1];
                            break;
                        }
                        case Opcode.LOAD_VAR: {
                            const hops = wordcode[ip];
                            ip++;
                            const varIndex = wordcode[ip];
                            ip += 2;
                            let targetEnv = env;
                            for (let i = 0; i < hops; i++)
                                targetEnv = targetEnv.outer;
                            stack[sp++] = targetEnv.variables[varIndex];
                            break;
                        }
                        case Opcode.LOAD_LOCAL: {
                            const varIndex = wordcode[ip];
                            ip += 2;
                            stack[sp++] = env.variables[varIndex];
                            break;
                        }
                        case Opcode.PUSH_TRUE:
                            stack[sp++] = true;
                            break;
                        case Opcode.PUSH_FALSE:
                            stack[sp++] = false;
                            break;
                        case Opcode.PUSH_NULL:
                            stack[sp++] = null;
                            break;
                        case Opcode.PUSH_UNDEFINED:
                            stack[sp++] = undefined;
                            break;
                        case Opcode.PUSH_INT8: {
                            let val = wordcode[ip];
                            ip++;
                            stack[sp++] = val;
                            break;
                        }
                        case Opcode.POP: {
                            sp--;
                            break;
                        }
                        case Opcode.DUP: {
                            stack[sp] = stack[sp - 1];
                            sp++;
                            break;
                        }
                        case Opcode.DUP2: {
                            const v1 = stack[sp - 2];
                            const v2 = stack[sp - 1];
                            stack[sp++] = v1;
                            stack[sp++] = v2;
                            break;
                        }
                        case Opcode.LOAD_THIS: {
                            stack[sp++] = env.get(0, 0);
                            break;
                        }
                        case Opcode.CALL: {
                            const argCount = wordcode[ip];
                            ip++;
                            const calleeIndex = sp - 1 - argCount;
                            const callee = stack[calleeIndex];
                            if (typeof callee === 'function') {
                                const args = stack.slice(calleeIndex + 1, calleeIndex + 1 + argCount);
                                sp = calleeIndex;
                                saveState();
                                const nativeArgs = args.map(arg => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = callee(...nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                                break;
                            }
                            const closure = callee;
                            if (typeof closure !== 'object' || closure?.type !== 'closure') {
                                throw new TypeError(`Error: Can only call functions, got ${typeof closure}.`);
                            }
                            // экономлю себе пару дней жизни, нативные функции JS достают из песочницы V8
                            const func = closure.func;
                            if (!func.isAsync && !func.isGenerator) {
                                const newEnv = new Environment(closure.env);
                                newEnv.variables[0] = closure;
                                const arity = func.arity;
                                for (let i = 0; i < arity; i++) {
                                    newEnv.variables[i + 1] = i < argCount ? stack[calleeIndex + 1 + i] : undefined;
                                }
                                if (func.hasRest) {
                                    const restCount = Math.max(0, argCount - arity);
                                    const restArr = new Array(restCount);
                                    for (let i = 0; i < restCount; i++)
                                        restArr[i] = stack[calleeIndex + 1 + arity + i];
                                    newEnv.variables[arity + 1] = restArr;
                                }
                                if (this.fp >= this.MAX_CALL_STACK_SIZE - 1) {
                                    throw new RangeError("Error: Maximum call stack size exceeded");
                                }
                                frame.ip = ip;
                                this.fp++;
                                if (frames[this.fp]) {
                                    const f = frames[this.fp];
                                    f.closure = closure;
                                    f.env = newEnv;
                                    f.basePointer = calleeIndex;
                                    f.isConstructorCall = false;
                                    f.constructedInstance = undefined;
                                    f.catchHandlers.length = 0;
                                    f.ip = 0;
                                    frame = f;
                                }
                                else {
                                    frame = new CallFrame(closure, newEnv, calleeIndex, false, undefined);
                                    frames[this.fp] = frame;
                                }
                                wordcode = func.wordcode;
                                ip = 0;
                                env = newEnv;
                                break;
                            }
                            // обрабатываем генеторы и асинхронные функции правильно, но медленно
                            saveState();
                            this.closureHandler.callClosure(closure, argCount, calleeIndex);
                            restoreState();
                            break;
                        }
                        case Opcode.NEW: {
                            const argCount = wordcode[ip];
                            ip++;
                            const calleeIndex = sp - 1 - argCount;
                            const callee = stack[calleeIndex];
                            if (typeof callee === 'function') {
                                const args = stack.slice(calleeIndex + 1, calleeIndex + 1 + argCount);
                                sp = calleeIndex;
                                saveState();
                                const nativeArgs = args.map(arg => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = new callee(...nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                                break;
                            }
                            if (callee && typeof callee === 'object' && callee.type === 'closure') {
                                const instance = Object.create(callee.prototype || Object.prototype);
                                stack[calleeIndex] = instance;
                                const ctor = instance.constructor;
                                if (ctor && ctor.type === 'closure') {
                                    saveState();
                                    this.closureHandler.callClosure(ctor, argCount, calleeIndex, instance, undefined, true);
                                    restoreState();
                                }
                                else {
                                    sp = calleeIndex + 1;
                                }
                                break;
                            }
                            throw new Error(`Error: Constructor must be a native function, got ${typeof callee}.`);
                        }
                        case Opcode.INVOKE: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const argCount = wordcode[ip];
                            ip++;
                            const methodName = resolveConst(nameIndex);
                            const receiverIndex = sp - 1 - argCount;
                            const receiver = stack[receiverIndex];
                            if (receiver == null) {
                                throw new TypeError(`Cannot read properties of ${receiver} (reading '${methodName}')`);
                            }
                            let method;
                            let nativeReceiver = receiver;
                            if (typeof receiver === 'number' && isPointer(receiver)) {
                                const receiverPtr = getPointerValue(receiver);
                                const type = heap.view.getUint8(receiverPtr);
                                if (type === HeapType.ARRAY) {
                                    if (methodName === 'push') {
                                        const args = stack.slice(receiverIndex + 1, receiverIndex + 1 + argCount);
                                        sp = receiverIndex;
                                        for (const arg of args) {
                                            heap.pushArrayElement(receiverPtr, arg);
                                        }
                                        stack[sp++] = heap.getArrayLength(receiverPtr);
                                        break;
                                    }
                                }
                                else if (type === HeapType.OBJECT) {
                                    method = heap.getProperty(receiverPtr, methodName);
                                }
                                if (method === undefined) {
                                    saveState();
                                    nativeReceiver = this.interopHandler.unwrapForNative(receiver, targetFrameCount);
                                    if (nativeReceiver != null) {
                                        method = nativeReceiver[methodName];
                                    }
                                    restoreState();
                                }
                            }
                            else {
                                method = receiver[methodName];
                            }
                            if (method && method.type === 'closure') {
                                saveState();
                                this.closureHandler.callClosure(method, argCount, receiverIndex, receiver);
                                restoreState();
                            }
                            else if (typeof method === 'function') {
                                const args = stack.slice(receiverIndex + 1, receiverIndex + 1 + argCount);
                                sp = receiverIndex;
                                saveState();
                                const nativeArgs = args.map(arg => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = method.apply(nativeReceiver, nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                            }
                            else {
                                if (methodName !== 'constructor') {
                                    throw new TypeError(`${typeof receiver}.${methodName} is not a function`);
                                }
                                else {
                                    sp = receiverIndex;
                                    stack[sp++] = undefined;
                                }
                            }
                            break;
                        }
                        case Opcode.INVOKE_SPREAD: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const methodName = resolveConst(nameIndex);
                            const argsIterable = stack[--sp];
                            let vmArgs = [];
                            if (typeof argsIterable === 'number' && isPointer(argsIterable) && heap.view.getUint8(getPointerValue(argsIterable)) === HeapType.ARRAY) {
                                const iterablePtr = getPointerValue(argsIterable);
                                const len = heap.getArrayLength(iterablePtr);
                                for (let i = 0; i < len; i++) {
                                    vmArgs.push(heap.getArrayElement(iterablePtr, i));
                                }
                            }
                            else if (argsIterable != null && typeof argsIterable[Symbol.iterator] === 'function') {
                                vmArgs = Array.from(argsIterable);
                            }
                            else {
                                throw new TypeError(`Spread argument is not iterable`);
                            }
                            const argCount = vmArgs.length;
                            const receiverIndex = sp - 1;
                            const receiver = stack[receiverIndex];
                            if (receiver == null) {
                                throw new TypeError(`Cannot read properties of ${receiver} (reading '${methodName}')`);
                            }
                            let method;
                            let nativeReceiver = receiver;
                            if (typeof receiver === 'number' && isPointer(receiver)) {
                                const receiverPtr = getPointerValue(receiver);
                                const type = heap.view.getUint8(receiverPtr);
                                if (type === HeapType.ARRAY) {
                                    if (methodName === 'push') {
                                        sp = receiverIndex;
                                        for (const arg of vmArgs) {
                                            heap.pushArrayElement(receiverPtr, arg);
                                        }
                                        stack[sp++] = heap.getArrayLength(receiverPtr);
                                        break;
                                    }
                                }
                                else if (type === HeapType.OBJECT) {
                                    method = heap.getProperty(receiverPtr, methodName);
                                }
                                if (method === undefined) {
                                    saveState();
                                    nativeReceiver = this.interopHandler.unwrapForNative(receiver, targetFrameCount);
                                    if (nativeReceiver != null) {
                                        method = nativeReceiver[methodName];
                                    }
                                    restoreState();
                                }
                            }
                            else {
                                method = receiver[methodName];
                            }
                            if (method && method.type === 'closure') {
                                saveState();
                                this.closureHandler.callClosure(method, argCount, receiverIndex, receiver, vmArgs);
                                restoreState();
                            }
                            else if (typeof method === 'function') {
                                sp = receiverIndex;
                                saveState();
                                const nativeArgs = vmArgs.map((arg) => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = method.apply(nativeReceiver, nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                            }
                            else {
                                if (methodName !== 'constructor') {
                                    throw new TypeError(`${typeof receiver}.${methodName} is not a function`);
                                }
                                else {
                                    sp = receiverIndex;
                                    stack[sp++] = undefined;
                                }
                            }
                            break;
                        }
                        case Opcode.CALL_SPREAD: {
                            const argsIterable = stack[--sp];
                            const calleeIndex = sp - 1;
                            const callee = stack[calleeIndex];
                            let vmArgs = [];
                            if (typeof argsIterable === 'number' && isPointer(argsIterable) && heap.view.getUint8(getPointerValue(argsIterable)) === HeapType.ARRAY) {
                                const iterablePtr = getPointerValue(argsIterable);
                                const len = heap.getArrayLength(iterablePtr);
                                for (let i = 0; i < len; i++) {
                                    vmArgs.push(heap.getArrayElement(iterablePtr, i));
                                }
                            }
                            else if (argsIterable != null && typeof argsIterable[Symbol.iterator] === 'function') {
                                vmArgs = Array.from(argsIterable);
                            }
                            else {
                                throw new TypeError(`Spread argument is not iterable`);
                            }
                            const argCount = vmArgs.length;
                            if (typeof callee === 'function') {
                                sp = calleeIndex;
                                saveState();
                                const nativeArgs = vmArgs.map((arg) => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = callee(...nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                                break;
                            }
                            const closure = callee;
                            if (typeof closure !== 'object' || closure?.type !== 'closure') {
                                throw new TypeError(`Error: Can only call functions, got ${typeof closure}.`);
                            }
                            sp = calleeIndex; // синхронизируем указатель перед сохранением состояния
                            saveState();
                            this.closureHandler.callClosure(closure, argCount, calleeIndex, undefined, vmArgs);
                            restoreState();
                            break;
                        }
                        case Opcode.NEW_SPREAD: {
                            const argsIterable = stack[--sp];
                            const calleeIndex = sp - 1;
                            const callee = stack[calleeIndex];
                            let vmArgs = [];
                            if (typeof argsIterable === 'number' && isPointer(argsIterable) && heap.view.getUint8(getPointerValue(argsIterable)) === HeapType.ARRAY) {
                                const iterablePtr = getPointerValue(argsIterable);
                                const len = heap.getArrayLength(iterablePtr);
                                for (let i = 0; i < len; i++) {
                                    vmArgs.push(heap.getArrayElement(iterablePtr, i));
                                }
                            }
                            else if (argsIterable != null && typeof argsIterable[Symbol.iterator] === 'function') {
                                vmArgs = Array.from(argsIterable);
                            }
                            else {
                                throw new TypeError(`Spread argument is not iterable`);
                            }
                            const argCount = vmArgs.length;
                            if (typeof callee === 'function') {
                                sp = calleeIndex;
                                saveState();
                                const nativeArgs = vmArgs.map((arg) => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = new callee(...nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                                break;
                            }
                            if (callee && typeof callee === 'object' && callee.type === 'closure') {
                                const instance = Object.create(callee.prototype || Object.prototype);
                                stack[calleeIndex] = instance;
                                const ctor = instance.constructor;
                                if (ctor && ctor.type === 'closure') {
                                    saveState();
                                    this.closureHandler.callClosure(ctor, argCount, calleeIndex, instance, vmArgs, true);
                                    restoreState();
                                }
                                else {
                                    sp = calleeIndex + 1;
                                }
                                break;
                            }
                            throw new Error(`Error: Constructor must be a native function, got ${typeof callee}.`);
                        }
                        case Opcode.RETURN: {
                            let returnValue = stack[--sp];
                            const frameToClose = frames[this.fp--];
                            if (frameToClose.isConstructorCall && (returnValue == null || typeof returnValue !== 'object')) {
                                returnValue = frameToClose.constructedInstance;
                            }
                            sp = frameToClose.basePointer;
                            stack[sp++] = returnValue;
                            if (this.fp < targetFrameCount) {
                                this.sp = sp; // синхронизируем размер стека только при полном выходе из вм
                                return;
                            }
                            //по сути рестор, но в данном случае просто для сохранения скорости дублированный код
                            frame = frames[this.fp];
                            wordcode = frame.closure.func.wordcode;
                            ip = frame.ip;
                            env = frame.env;
                            break;
                        }
                        case Opcode.MAKE_ARRAY: {
                            const elementCount = wordcode[ip];
                            ip += 2;
                            const elements = stack.slice(sp - elementCount, sp);
                            sp -= elementCount;
                            const capacity = Math.max(elementCount, 10);
                            const arrayPtr = heap.allocateArray(capacity);
                            for (let i = 0; i < elementCount; i++) {
                                heap.setArrayElement(arrayPtr, i, elements[i]);
                            }
                            stack[sp++] = makePointer(arrayPtr);
                            break;
                        }
                        case Opcode.MAKE_OBJECT: {
                            const propCount = wordcode[ip];
                            ip += 2;
                            const capacity = Math.max(propCount + 5, 10);
                            const objPtr = heap.allocateObject(capacity);
                            const props = stack.slice(sp - propCount * 2, sp);
                            sp -= propCount * 2;
                            for (let i = 0; i < propCount * 2; i += 2) {
                                heap.setProperty(objPtr, String(props[i]), props[i + 1]);
                            }
                            stack[sp++] = makePointer(objPtr);
                            break;
                        }
                        case Opcode.ARRAY_APPEND: {
                            const value = stack[--sp];
                            let array = stack[--sp];
                            if (typeof array === 'number' && isPointer(array) && heap.view.getUint8(getPointerValue(array)) === HeapType.ARRAY) {
                                const arrayPtr = getPointerValue(array);
                                heap.pushArrayElement(arrayPtr, value);
                            }
                            else {
                                array.push(value);
                            }
                            stack[sp++] = array;
                            break;
                        }
                        case Opcode.ARRAY_APPEND_SPREAD: {
                            const iterable = stack[--sp];
                            let array = stack[--sp];
                            if (typeof iterable === 'number' && isPointer(iterable) && heap.view.getUint8(getPointerValue(iterable)) === HeapType.ARRAY) {
                                const iterablePtr = getPointerValue(iterable);
                                const len = heap.getArrayLength(iterablePtr);
                                if (typeof array === 'number' && isPointer(array) && heap.view.getUint8(getPointerValue(array)) === HeapType.ARRAY) {
                                    const arrayPtr = getPointerValue(array);
                                    for (let i = 0; i < len; i++) {
                                        const item = heap.getArrayElement(iterablePtr, i);
                                        heap.pushArrayElement(arrayPtr, item);
                                    }
                                }
                                else {
                                    for (let i = 0; i < len; i++) {
                                        const item = heap.getArrayElement(iterablePtr, i);
                                        array.push(item);
                                    }
                                }
                            }
                            else if (iterable != null && typeof iterable[Symbol.iterator] === 'function') {
                                if (typeof array === 'number' && isPointer(array) && heap.view.getUint8(getPointerValue(array)) === HeapType.ARRAY) {
                                    const arrayPtr = getPointerValue(array);
                                    for (const item of iterable) {
                                        heap.pushArrayElement(arrayPtr, item);
                                    }
                                }
                                else {
                                    for (const item of iterable) {
                                        array.push(item);
                                    }
                                }
                            }
                            else {
                                throw new TypeError(`${typeof iterable} is not iterable`);
                            }
                            stack[sp++] = array;
                            break;
                        }
                        case Opcode.OBJECT_APPEND: {
                            const value = stack[--sp];
                            const key = stack[--sp];
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj)) {
                                const objPtr = getPointerValue(obj);
                                heap.setProperty(objPtr, String(key), value);
                            }
                            else {
                                obj[key] = value;
                            }
                            stack[sp++] = obj;
                            break;
                        }
                        case Opcode.OBJECT_APPEND_SPREAD: {
                            const source = stack[--sp];
                            const obj = stack[--sp];
                            if (source != null) {
                                if (typeof source === 'number' && isPointer(source)) {
                                    const sourcePtr = getPointerValue(source);
                                    const keys = heap.getKeys(sourcePtr);
                                    if (typeof obj === 'number' && isPointer(obj)) {
                                        const objPtr = getPointerValue(obj);
                                        for (const k of keys) {
                                            heap.setProperty(objPtr, k, heap.getProperty(sourcePtr, k));
                                        }
                                    }
                                    else {
                                        for (const k of keys) {
                                            obj[k] = heap.getProperty(sourcePtr, k);
                                        }
                                    }
                                }
                                else {
                                    if (typeof obj === 'number' && isPointer(obj)) {
                                        const objPtr = getPointerValue(obj);
                                        for (const k of Object.keys(source)) {
                                            heap.setProperty(objPtr, k, source[k]);
                                        }
                                    }
                                    else {
                                        Object.assign(obj, source);
                                    }
                                }
                            }
                            stack[sp++] = obj;
                            break;
                        }
                        case Opcode.REST_ARRAY: {
                            const startIndex = stack[--sp];
                            const array = stack[--sp];
                            if (typeof array === 'number' && isPointer(array) && heap.view.getUint8(getPointerValue(array)) === HeapType.ARRAY) {
                                const arrayPtr = getPointerValue(array);
                                const len = heap.getArrayLength(arrayPtr);
                                const restLen = Math.max(0, len - startIndex);
                                const restPtr = heap.allocateArray(restLen);
                                for (let i = 0; i < restLen; i++) {
                                    const val = heap.getArrayElement(arrayPtr, startIndex + i);
                                    heap.setArrayElement(restPtr, i, val);
                                }
                                stack[sp++] = makePointer(restPtr);
                            }
                            else if (array != null && typeof array[Symbol.iterator] === 'function') {
                                const arr = Array.isArray(array) || typeof array === 'string' ? array : Array.from(array);
                                stack[sp++] = Array.prototype.slice.call(arr, startIndex);
                            }
                            else {
                                throw new TypeError(`${typeof array} is not iterable`);
                            }
                            break;
                        }
                        case Opcode.REST_OBJECT: {
                            const excludeCount = wordcode[ip];
                            ip += 2;
                            const excludeKeys = stack.slice(sp - excludeCount, sp);
                            sp -= excludeCount;
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj)) {
                                const objPtr = getPointerValue(obj);
                                const keys = heap.getKeys(objPtr).filter(k => !excludeKeys.includes(k));
                                const capacity = Math.max(keys.length + 5, 10);
                                const restPtr = heap.allocateObject(capacity);
                                for (const key of keys) {
                                    heap.setProperty(restPtr, key, heap.getProperty(objPtr, key));
                                }
                                stack[sp++] = makePointer(restPtr);
                            }
                            else {
                                const restObj = {};
                                if (obj != null) {
                                    for (const key in obj) {
                                        if (Object.hasOwn(obj, key) && !excludeKeys.includes(key)) {
                                            restObj[key] = obj[key];
                                        }
                                    }
                                }
                                stack[sp++] = restObj;
                            }
                            break;
                        }
                        case Opcode.GET_PROPERTY: {
                            const key = stack[--sp];
                            const obj = stack[--sp];
                            let value;
                            if (typeof obj === 'number' && isPointer(obj)) {
                                const objPtr = getPointerValue(obj);
                                const type = heap.view.getUint8(objPtr);
                                if (type === HeapType.OBJECT) {
                                    value = heap.getProperty(objPtr, String(key));
                                }
                                else if (type === HeapType.ARRAY) {
                                    if (key === 'length')
                                        value = heap.getArrayLength(objPtr);
                                    else if (typeof key === 'number' && key % 1 === 0)
                                        value = heap.getArrayElement(objPtr, key);
                                    else
                                        value = undefined;
                                }
                            }
                            else {
                                value = obj[key];
                                if (typeof value === 'function')
                                    value = value.bind(obj);
                            }
                            stack[sp++] = value;
                            break;
                        }
                        case Opcode.GET_NAMED_PROPERTY: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const cacheIndex = wordcode[ip];
                            ip += 2;
                            const key = resolveConst(nameIndex);
                            const obj = stack[--sp];
                            let value;
                            if (typeof obj === 'number' && isPointer(obj)) {
                                const objPtr = getPointerValue(obj);
                                const type = heap.view.getUint8(objPtr);
                                if (type === HeapType.OBJECT) {
                                    const res = heap.getPropertyCached(objPtr, key, cacheIndex);
                                    value = res.value;
                                    if (res.index !== cacheIndex && res.index !== 0xFFFF) {
                                        wordcode[ip - 2] = res.index;
                                    }
                                }
                                else if (type === HeapType.ARRAY) {
                                    if (key === 'length')
                                        value = heap.getArrayLength(objPtr);
                                    else
                                        value = undefined;
                                }
                            }
                            else {
                                value = obj[key];
                                if (typeof value === 'function')
                                    value = value.bind(obj);
                            }
                            stack[sp++] = value;
                            break;
                        }
                        case Opcode.SET_NAMED_PROPERTY: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const cacheIndex = wordcode[ip];
                            ip += 2;
                            const key = resolveConst(nameIndex);
                            const value = stack[--sp];
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj)) {
                                const objPtr = getPointerValue(obj);
                                const type = heap.view.getUint8(objPtr);
                                if (type === HeapType.OBJECT) {
                                    const newIndex = heap.setPropertyCached(objPtr, key, value, cacheIndex);
                                    if (newIndex !== cacheIndex && newIndex !== 0xFFFF) {
                                        wordcode[ip - 2] = newIndex;
                                    }
                                }
                            }
                            else {
                                obj[key] = value;
                            }
                            stack[sp++] = value;
                            break;
                        }
                        case Opcode.SET_PROPERTY: {
                            const value = stack[--sp];
                            const key = stack[--sp];
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj)) {
                                const objPtr = getPointerValue(obj);
                                const type = heap.view.getUint8(objPtr);
                                if (type === HeapType.OBJECT) {
                                    heap.setProperty(objPtr, String(key), value);
                                }
                                else if (type === HeapType.ARRAY) {
                                    if (typeof key === 'number' && key % 1 === 0)
                                        heap.setArrayElement(objPtr, key, value);
                                }
                            }
                            else {
                                obj[key] = value;
                            }
                            stack[sp++] = value;
                            break;
                        }
                        case Opcode.LOAD_GLOBAL: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const name = resolveConst(nameIndex);
                            if (name in globalThis) {
                                stack[sp++] = globalThis[name];
                            }
                            else {
                                throw new ReferenceError(`${name} is not defined`);
                            }
                            break;
                        }
                        case Opcode.STORE_GLOBAL: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const name = resolveConst(nameIndex);
                            globalThis[name] = stack[sp - 1];
                            break;
                        }
                        case Opcode.ADD: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left + right;
                            break;
                        }
                        case Opcode.SUB: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left - right;
                            break;
                        }
                        case Opcode.MUL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left * right;
                            break;
                        }
                        case Opcode.DIV: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left / right;
                            break;
                        }
                        case Opcode.MOD: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left % right;
                            break;
                        }
                        case Opcode.EXP: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left ** right;
                            break;
                        }
                        case Opcode.BITWISE_AND: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left & right;
                            break;
                        }
                        case Opcode.BITWISE_OR: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left | right;
                            break;
                        }
                        case Opcode.BITWISE_XOR: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left ^ right;
                            break;
                        }
                        case Opcode.LSHIFT: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left << right;
                            break;
                        }
                        case Opcode.RSHIFT: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left >> right;
                            break;
                        }
                        case Opcode.ZRSHIFT: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left >>> right;
                            break;
                        }
                        case Opcode.EQUAL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left == right;
                            break;
                        }
                        case Opcode.NOT_EQUAL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left != right;
                            break;
                        }
                        case Opcode.STRICT_EQUAL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left === right;
                            break;
                        }
                        case Opcode.STRICT_NOT_EQUAL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left !== right;
                            break;
                        }
                        case Opcode.GREATER_THAN: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left > right;
                            break;
                        }
                        case Opcode.LESS_THAN: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left < right;
                            break;
                        }
                        case Opcode.GREATER_EQUAL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left >= right;
                            break;
                        }
                        case Opcode.LESS_EQUAL: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            stack[sp++] = left <= right;
                            break;
                        }
                        case Opcode.NEGATE:
                            stack[sp - 1] = -stack[sp - 1];
                            break;
                        case Opcode.NOT:
                            stack[sp - 1] = !stack[sp - 1];
                            break;
                        case Opcode.BITWISE_NOT:
                            stack[sp - 1] = ~stack[sp - 1];
                            break;
                        case Opcode.VOID:
                            stack[sp - 1] = undefined;
                            break;
                        case Opcode.UNARY_PLUS:
                            stack[sp - 1] = +stack[sp - 1];
                            break;
                        case Opcode.IN: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            if (typeof right === 'number' && isPointer(right)) {
                                const rightPtr = getPointerValue(right);
                                const type = heap.view.getUint8(rightPtr);
                                if (type === HeapType.OBJECT) {
                                    const keys = heap.getKeys(rightPtr);
                                    stack[sp++] = keys.includes(String(left));
                                }
                                else if (type === HeapType.ARRAY) {
                                    const index = Number(left);
                                    if (Number.isInteger(index)) {
                                        stack[sp++] = index >= 0 && index < heap.getArrayLength(rightPtr);
                                    }
                                    else {
                                        stack[sp++] = false;
                                    }
                                }
                            }
                            else {
                                stack[sp++] = left in right;
                            }
                            break;
                        }
                        case Opcode.INSTANCEOF: {
                            const right = stack[--sp];
                            const left = stack[--sp];
                            if (typeof left === 'number' && isPointer(left)) {
                                const leftPtr = getPointerValue(left);
                                const type = heap.view.getUint8(leftPtr);
                                if (type === HeapType.ARRAY) {
                                    stack[sp++] = (right === Array || right === Object);
                                }
                                else if (type === HeapType.OBJECT) {
                                    stack[sp++] = (right === Object);
                                }
                            }
                            else {
                                stack[sp++] = left instanceof right;
                            }
                            break;
                        }
                        case Opcode.TYPEOF: {
                            const value = stack[sp - 1];
                            let res = typeof value;
                            if (res === 'number' && isPointer(value))
                                res = "object";
                            else if (value && typeof value === 'object' && value.type === 'closure')
                                res = "function";
                            stack[sp - 1] = res;
                            break;
                        }
                        case Opcode.AWAIT: {
                            const value = stack[--sp];
                            saveState();
                            throw new SuspendException(Promise.resolve(value));
                        }
                        case Opcode.YIELD: {
                            const value = stack[--sp];
                            saveState();
                            throw new YieldException(value);
                        }
                        case Opcode.DELETE_PROPERTY: {
                            const key = stack[--sp];
                            const obj = stack[--sp];
                            if (typeof obj === 'number' && isPointer(obj)) {
                                stack[sp++] = heap.deleteProperty(getPointerValue(obj), String(key));
                            }
                            else {
                                stack[sp++] = delete obj[key];
                            }
                            break;
                        }
                        case Opcode.DELETE_GLOBAL: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const name = resolveConst(nameIndex);
                            stack[sp++] = delete globalThis[name];
                            break;
                        }
                        case Opcode.SUPER_CONSTRUCTOR: {
                            const argCount = wordcode[ip];
                            ip++;
                            const receiver = stack[--sp];
                            const superclass = stack[--sp];
                            const args = stack.slice(sp - argCount, sp);
                            sp -= argCount;
                            if (typeof superclass === 'function') {
                                saveState();
                                const nativeArgs = args.map(arg => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                superclass.apply(receiver, nativeArgs);
                                restoreState();
                                stack[sp++] = receiver;
                            }
                            else if (superclass && superclass.type === 'closure') { // класс виртуальной машины
                                const basePointer = sp;
                                let ctor = superclass;
                                if (superclass.prototype && superclass.prototype.constructor && superclass.prototype.constructor.type === 'closure') {
                                    ctor = superclass.prototype.constructor;
                                }
                                stack[sp++] = ctor;
                                for (let i = 0; i < args.length; i++)
                                    stack[sp++] = args[i];
                                saveState();
                                this.closureHandler.callClosure(ctor, argCount, basePointer, receiver, undefined, true);
                                restoreState();
                            }
                            else {
                                throw new TypeError("Super constructor may only be called on a class or a native constructor.");
                            }
                            break;
                        }
                        case Opcode.INVOKE_SUPER: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const argCount = wordcode[ip];
                            ip++;
                            const methodName = resolveConst(nameIndex);
                            const superclass = stack[--sp];
                            const args = stack.slice(sp - argCount, sp);
                            sp -= argCount;
                            const receiver = stack[--sp];
                            let prototype;
                            if (typeof superclass === 'function') {
                                prototype = superclass.prototype;
                            }
                            else if (superclass.type === 'closure') { // класс виртуальной машины
                                prototype = superclass.prototype;
                            }
                            else {
                                throw new TypeError("Superclass is not a constructor");
                            }
                            const method = prototype[methodName];
                            if (method && method.type === 'closure') {
                                const basePointer = sp;
                                stack[sp++] = method;
                                for (let i = 0; i < args.length; i++)
                                    stack[sp++] = args[i];
                                saveState();
                                this.closureHandler.callClosure(method, argCount, basePointer, receiver);
                                restoreState();
                            }
                            else if (typeof method === 'function') {
                                saveState();
                                const nativeArgs = args.map(arg => this.interopHandler.unwrapForNative(arg, targetFrameCount));
                                const result = method.apply(receiver, nativeArgs);
                                restoreState();
                                stack[sp++] = result;
                            }
                            else {
                                throw new TypeError(`${methodName} is not a function`);
                            }
                            break;
                        }
                        case Opcode.JUMP_IF_FALSE: {
                            let offset = wordcode[ip];
                            ip += 2;
                            if (!stack[--sp])
                                ip += offset;
                            break;
                        }
                        case Opcode.JUMP_IF_TRUE: {
                            let offset = wordcode[ip];
                            ip += 2;
                            if (stack[--sp])
                                ip += offset;
                            break;
                        }
                        case Opcode.JUMP_IF_NOT_NULLISH: {
                            let offset = wordcode[ip];
                            ip += 2;
                            const condition = stack[--sp];
                            if (condition !== null && condition !== undefined)
                                ip += offset;
                            break;
                        }
                        case Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT: {
                            let offset = wordcode[ip];
                            ip += 2;
                            const value = stack[sp - 1];
                            if (value === null || value === undefined) {
                                stack[sp - 1] = undefined;
                                ip += offset;
                            }
                            break;
                        }
                        case Opcode.JUMP: {
                            let offset = wordcode[ip];
                            ip += 2;
                            ip += offset;
                            break;
                        }
                        case Opcode.TYPEOF_GLOBAL: {
                            const nameIndex = wordcode[ip];
                            ip += 2;
                            const name = resolveConst(nameIndex);
                            const globalObj = globalThis[name];
                            let res = globalObj !== undefined ? typeof globalObj : "undefined";
                            if (res === 'number' && isPointer(globalObj))
                                res = "object";
                            else if (globalObj && typeof globalObj === 'object' && globalObj.type === 'closure')
                                res = "function";
                            stack[sp++] = res;
                            break;
                        }
                        default:
                            throw new Error(`error: Unknown opcode 0x${opcode.toString(16)} at ip ${frame.ip - 1}`);
                    }
                }
                saveState();
            }
            catch (e) {
                if (e instanceof SuspendException || e instanceof YieldException) {
                    saveState();
                    throw e;
                }
                saveState();
                if (!this.exceptionHandler.handleException(e, targetFrameCount))
                    throw e;
                restoreState();
            }
        }
    }
    createChildVM() {
        const child = Object.create(VM.prototype);
        child.stack = new Array(65536);
        child.frames = new Array(10000);
        child.sp = 0;
        child.fp = -1;
        child.bytecode = this.bytecode;
        child.constants = this.constants;
        child.globalEnv = this.globalEnv;
        child.heap = this.heap; // хеп берем из основной вм
        child.reverseOpcodeMap = this.reverseOpcodeMap; // таблица опкодов
        child.pushUndefOpcode = this.pushUndefOpcode;
        child.returnOpcode = this.returnOpcode;
        child.exceptionHandler = new ExceptionHandler(child);
        child.interopHandler = new InteropHandler(child);
        child.closureHandler = new ClosureHandler(child);
        return child;
    }
    /**
     * @deprecated
     * TODO: Переделать метод для рекурсивного чтения всех значений
     */
    getVariables() {
        return this.globalEnv.variables;
    }
}
