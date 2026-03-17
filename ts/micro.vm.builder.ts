import * as fs from 'fs';
import * as acorn from 'acorn';
import { Compiler, CompilerLogLevel } from './compiler/compiler.js';
import { Opcode } from './types.js';
import { minify } from 'terser';
import * as esbuild from 'esbuild';

export interface MicroVMOptions {
    shouldMinify: boolean;
    ecmaVersion: number,
    filePath: string | null, // оставляем null если не хотим сохранять в файл
    logLevel?: CompilerLogLevel,
    production?: boolean
}

const defaultOptions: MicroVMOptions = {
    shouldMinify: true,
    ecmaVersion: 2022,
    filePath: null,
    logLevel: CompilerLogLevel.NONE,
    production: false
}

export class MicroVMBuilder {
    public static async build(jsCode: string, vmTemplatePath: string, options: MicroVMOptions = defaultOptions): Promise<{ bytecode: Uint8Array, microVMCode: string }> {
        // 1 -> компилируем js код и собираем статистику опкодов
        const ast = acorn.parse(jsCode, { ecmaVersion: 2022, locations: true }) as acorn.Node;
        const compiler = new Compiler('script', [], null, options.logLevel ?? CompilerLogLevel.NONE);
        const bytecode = compiler.compile(ast);
        const usedOpcodes = compiler.usedOpcodes;

        // 2 -> сборка монолита вм напрямую из исходников ts с помощью esbuild
        const buildResult = await esbuild.build({
            entryPoints: ['../ts/vm/vm.ts'],
            bundle: true,   
            write: false,   
            format: 'iife',     
            globalName: 'VM_BUNDLE',
            target: 'es2022'
        });

        let cleanVm = buildResult.outputFiles[0].text;

        if (options.production) {
            cleanVm = cleanVm.replace(
                /if\s*\(\(hash\s*>>>\s*0\)\s*!==\s*expectedHash\)\s*\{\s*throw\s*new\s*Error\([^)]+\);\s*\}/g,
                'if ((hash >>> 0) !== expectedHash) { return; }'
            );
        }

        const OpcodeMap = Object.fromEntries(Object.entries(Opcode).map(([k, v]) => [v, k]));
        const usedOpcodeNames = Array.from(usedOpcodes).map(code => OpcodeMap[code as number]);

        // обязательные инструкции (для внутренних механизмов, обработки ошибок и выходов)
        const requiredOpcodes = ['HALT', 'RETURN', 'POP', 'SETUP_CATCH', 'POP_CATCH', 'THROW', 'MAKE_CLOSURE', 'PUSH_UNDEFINED'];
        requiredOpcodes.forEach(op => {
            if (!usedOpcodeNames.includes(op)) usedOpcodeNames.push(op);
        });

        // вырезаем неиспользуемые опкоды из switch-case в вм (вместе с комментариями).
        const runMethodStart = cleanVm.indexOf('run(targetFrameCount');
        const afterRunMethodStart = cleanVm.indexOf('createChildVM(', runMethodStart);

        if (runMethodStart !== -1 && afterRunMethodStart !== -1) {
            const beforeRun = cleanVm.slice(0, runMethodStart);
            let runMethod = cleanVm.slice(runMethodStart, afterRunMethodStart);
            const afterRun = cleanVm.slice(afterRunMethodStart);

            const caseRegex = /(?:\s*\/\/[^\n]*)*\s*case\s+Opcode\.([A-Z0-9_]+):([\s\S]*?)(?=(?:\s*\/\/[^\n]*)*\s*(?:case\s+Opcode\.|default:))/g;
            runMethod = runMethod.replace(caseRegex, (match, opcodeName) => {
                return usedOpcodeNames.includes(opcodeName) ? match : ''; // удаляем блок если опкод не нужен
            });

            cleanVm = beforeRun + runMethod + afterRun;
        }

        // инлайним все используемые опкоды прямо в код числами, чтобы удалить текстовые упоминания инструкций
        cleanVm = cleanVm.replace(/Opcode\.([A-Z0-9_]+)/g, (match, opcodeName) => {
            const numericValue = (Opcode as any)[opcodeName];
            return numericValue !== undefined ? String(numericValue) : match;
        });
        
        // склеиваем всё в один монолитный файл
        let microVMCode = `// --- MICRO-VM AUTO-GENERATED ---\n\n`;
        microVMCode += `// --- VM ---\n${cleanVm}\n`;

        // переименовываем внутренние свойства и методы, добавляя префикс _, чтобы Terser мог их безопасно сжать
        const internalProps = [
            // константы и енамы
            'STRING', 'OBJECT', 'ARRAY', 'CLOSURE', 'ARRAY_DATA',
            'NUMBER', 'BOOLEAN', 'NULL', 'UNDEFINED', 'PTR', 'EXTERNAL',
            'PTR_TAG', 'PTR_MASK', 'makePointer', 'isPointer', 'getPointerValue', 'float64Array', 'bigUint64Array',
            // кастом хеп
            'view', 'heapTop', 'freeList', 'externalRefs', 'freeExternalRefs', 'aliveExternals', 'getRoots', 'pinnedRoots',
            'allocate', 'allocateObject', 'getPropertyCached', 'setProperty', 'setPropertyCached', 'getProperty',
            'getPropertyWithIndex', 'deleteProperty', 'getKeys', 'allocateArray', 'getArrayLength', 'getArrayElement',
            'setArrayElement', 'pushArrayElement', 'allocateString', 'readString', 'collectGarbage', 'mark', 'sweep',
            'isValidPointer', 'writeTaggedValue', 'readTaggedValue', 'ptr', 'size',
            // окружение
            'outer', 'variables', 'isCaptured', 'alloc', 'pool', 'free',
            // каллфрейм
            'closure', 'env', 'basePointer', 'isConstructorCall', 'constructedInstance', 'ip', 'catchHandlers', 'catchIp', 'stackDepth',
            // ошибки
            'promise',
            // вм
            'stack', 'frames', 'bytecode', 'constants', 'heap', 'globalEnv', 'reverseOpcodeMap', 'MAX_CALL_STACK_SIZE',
            'parseBytecode', 'collectRoots', 'handleException', 'unwrapForNative', 'wrapClosureForNative', 'exceptionHandler', 'interopHandler', 'closureHandler',
            'run', 'callClosure', 'createChildVM', 'executeAsyncClosure', 'getVariables',
            'func', 'arity', 'hasRest', 'isAsync', 'isGenerator',
            // свойства для обфускации
            'decodeChunk', 'wordcode', 'pushUndefOpcode', 'returnOpcode', 'sp', 'fp'
        ];
        
        const propsRegex = new RegExp(`\\b(${internalProps.join('|')})\\b`, 'g');
        microVMCode = microVMCode.replace(propsRegex, '_$1');

        // оптимизация DataView (Monkey-Patching)
        // заменяем все длинные вызовы на наши алиасы (которые terser потом безопасно сожмет)
        microVMCode = microVMCode
            .replace(/\bgetUint8\b/g, '_g8').replace(/\bsetUint8\b/g, '_s8')
            .replace(/\bgetUint16\b/g, '_g16').replace(/\bsetUint16\b/g, '_s16')
            .replace(/\bgetUint32\b/g, '_g32').replace(/\bsetUint32\b/g, '_s32')
            .replace(/\bgetFloat64\b/g, '_gF64').replace(/\bsetFloat64\b/g, '_sF64');

        // вставляем регистрацию алиасов в нативный прототип в самое начало файла
        const dataViewSetup = `
            const _DVP = DataView.prototype;
            _DVP._g8 = _DVP.getUint8;
            _DVP._s8 = _DVP.setUint8;
            _DVP._g16 = _DVP.getUint16;
            _DVP._s16 = _DVP.setUint16;
            _DVP._g32 = _DVP.getUint32;
            _DVP._s32 = _DVP.setUint32;
            _DVP._gF64 = _DVP.getFloat64;
            _DVP._sF64 = _DVP.setFloat64;`;
            
        microVMCode = dataViewSetup + microVMCode;

        // выносим длинные имена ключей (ловушки Proxy и дескрипторы) в массив
        const proxyKeys = ["getOwnPropertyDescriptor", "enumerable", "configurable", "writable", "ownKeys"];
        microVMCode = `const _K = ${JSON.stringify(proxyKeys)};\n` + microVMCode;

        microVMCode = microVMCode
            .replace(/\bgetOwnPropertyDescriptor\s*:/g, '[_K[0]]:')
            .replace(/\benumerable\s*:/g, '[_K[1]]:')
            .replace(/\bconfigurable\s*:/g, '[_K[2]]:')
            .replace(/\bwritable\s*:/g, '[_K[3]]:')
            .replace(/\bownKeys\s*:/g, '[_K[4]]:');

        // генерируем код инициализации с вшитым байт-кодом в самый низ файла
        // весь байткод шифруется через rc4
        const rc4Key = Array.from({length: 16}, () => Math.floor(Math.random() * 256));
        const enc = new Uint8Array(bytecode.length);
        let s = Array.from({length: 256}, (_, i) => i);
        let j = 0;
        for (let i = 0; i < 256; i++) {
            j = (j + s[i] + rc4Key[i % 16]) % 256;
            [s[i], s[j]] = [s[j], s[i]];
        }
        let i = 0; j = 0;
        for (let k = 0; k < bytecode.length; k++) {
            i = (i + 1) % 256;
            j = (j + s[i]) % 256;
            [s[i], s[j]] = [s[j], s[i]];
            enc[k] = bytecode[k] ^ s[(s[i] + s[j]) % 256];
        }

        const b64 = Buffer.from(enc).toString('base64');
        
        const obfuscatedKey = rc4Key.map(byte => {
            const randShift = Math.floor(Math.random() * 5000);
            const randXor = Math.floor(Math.random() * 256);
            return `((${byte ^ randXor} ^ ${randXor}) + ${randShift} - ${randShift})`;
        }).join(', ');

        // анти-дебаг, смысла конечно мало но все же
        const debuggerTrap = `(function(){const d=function(){try{Function('debugger')()}catch(e){}setTimeout(d, 50)};d()})();\n`;

        let startupCode = `\n// VM startup logic\n` +
            debuggerTrap +
            `const _b64 = "${b64}";\n` +
            `const _k = [${obfuscatedKey}];\n` +
            `let _buf = typeof Buffer !== "undefined" ? Buffer.from(_b64, "base64") : Uint8Array.from(atob(_b64), c => c.charCodeAt(0));\n` +
            `let _s = [], _i = 0, _j = 0;\n` +
            `for (; _i < 256; _i++) _s[_i] = _i;\n` +
            `for (_i = 0; _i < 256; _i++) { _j = (_j + _s[_i] + _k[_i % 16]) % 256; let t = _s[_i]; _s[_i] = _s[_j]; _s[_j] = t; }\n` +
            `_i = _j = 0;\n` +
            `for (let n = 0; n < _buf.length; n++) { _i = (_i + 1) % 256; _j = (_j + _s[_i]) % 256; let t = _s[_i]; _s[_i] = _s[_j]; _s[_j] = t; _buf[n] ^= _s[(_s[_i] + _s[_j]) % 256]; }\n` +
            `const _vm = new VM_BUNDLE.VM(_buf);\n` +
            `_vm._run();\n`;

        microVMCode += startupCode;

        let minified;
        if(options.production) {
            minified = await minify(microVMCode, { 
            compress: {
                passes: 2,
                toplevel: true, 
            },
            mangle: {
                toplevel: true, 
                properties: { regex: /^_/ }
            }
        });
        } else {
            minified = { code: microVMCode }
        }
        
        const finalCode = minified.code || microVMCode;

        if(options.filePath != null) {
            fs.writeFileSync(options.filePath, finalCode);
        }

        return { bytecode, microVMCode: finalCode };
    }
}