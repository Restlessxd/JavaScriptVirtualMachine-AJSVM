export var HeapType;
(function (HeapType) {
    HeapType[HeapType["STRING"] = 1] = "STRING";
    HeapType[HeapType["OBJECT"] = 2] = "OBJECT";
    HeapType[HeapType["ARRAY"] = 3] = "ARRAY";
    HeapType[HeapType["CLOSURE"] = 4] = "CLOSURE";
    HeapType[HeapType["ARRAY_DATA"] = 6] = "ARRAY_DATA";
})(HeapType || (HeapType = {}));
export const float64Array = new Float64Array(1);
export const bigUint64Array = new BigUint64Array(float64Array.buffer);
export const PTR_TAG = 0x7ffa000000000000n;
export const PTR_MASK = 0xffffffffn;
export function makePointer(ptr) {
    bigUint64Array[0] = PTR_TAG | BigInt(ptr >>> 0);
    return float64Array[0];
}
export function isPointer(val) {
    if (typeof val !== 'number')
        return false;
    float64Array[0] = val;
    return (bigUint64Array[0] & ~PTR_MASK) === PTR_TAG;
}
export function getPointerValue(val) {
    float64Array[0] = val;
    return Number(bigUint64Array[0] & PTR_MASK);
}
export var ValueTag;
(function (ValueTag) {
    ValueTag[ValueTag["NUMBER"] = 0] = "NUMBER";
    ValueTag[ValueTag["BOOLEAN"] = 1] = "BOOLEAN";
    ValueTag[ValueTag["NULL"] = 2] = "NULL";
    ValueTag[ValueTag["UNDEFINED"] = 3] = "UNDEFINED";
    ValueTag[ValueTag["PTR"] = 4] = "PTR";
    ValueTag[ValueTag["EXTERNAL"] = 5] = "EXTERNAL"; // Для замыканий и нативных жс-объектов
})(ValueTag || (ValueTag = {}));
export class CustomHeap {
    buffer;
    view;
    heapTop = 0;
    freeList = [];
    // таблца для хранения внешних ссылок и любых обьектов которые нельзя скопировать вроде DOM
    externalRefs = [];
    freeExternalRefs = [];
    aliveExternals = new Set();
    getRoots;
    pinnedRoots = [];
    constructor(sizeInBytes = 1024 * 1024 * 10, getRoots = () => []) {
        this.buffer = new ArrayBuffer(sizeInBytes);
        this.view = new DataView(this.buffer);
        this.getRoots = getRoots;
    }
    allocate(size, type) {
        const headerSize = 6; // 1 (type) + 1 (gc mark) + 4 (size)
        const totalSize = headerSize + size;
        for (let i = 0; i < this.freeList.length; i++) {
            const block = this.freeList[i];
            if (block.size >= totalSize) {
                const ptr = block.ptr;
                this.freeList.splice(i, 1);
                this.view.setUint8(ptr, type);
                this.view.setUint8(ptr + 1, 0);
                return ptr;
            }
        }
        if (this.heapTop + totalSize > this.buffer.byteLength) {
            this.collectGarbage();
            return this.allocate(size, type);
        }
        const ptr = this.heapTop;
        this.view.setUint8(ptr, type); // тип
        this.view.setUint8(ptr + 1, 0); // gc mark bit (0 - не помечен)
        this.view.setUint32(ptr + 2, totalSize, false); // размер блока
        this.heapTop += totalSize;
        return ptr;
    }
    allocateObject(capacity) {
        // структура объекта:
        // header (6 байт) + propCount (2 байта) + capacity (2 байта)
        // далее массив свойств, каждое свойство: keyPtr (4 байта) + valueTag (1 байт) + valueData (8 байт)
        const payloadSize = 4 + capacity * 13;
        const ptr = this.allocate(payloadSize, HeapType.OBJECT);
        this.view.setUint16(ptr + 6, 0, false); // текущее количество свойств
        this.view.setUint16(ptr + 8, capacity, false); // вместимость
        return ptr;
    }
    getPropertyCached(objPtr, keyStr, cachedIndex) {
        if (this.view.getUint8(objPtr) !== HeapType.OBJECT)
            throw new Error("Heap Error: Not an object");
        const count = this.view.getUint16(objPtr + 6, false);
        // проверяем закешированный индекс
        if (cachedIndex < count) {
            const offset = objPtr + 10 + cachedIndex * 13;
            const currentKeyPtr = this.view.getUint32(offset, false);
            if (this.readString(currentKeyPtr) === keyStr) {
                return { value: this.readTaggedValue(offset + 4), index: cachedIndex };
            }
        }
        const result = this.getPropertyWithIndex(objPtr, keyStr, count);
        return result;
    }
    setProperty(objPtr, keyStr, value) {
        if (this.view.getUint8(objPtr) !== HeapType.OBJECT)
            throw new Error("Heap Error: Not an object");
        let count = this.view.getUint16(objPtr + 6, false);
        const capacity = this.view.getUint16(objPtr + 8, false);
        let offset = objPtr + 10;
        for (let i = 0; i < count; i++) {
            const currentKeyPtr = this.view.getUint32(offset, false);
            if (this.readString(currentKeyPtr) === keyStr) {
                this.writeTaggedValue(offset + 4, value);
                return;
            }
            offset += 13;
        }
        if (count >= capacity) {
            throw new Error(`Heap Error: Object out of capacity (max ${capacity} properties)`);
        }
        const keyPtr = this.allocateString(keyStr);
        this.view.setUint32(offset, keyPtr, false);
        this.writeTaggedValue(offset + 4, value);
        this.view.setUint16(objPtr + 6, count + 1, false);
    }
    setPropertyCached(objPtr, keyStr, value, cachedIndex) {
        if (this.view.getUint8(objPtr) !== HeapType.OBJECT)
            throw new Error("Heap Error: Not an object");
        let count = this.view.getUint16(objPtr + 6, false);
        const capacity = this.view.getUint16(objPtr + 8, false);
        if (cachedIndex < count) {
            const offset = objPtr + 10 + cachedIndex * 13;
            const currentKeyPtr = this.view.getUint32(offset, false);
            if (this.readString(currentKeyPtr) === keyStr) {
                this.writeTaggedValue(offset + 4, value);
                return cachedIndex; // Попадание в кэш!
            }
        }
        let offset = objPtr + 10;
        for (let i = 0; i < count; i++) {
            const currentKeyPtr = this.view.getUint32(offset, false);
            if (this.readString(currentKeyPtr) === keyStr) {
                this.writeTaggedValue(offset + 4, value);
                return i;
            }
            offset += 13;
        }
        if (count >= capacity) {
            throw new Error(`Heap Error: Object out of capacity (max ${capacity} properties)`);
        }
        const keyPtr = this.allocateString(keyStr);
        this.view.setUint32(offset, keyPtr, false);
        this.writeTaggedValue(offset + 4, value);
        this.view.setUint16(objPtr + 6, count + 1, false);
        return count;
    }
    getProperty(objPtr, keyStr) {
        const count = this.view.getUint16(objPtr + 6, false);
        return this.getPropertyWithIndex(objPtr, keyStr, count).value;
    }
    getPropertyWithIndex(objPtr, keyStr, count) {
        let offset = objPtr + 10;
        for (let i = 0; i < count; i++) {
            const currentKeyPtr = this.view.getUint32(offset, false);
            if (this.readString(currentKeyPtr) === keyStr) {
                return { value: this.readTaggedValue(offset + 4), index: i };
            }
            offset += 13;
        }
        return { value: undefined, index: 0xFFFF };
    }
    deleteProperty(objPtr, keyStr) {
        this.setProperty(objPtr, keyStr, undefined);
        return true;
    }
    getKeys(objPtr) {
        if (this.view.getUint8(objPtr) !== HeapType.OBJECT)
            throw new Error("Heap Error: Not an object");
        const count = this.view.getUint16(objPtr + 6, false);
        let offset = objPtr + 10;
        const keys = [];
        for (let i = 0; i < count; i++) {
            const currentKeyPtr = this.view.getUint32(offset, false);
            keys.push(this.readString(currentKeyPtr));
            offset += 13;
        }
        return keys;
    }
    allocateArray(capacity) {
        const ptr = this.allocate(12, HeapType.ARRAY);
        this.pinnedRoots.push(ptr);
        const dataPtr = this.allocate(capacity * 9, HeapType.ARRAY_DATA);
        this.pinnedRoots.pop();
        this.view.setUint32(ptr + 6, 0, false); // length
        this.view.setUint32(ptr + 10, capacity, false); // capacity
        this.view.setUint32(ptr + 14, dataPtr, false); // pointer to ARRAY_DATA
        return ptr;
    }
    getArrayLength(arrayPtr) {
        if (this.view.getUint8(arrayPtr) !== HeapType.ARRAY)
            throw new Error("Heap Error: Not an array");
        return this.view.getUint32(arrayPtr + 6, false);
    }
    getArrayElement(arrayPtr, index) {
        if (this.view.getUint8(arrayPtr) !== HeapType.ARRAY)
            throw new Error("Heap Error: Not an array");
        const length = this.view.getUint32(arrayPtr + 6, false);
        if (index < 0 || index >= length) {
            return undefined;
        }
        const dataPtr = this.view.getUint32(arrayPtr + 14, false);
        const offset = dataPtr + 6 + index * 9;
        return this.readTaggedValue(offset);
    }
    setArrayElement(arrayPtr, index, value) {
        if (this.view.getUint8(arrayPtr) !== HeapType.ARRAY)
            throw new Error("Heap Error: Not an array");
        const length = this.view.getUint32(arrayPtr + 6, false);
        const capacity = this.view.getUint32(arrayPtr + 10, false);
        if (index < 0 || index >= capacity) {
            throw new Error(`Heap Error: Array index ${index} out of bounds for capacity ${capacity}`);
        }
        const dataPtr = this.view.getUint32(arrayPtr + 14, false);
        const offset = dataPtr + 6 + index * 9;
        this.writeTaggedValue(offset, value);
        if (index >= length) {
            this.view.setUint32(arrayPtr + 6, index + 1, false);
        }
    }
    pushArrayElement(arrayPtr, value) {
        if (this.view.getUint8(arrayPtr) !== HeapType.ARRAY)
            throw new Error("Heap Error: Not an array");
        let length = this.view.getUint32(arrayPtr + 6, false);
        let capacity = this.view.getUint32(arrayPtr + 10, false);
        if (length >= capacity) {
            const newCapacity = capacity === 0 ? 4 : capacity * 2;
            this.pinnedRoots.push(arrayPtr);
            const newDataPtr = this.allocate(newCapacity * 9, HeapType.ARRAY_DATA);
            this.pinnedRoots.pop();
            const oldDataPtr = this.view.getUint32(arrayPtr + 14, false);
            for (let i = 0; i < length; i++) {
                const oldVal = this.readTaggedValue(oldDataPtr + 6 + i * 9);
                this.writeTaggedValue(newDataPtr + 6 + i * 9, oldVal);
            }
            this.view.setUint32(arrayPtr + 10, newCapacity, false);
            this.view.setUint32(arrayPtr + 14, newDataPtr, false);
        }
        this.setArrayElement(arrayPtr, length, value);
        return arrayPtr;
    }
    allocateString(str) {
        const bytes = new TextEncoder().encode(str);
        const ptr = this.allocate(bytes.length + 2, HeapType.STRING);
        this.view.setUint16(ptr + 6, bytes.length, false);
        new Uint8Array(this.buffer).set(bytes, ptr + 8);
        return ptr;
    }
    readString(ptr) {
        if (this.view.getUint8(ptr) !== HeapType.STRING)
            throw new Error("Heap Error: Expected String");
        const len = this.view.getUint16(ptr + 6, false);
        const bytes = new Uint8Array(this.buffer, ptr + 8, len);
        return new TextDecoder().decode(bytes);
    }
    collectGarbage() {
        console.log("[GC] Triggered: Mark and Sweep started.");
        const roots = this.getRoots();
        this.mark(roots);
        this.sweep();
        console.log(`[GC] Completed. Free blocks: ${this.freeList.length}, HeapTop: ${this.heapTop}`);
        if (this.freeList.length === 0 && this.heapTop >= this.buffer.byteLength) {
            throw new Error("VM Panic: Out of Memory (OOM)");
        }
    }
    mark(roots) {
        const worklist = [];
        const visitedExternals = new Set();
        const scanNativeForPointers = (val) => {
            if (!val)
                return;
            if (isPointer(val) && this.isValidPointer(getPointerValue(val))) {
                worklist.push(getPointerValue(val));
            }
            else if (typeof val === 'object') {
                if (visitedExternals.has(val))
                    return;
                visitedExternals.add(val);
                if (val.type === 'closure' && val.env) {
                    let currentEnv = val.env;
                    while (currentEnv) {
                        if (visitedExternals.has(currentEnv))
                            break;
                        visitedExternals.add(currentEnv);
                        for (const v of currentEnv.variables) {
                            scanNativeForPointers(v);
                        }
                        currentEnv = currentEnv.outer;
                    }
                }
            }
        };
        for (const root of roots) {
            scanNativeForPointers(root);
        }
        for (const root of this.pinnedRoots) {
            if (this.isValidPointer(root))
                worklist.push(root);
        }
        while (worklist.length > 0) {
            const ptr = worklist.pop();
            const isMarked = this.view.getUint8(ptr + 1) === 1;
            if (isMarked)
                continue;
            this.view.setUint8(ptr + 1, 1);
            const type = this.view.getUint8(ptr);
            const size = this.view.getUint32(ptr + 2, false);
            if (type === HeapType.OBJECT) {
                const count = this.view.getUint16(ptr + 6, false);
                let offset = ptr + 10;
                for (let i = 0; i < count; i++) {
                    const keyPtr = this.view.getUint32(offset, false);
                    if (this.isValidPointer(keyPtr))
                        worklist.push(keyPtr);
                    const valTag = this.view.getUint8(offset + 4);
                    if (valTag === ValueTag.PTR) {
                        const valPtr = this.view.getUint32(offset + 5, false);
                        if (this.isValidPointer(valPtr))
                            worklist.push(valPtr);
                    }
                    else if (valTag === ValueTag.EXTERNAL) {
                        const refId = this.view.getUint32(offset + 5, false);
                        if (!this.aliveExternals.has(refId)) {
                            this.aliveExternals.add(refId);
                            scanNativeForPointers(this.externalRefs[refId]);
                        }
                    }
                    offset += 13;
                }
            }
            else if (type === HeapType.ARRAY) {
                const dataPtr = this.view.getUint32(ptr + 14, false);
                if (this.isValidPointer(dataPtr))
                    worklist.push(dataPtr);
            }
            else if (type === HeapType.ARRAY_DATA) {
                const payloadStart = ptr + 6;
                const payloadEnd = ptr + size;
                for (let offset = payloadStart; offset <= payloadEnd - 9; offset += 9) {
                    const valTag = this.view.getUint8(offset);
                    if (valTag === ValueTag.PTR) {
                        const valPtr = this.view.getUint32(offset + 1, false);
                        if (this.isValidPointer(valPtr))
                            worklist.push(valPtr);
                    }
                    else if (valTag === ValueTag.EXTERNAL) {
                        const refId = this.view.getUint32(offset + 1, false);
                        if (!this.aliveExternals.has(refId)) {
                            this.aliveExternals.add(refId);
                            scanNativeForPointers(this.externalRefs[refId]);
                        }
                    }
                }
            }
            else if (type === HeapType.CLOSURE) {
                const payloadStart = ptr + 6;
                const payloadEnd = ptr + size;
                for (let offset = payloadStart; offset <= payloadEnd - 4; offset += 4) {
                    const possiblePtr = this.view.getUint32(offset, false);
                    if (this.isValidPointer(possiblePtr))
                        worklist.push(possiblePtr);
                }
            }
        }
    }
    sweep() {
        this.freeList = [];
        let ptr = 0;
        while (ptr < this.heapTop) {
            const isMarked = this.view.getUint8(ptr + 1) === 1;
            const size = this.view.getUint32(ptr + 2, false);
            if (size === 0)
                throw new Error("Heap Corruption: Size 0");
            if (isMarked) {
                this.view.setUint8(ptr + 1, 0);
            }
            else {
                this.view.setUint8(ptr, 0x00);
                if (this.freeList.length > 0 && this.freeList[this.freeList.length - 1].ptr + this.freeList[this.freeList.length - 1].size === ptr) {
                    this.freeList[this.freeList.length - 1].size += size;
                }
                else {
                    this.freeList.push({ ptr, size });
                }
            }
            ptr += size;
        }
    }
    isValidPointer(ptr) {
        if (ptr > 0 && ptr < this.heapTop) { // 0 = null
            const type = this.view.getUint8(ptr);
            return type === HeapType.STRING || type === HeapType.OBJECT ||
                type === HeapType.ARRAY || type === HeapType.CLOSURE;
        }
        return false;
    }
    writeTaggedValue(offset, value) {
        if (typeof value === 'number') {
            this.view.setUint8(offset, ValueTag.NUMBER);
            this.view.setFloat64(offset + 1, value, false);
        }
        else if (typeof value === 'boolean') {
            this.view.setUint8(offset, ValueTag.BOOLEAN);
            this.view.setUint8(offset + 1, value ? 1 : 0);
        }
        else if (value === null) {
            this.view.setUint8(offset, ValueTag.NULL);
        }
        else if (value === undefined) {
            this.view.setUint8(offset, ValueTag.UNDEFINED);
        }
        else if (isPointer(value)) {
            this.view.setUint8(offset, ValueTag.PTR);
            this.view.setUint32(offset + 1, getPointerValue(value), false);
        }
        else {
            this.view.setUint8(offset, ValueTag.EXTERNAL);
            let refId;
            if (this.freeExternalRefs.length > 0) {
                refId = this.freeExternalRefs.pop();
                this.externalRefs[refId] = value;
            }
            else {
                refId = this.externalRefs.length;
                this.externalRefs.push(value);
            }
            this.view.setUint32(offset + 1, refId, false);
        }
    }
    readTaggedValue(offset) {
        const tag = this.view.getUint8(offset);
        switch (tag) {
            case ValueTag.NUMBER: return this.view.getFloat64(offset + 1, false);
            case ValueTag.BOOLEAN: return this.view.getUint8(offset + 1) === 1;
            case ValueTag.NULL: return null;
            case ValueTag.UNDEFINED: return undefined;
            case ValueTag.PTR: return makePointer(this.view.getUint32(offset + 1, false));
            case ValueTag.EXTERNAL: return this.externalRefs[this.view.getUint32(offset + 1, false)];
            default: throw new Error(`Unknown value tag: ${tag}`);
        }
    }
}
