import { Opcode } from '../../types.js';
import { CompilerLogLevel } from '../compiler.types.js';

export function optimizePeephole(
    bytecode: number[], 
    opcodeMap: Uint8Array, 
    usedOpcodes: Set<number>, 
    log: (level: CompilerLogLevel, msg: string) => void
): number[] {
    log(CompilerLogLevel.INFO, `Starting Peephole optimization (Initial size: ${bytecode.length} bytes)`);
    
    // 1. Определение длин операндов для каждой инструкции (в байтах)
    const argLengths: Record<number, number> = {
        [Opcode.STORE_VAR]: 3,
        [Opcode.LOAD_VAR]: 3,
        [Opcode.CONSOLE_LOG]: 1,
        [Opcode.CONSOLE_WARN]: 1,
        [Opcode.CONSOLE_ERROR]: 1,
        [Opcode.CALL]: 1,
        [Opcode.NEW]: 1,
        [Opcode.INVOKE]: 3,
        [Opcode.INVOKE_SPREAD]: 2,
        [Opcode.INVOKE_SUPER]: 3,
        [Opcode.SUPER_CONSTRUCTOR]: 1,
        [Opcode.PUSH_CONST]: 2,
        [Opcode.STORE_LOCAL]: 2,
        [Opcode.LOAD_LOCAL]: 2,
        [Opcode.JUMP]: 2,
        [Opcode.JUMP_IF_FALSE]: 2,
        [Opcode.JUMP_IF_TRUE]: 2,
        [Opcode.JUMP_IF_NOT_NULLISH]: 2,
        [Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT]: 2,
        [Opcode.SETUP_CATCH]: 2,
        [Opcode.MAKE_CLOSURE]: 2,
        [Opcode.MAKE_ARRAY]: 2,
        [Opcode.MAKE_OBJECT]: 2,
        [Opcode.REST_OBJECT]: 2,
        [Opcode.LOAD_GLOBAL]: 2,
        [Opcode.TYPEOF_GLOBAL]: 2,
        [Opcode.STORE_GLOBAL]: 2,
        [Opcode.DELETE_GLOBAL]: 2,
        [Opcode.PUSH_INT8]: 1,
        [Opcode.GET_NAMED_PROPERTY]: 4,
        [Opcode.SET_NAMED_PROPERTY]: 4,
    };

    interface Inst {
        opcode: number;
        args: number[];
        originalOffset: number;
        targetOffset?: number;
        isDead?: boolean;
        newOffset?: number;
    }

    // Парсим сырой байт-код в массив структур
    const insts: Inst[] = [];
    let ip = 0;
    while (ip < bytecode.length) {
        const originalOffset = ip;
        const opcode = bytecode[ip++];
        const argLen = argLengths[opcode] || 0;
        const args = [];
        for (let i = 0; i < argLen; i++) args.push(bytecode[ip++]);
        
        let targetOffset = undefined;
        if ([Opcode.JUMP, Opcode.JUMP_IF_FALSE, Opcode.JUMP_IF_TRUE, Opcode.JUMP_IF_NOT_NULLISH, Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT, Opcode.SETUP_CATCH].includes(opcode)) {
            const rel = (args[0] << 8) | args[1];
            const signedRel = rel >= 0x8000 ? rel - 0x10000 : rel;
            targetOffset = ip + signedRel; // Вычисляем абсолютный адрес, куда указывает JUMP
        }
        insts.push({ opcode, args, originalOffset, targetOffset });
    }

    // Собираем адреса, на которые ссылаются инструкции перехода
    // МЫ НЕ МОЖЕМ удалять инструкции, которые являются "точкой входа" для JUMP.
    const jumpTargets = new Set<number>();
    for (const inst of insts) {
        if (inst.targetOffset !== undefined) jumpTargets.add(inst.targetOffset);
    }

    // 2. Ищем и помечаем неэффективные паттерны как "Мертвые" (isDead)
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < insts.length - 1; i++) {
            if (insts[i].isDead) continue;
            
            let next1 = -1;
            for (let j = i + 1; j < insts.length; j++) if (!insts[j].isDead) { next1 = j; break; }
            if (next1 === -1) continue;

            let next2 = -1;
            for (let j = next1 + 1; j < insts.length; j++) if (!insts[j].isDead) { next2 = j; break; }

            const i1 = insts[i];
            const i2 = insts[next1];
            const i3 = next2 !== -1 ? insts[next2] : null;

            // Паттерн: STORE x -> POP -> LOAD x  ==>  STORE x
            if (i3 && (i1.opcode === Opcode.STORE_LOCAL || i1.opcode === Opcode.STORE_VAR) && 
                i2.opcode === Opcode.POP && 
                i3.opcode === (i1.opcode === Opcode.STORE_LOCAL ? Opcode.LOAD_LOCAL : Opcode.LOAD_VAR)) {
                
                if (!jumpTargets.has(i2.originalOffset) && !jumpTargets.has(i3.originalOffset)) {
                    if (i1.args.join() === i3.args.join()) { // Если индекс переменной тот же
                        i2.isDead = true;
                        i3.isDead = true;
                        changed = true;
                        continue;
                    }
                }
            }

            // Паттерн: Загрузка значения, за которой сразу идет POP (бесполезная операция)
            const safeToPop = [Opcode.PUSH_CONST, Opcode.PUSH_INT8, Opcode.PUSH_TRUE, Opcode.PUSH_FALSE, Opcode.PUSH_NULL, Opcode.PUSH_UNDEFINED, Opcode.LOAD_LOCAL, Opcode.LOAD_VAR];
            if (safeToPop.includes(i1.opcode) && i2.opcode === Opcode.POP) {
                if (!jumpTargets.has(i2.originalOffset)) {
                    i1.isDead = true;
                    i2.isDead = true;
                    changed = true;
                    continue;
                }
            }
        }
    }

    // 3. Пересчитываем новые адреса и смещения
    let currentNewOffset = 0;
    const offsetMap = new Map<number, number>();

    // --- OBFUSCATION: Планируем обманные блоки (Dummy Blocks / CFG Obfuscation)
    const dummyBlocks = new Map<number, { type: number, args: number[] }>();
    // Все эти инструкции занимают ровно 3 байта
    const fakeOpcodes = [
        Opcode.JUMP, Opcode.JUMP_IF_FALSE, Opcode.JUMP_IF_TRUE, 
        Opcode.SETUP_CATCH, Opcode.PUSH_CONST, Opcode.LOAD_GLOBAL
    ];

    for (let i = 0; i < insts.length; i++) {
        const inst = insts[i];

        // if (!inst.isDead && !jumpTargets.has(inst.originalOffset) && Math.random() < 0.02) { // 2% мусора достаточно для сбития статического анализа
        //     const fakeOpcode = fakeOpcodes[Math.floor(Math.random() * fakeOpcodes.length)];
        //     const fakeArgs = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
        //     dummyBlocks.set(i, { type: fakeOpcode, args: fakeArgs });
        //     currentNewOffset += 6; // Настоящий JUMP (3 байта) + Фейковая инструкция (3 байта)
        // }

        const length = 1 + inst.args.length;
        for (let b = 0; b < length; b++) offsetMap.set(inst.originalOffset + b, currentNewOffset);
        if (!inst.isDead) {
            inst.newOffset = currentNewOffset;
            currentNewOffset += length;
        }
    }
    offsetMap.set(bytecode.length, currentNewOffset); // Для прыжков в самый конец файла

    // 4. Генерируем "чистый" байт-код с исправленными переходами JUMP
    const optimizedBytecode: number[] = [];
    for (let i = 0; i < insts.length; i++) {
        const inst = insts[i];
        if (inst.isDead) continue;
        
        // Внедряем обманный блок, если он запланирован
        if (dummyBlocks.has(i)) {
            const dummy = dummyBlocks.get(i)!;
            
            // Настоящий безусловный переход, который перепрыгнет фейк
            usedOpcodes.add(Opcode.JUMP);
            optimizedBytecode.push(opcodeMap[Opcode.JUMP]);
            optimizedBytecode.push(0, 3);
            
            // Фейковая инструкция-мусор
            usedOpcodes.add(dummy.type);
            optimizedBytecode.push(opcodeMap[dummy.type]);
            optimizedBytecode.push(...dummy.args);
        }
        usedOpcodes.add(inst.opcode);
        
        optimizedBytecode.push(opcodeMap[inst.opcode]);

        if (inst.targetOffset !== undefined) {
            const newTarget = offsetMap.get(inst.targetOffset);
            if (newTarget === undefined) throw new Error("Peephole Optimizer: Invalid JUMP target");
            
            let newRel = newTarget - (inst.newOffset! + 1 + inst.args.length);
            if (newRel < 0) newRel += 0x10000; // Обратный переход
            optimizedBytecode.push((newRel >> 8) & 0xFF, newRel & 0xFF);
        } else {
            optimizedBytecode.push(...inst.args);
        }
    }
    
    log(CompilerLogLevel.INFO, `Peephole optimization finished (Final size: ${optimizedBytecode.length} bytes)`);
    return optimizedBytecode;
}