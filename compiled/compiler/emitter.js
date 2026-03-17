import { isCompiledFunction } from './compiler.types.js';
export function buildBinary(bytecode, constants, opcodeMap, constantTags) {
    let constantsSize = 0;
    const encodedStrings = constants.map(c => (typeof c === 'string' ? new TextEncoder().encode(c) : typeof c === 'bigint' ? new TextEncoder().encode(c.toString()) : null));
    constants.forEach((c, i) => {
        if (typeof c === 'number') {
            constantsSize += 1 + 8; // 1-byte tag + 8-byte float64
        }
        else if (typeof c === 'string') {
            constantsSize += 1 + 2 + 1 + encodedStrings[i].length; // 1-byte tag + 2-byte length + 1-byte key + string bytes
        }
        else if (typeof c === 'bigint') {
            constantsSize += 1 + 2 + 1 + encodedStrings[i].length; // 1-byte tag + 2-byte length + 1-byte key + string bytes
        }
        else if (isCompiledFunction(c)) {
            // пересчитываем размер на основе нового формата
            constantsSize += 1 + 1 + 1 + 2 + 1 + new TextEncoder().encode(c.name).length + 4 + c.bytecode.length;
        }
    });
    // динамический сдвиг заголовка, б - безопасность... наверное?
    const padLen = Math.floor(Math.random() * 128) + 16;
    // заголовок: 2 байта (padLen) + padLen байт + 8 байт (хеш+версия/константы) + 4 байта (теги) + 256 байт (таблица)
    const headerSize = 2 + padLen + 8 + 4 + 256;
    const buffer = new ArrayBuffer(headerSize + constantsSize + bytecode.length);
    const view = new DataView(buffer);
    const result = new Uint8Array(buffer);
    // размер паддинга и сам мусор
    view.setUint16(0, padLen, false);
    for (let i = 0; i < padLen; i++)
        result[2 + i] = Math.floor(Math.random() * 256);
    let offset = 2 + padLen;
    const hashOffset = offset;
    view.setUint32(offset, 0, false);
    offset += 4; // хеш (пока 0)
    view.setUint16(offset, 0, false);
    offset += 2; // версия
    view.setUint16(offset, constants.length, false);
    offset += 2; // колво констант
    // записываем динамические теги типов констант
    view.setUint8(offset++, constantTags.num);
    view.setUint8(offset++, constantTags.str);
    view.setUint8(offset++, constantTags.func);
    view.setUint8(offset++, constantTags.bigint);
    // записываем таблицу опкодов для вм (только в главном скрипте)
    result.set(opcodeMap, offset);
    offset += 256;
    // записываем пул констант
    constants.forEach((c, i) => {
        if (typeof c === 'number') {
            view.setUint8(offset, constantTags.num);
            offset += 1;
            view.setFloat64(offset, c, false);
            offset += 8;
        }
        else if (typeof c === 'string') {
            view.setUint8(offset, constantTags.str);
            offset += 1;
            const stringBytes = encodedStrings[i];
            view.setUint16(offset, stringBytes.length, false);
            offset += 2;
            const xorKey = Math.floor(Math.random() * 256);
            view.setUint8(offset, xorKey);
            offset += 1;
            for (let j = 0; j < stringBytes.length; j++)
                result[offset + j] = stringBytes[j] ^ xorKey;
            offset += stringBytes.length;
        }
        else if (typeof c === 'bigint') {
            view.setUint8(offset, constantTags.bigint);
            offset += 1;
            const stringBytes = encodedStrings[i];
            view.setUint16(offset, stringBytes.length, false);
            offset += 2;
            const xorKey = Math.floor(Math.random() * 256);
            view.setUint8(offset, xorKey);
            offset += 1;
            for (let j = 0; j < stringBytes.length; j++)
                result[offset + j] = stringBytes[j] ^ xorKey;
            offset += stringBytes.length;
        }
        else if (isCompiledFunction(c)) {
            const func = c;
            view.setUint8(offset, constantTags.func);
            offset += 1;
            view.setUint8(offset, func.arity);
            offset += 1;
            const flags = (func.hasRest ? 1 : 0) | (func.isAsync ? 2 : 0) | (func.isGenerator ? 4 : 0);
            view.setUint8(offset, flags);
            offset += 1;
            const nameBytes = new TextEncoder().encode(func.name);
            view.setUint16(offset, nameBytes.length, false);
            offset += 2;
            const xorKey = Math.floor(Math.random() * 256);
            view.setUint8(offset, xorKey);
            offset += 1;
            for (let j = 0; j < nameBytes.length; j++)
                result[offset + j] = nameBytes[j] ^ xorKey;
            offset += nameBytes.length;
            view.setUint32(offset, func.bytecode.length, false); // длина чанка с инструкциями
            offset += 4;
            result.set(func.bytecode, offset); // сам чанк
            offset += func.bytecode.length;
        }
        else {
            throw new Error(`Compiler error: Unsupported constant type '${typeof c}'`);
        }
    });
    // инструкции основного скрипта
    result.set(bytecode, offset);
    // вычисляем fnv-1a хеш пропуская паддинг и 4 байта самого хеша
    let hash = 2166136261;
    for (let i = hashOffset + 4; i < result.length; i++) {
        hash ^= result[i];
        hash = Math.imul(hash, 16777619);
    }
    view.setUint32(hashOffset, hash >>> 0, false);
    return result;
}
