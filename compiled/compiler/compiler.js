import { Opcode } from '../types.js';
import { CompilerLogLevel } from './compiler.types.js';
import { optimizePeephole } from './optimizers/peephole.js';
import { buildBinary } from './emitter.js';
import { visitNode } from './ast/visitor.js';
export { CompilerLogLevel }; // Экспортируем для других файлов (index.ts, builder.ts)
export class Compiler {
    type;
    parent;
    logLevel;
    // случайная перестановка опкодов
    static generateOpcodeMap() {
        const arr = new Uint8Array(256);
        for (let i = 0; i < 256; i++)
            arr[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
    bytecode = [];
    constants;
    opcodeMap;
    // отслеживаем локальные переменные и их глубину вложенности
    locals = [];
    scopeDepth = 0;
    functionName = null;
    currentClass = null;
    currentSuperClass = null;
    currentTryDepth = 0;
    // стек для отслеживания джамп инструкций внутри циклов для break и continue
    loopStack = [];
    // короткие замыкания
    currentChainJumps = [];
    // хранит список реально использованных опкодов после оптимизации
    usedOpcodes;
    constantTags;
    // добавляем конструктор для отслеживания типа компиляции (скрипт или функция)
    constructor(type = 'script', constants = [], parent = null, logLevel = CompilerLogLevel.NONE) {
        this.type = type;
        this.parent = parent;
        this.logLevel = logLevel;
        this.constants = constants;
        // дочерние компиляторы функций наследуют таблицу главного скрипта
        this.opcodeMap = parent ? parent.opcodeMap : Compiler.generateOpcodeMap();
        this.usedOpcodes = parent ? parent.usedOpcodes : new Set();
        this.logLevel = parent ? parent.logLevel : logLevel;
        // слот 0 на стеке всегда зарезервирован: для главного скрипта или для вызываемой функции
        // это гарантирует, что локальные переменные начинаются с индекса 1, что соответствует их расположению на стеке вм
        this.locals.push({ name: this.type === 'function' ? '' : 'script', depth: 0 });
        if (parent) {
            this.constantTags = parent.constantTags;
        }
        else {
            const pool = Array.from({ length: 256 }, (_, i) => i);
            for (let i = 255; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            this.constantTags = { num: pool[0], str: pool[1], func: pool[2], bigint: pool[3] };
        }
    }
    log(level, ...args) {
        if (this.logLevel >= level) {
            const indent = '  '.repeat(this.scopeDepth);
            const prefix = level === CompilerLogLevel.INFO ? '[INFO]' : level === CompilerLogLevel.DEBUG ? '[DEBUG]' : '[TRACE]';
            console.log(`${prefix} ${indent}`, ...args);
        }
    }
    compile(ast) {
        this.log(CompilerLogLevel.INFO, `Starting compilation of ${this.type}`);
        this.visit(ast);
        // завершаем компиляцию в зависимости от типа
        this.log(CompilerLogLevel.INFO, `Finished compilation of ${this.type}`);
        return this.endCompilation();
    }
    endCompilation() {
        // добавляем финальную инструкцию в зависимости от контекста
        if (this.type === 'function') {
            // функции получают неявный возврат
            this.emit(Opcode.PUSH_UNDEFINED);
            this.emit(Opcode.RETURN);
        }
        else {
            // эту часть выполняет только компилятор верхнего уровня ('script').
            this.emit(Opcode.HALT);
        }
        // оптимизатор для очистки байткода от лишних инструкций
        this.bytecode = optimizePeephole(this.bytecode, this.opcodeMap, this.usedOpcodes, (level, msg) => this.log(level, msg));
        // мертвый мусор в конец каждой функции и скрипта
        const junkLength = Math.floor(Math.random() * 30) + 10;
        for (let i = 0; i < junkLength; i++) {
            this.bytecode.push(Math.floor(Math.random() * 256));
        }
        if (this.type === 'function') {
            // для функции мы возвращаем "сырой" оптимизированный байт-код без заголовка
            // компилятор основного скрипта встроит его в свой пул констант
            return new Uint8Array(this.bytecode);
        }
        return buildBinary(this.bytecode, this.constants, this.opcodeMap, this.constantTags);
    }
    beginScope() {
        this.scopeDepth++;
    }
    endScope() {
        this.scopeDepth--;
        while (this.locals.length > 0 && this.locals[this.locals.length - 1].depth > this.scopeDepth) {
            this.locals.pop();
        }
    }
    declareVariable(name) {
        this.log(CompilerLogLevel.DEBUG, `Declaring variable: ${name}`);
        // проверяем на повторное объявление в той же области видимости
        if (this.isDeclaredInCurrentScope(name)) {
            throw new Error(`SyntaxError: Identifier '${name}' has already been declared.`);
        }
        this.locals.push({ name, depth: this.scopeDepth });
    }
    isDeclaredInCurrentScope(name) {
        for (let i = this.locals.length - 1; i >= 0; i--) {
            const local = this.locals[i];
            if (local.depth < this.scopeDepth) {
                break; // достигли внешней области видимости
            }
            if (local.name === name) {
                return true;
            }
        }
        return false;
    }
    declarePatternVariables(pattern) {
        if (pattern.type === 'Identifier') {
            this.declareVariable(pattern.name);
        }
        else if (pattern.type === 'ArrayPattern') {
            pattern.elements.forEach((element) => {
                if (!element)
                    return;
                this.declarePatternVariables(element.type === 'RestElement' ? element.argument : element);
            });
        }
        else if (pattern.type === 'ObjectPattern') {
            pattern.properties.forEach((prop) => {
                this.declarePatternVariables(prop.type === 'RestElement' ? prop.argument : prop.value);
            });
        }
        else if (pattern.type === 'AssignmentPattern') {
            this.declarePatternVariables(pattern.left);
        }
    }
    resolveVariable(name) {
        this.log(CompilerLogLevel.TRACE, `Resolving variable: ${name}`);
        let hops = 0;
        let current = this;
        while (current !== null) {
            for (let i = current.locals.length - 1; i >= 0; i--) {
                if (current.locals[i].name === name) {
                    return { type: 'local', hops, index: i };
                }
            }
            if (current.type === 'function' && current.functionName === name) {
                return { type: 'local', hops, index: 0 };
            }
            hops++;
            current = current.parent;
        }
        return { type: 'global' };
    }
    compileDeclarationPattern(pattern) {
        if (pattern.type === 'Identifier') {
            if (!this.isDeclaredInCurrentScope(pattern.name)) {
                this.declareVariable(pattern.name);
            }
            const resolution = this.resolveVariable(pattern.name);
            if (resolution.type !== 'local')
                throw new Error("Unreachable");
            this.emitStoreVar(resolution);
            this.emit(Opcode.POP);
        }
        else if (pattern.type === 'ArrayPattern') {
            pattern.elements.forEach((element, index) => {
                if (!element)
                    return;
                if (element.type === 'RestElement') {
                    this.emit(Opcode.DUP);
                    const constIndex = this.addConstant(index);
                    this.emit(Opcode.PUSH_CONST);
                    this.emit16(constIndex);
                    this.emit(Opcode.REST_ARRAY);
                    this.compileDeclarationPattern(element.argument);
                    return;
                }
                this.emit(Opcode.DUP);
                const constIndex = this.addConstant(index);
                this.emit(Opcode.PUSH_CONST);
                this.emit16(constIndex);
                this.emit(Opcode.GET_PROPERTY);
                this.compileDeclarationPattern(element);
            });
            this.emit(Opcode.POP); // убираем сам массив
        }
        else if (pattern.type === 'ObjectPattern') {
            const excludedKeys = [];
            pattern.properties.forEach((prop) => {
                if (prop.type === 'RestElement') {
                    this.emit(Opcode.DUP);
                    excludedKeys.forEach(k => {
                        const cIdx = this.addConstant(k);
                        this.emit(Opcode.PUSH_CONST);
                        this.emit16(cIdx);
                    });
                    this.emit(Opcode.REST_OBJECT);
                    this.emit16(excludedKeys.length);
                    this.compileDeclarationPattern(prop.argument);
                    return;
                }
                this.emit(Opcode.DUP);
                if (!prop.computed && prop.key.type === 'Identifier') {
                    const constIndex = this.addConstant(prop.key.name);
                    this.emit(Opcode.GET_NAMED_PROPERTY);
                    this.emit16(constIndex);
                    this.emit16(0xFFFF); // пустой кэш при компиляции
                    excludedKeys.push(prop.key.name);
                }
                else if (!prop.computed && prop.key.type === 'Literal') {
                    const constIndex = this.addConstant(prop.key.value);
                    this.emit(Opcode.GET_NAMED_PROPERTY);
                    this.emit16(constIndex);
                    this.emit16(0xFFFF);
                    excludedKeys.push(String(prop.key.value));
                }
                else {
                    this.visit(prop.key);
                    this.emit(Opcode.GET_PROPERTY);
                }
                this.compileDeclarationPattern(prop.value);
            });
            this.emit(Opcode.POP); // убираем сам объект
        }
        else if (pattern.type === 'AssignmentPattern') {
            this.emit(Opcode.DUP);
            this.emit(Opcode.PUSH_UNDEFINED);
            this.emit(Opcode.STRICT_EQUAL);
            this.emit(Opcode.JUMP_IF_FALSE);
            const skipDefaultJump = this.emit16(0xFFFF);
            this.emit(Opcode.POP); // убираем null со стека
            this.visit(pattern.right); // вычисляем дефолтное значение
            this.patch16(skipDefaultJump, this.bytecode.length - (skipDefaultJump + 2));
            this.compileDeclarationPattern(pattern.left);
        }
        else {
            throw new Error(`Compiler error: Unsupported pattern type '${pattern.type}'`);
        }
    }
    compileParameters(params) {
        let arity = 0;
        let hasRest = false;
        params.forEach((p) => {
            if (p.type === 'RestElement') {
                if (p.argument.type !== 'Identifier')
                    throw new Error("Compiler error: Destructuring rest parameters are not supported yet.");
                this.declareVariable(p.argument.name);
                hasRest = true;
            }
            else if (p.type === 'AssignmentPattern') {
                if (p.left.type !== 'Identifier')
                    throw new Error("Compiler error: Destructuring assignment parameters are not supported yet.");
                this.declareVariable(p.left.name);
                arity++;
            }
            else if (p.type === 'Identifier') {
                this.declareVariable(p.name);
                arity++;
            }
            else {
                throw new Error(`Compiler error: Unsupported parameter type '${p.type}'`);
            }
        });
        params.forEach((p) => {
            if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
                const res = this.resolveVariable(p.left.name);
                if (res.type !== 'local')
                    throw new Error("Unreachable");
                this.emitLoadVar(res);
                this.emit(Opcode.PUSH_UNDEFINED);
                this.emit(Opcode.STRICT_EQUAL);
                this.emit(Opcode.JUMP_IF_FALSE);
                const skipJump = this.emit16(0xFFFF);
                this.visit(p.right);
                this.emitStoreVar(res);
                this.emit(Opcode.POP);
                this.patch16(skipJump, this.bytecode.length - (skipJump + 2));
            }
        });
        return { arity, hasRest };
    }
    compileBlock(body) {
        // hoisting
        body.forEach(stmt => {
            if (stmt.type === 'FunctionDeclaration') {
                this.declareVariable(stmt.id.name);
            }
            else if (stmt.type === 'VariableDeclaration') {
                stmt.declarations.forEach((decl) => this.declarePatternVariables(decl.id));
            }
            else if (stmt.type === 'ClassDeclaration') {
                this.declareVariable(stmt.id.name);
            }
        });
        body.forEach(stmt => {
            if (stmt.type === 'FunctionDeclaration') {
                this.compileFunctionDeclaration(stmt);
            }
        });
        body.forEach(stmt => {
            if (stmt.type !== 'FunctionDeclaration') {
                this.visit(stmt);
            }
        });
    }
    visit(node) {
        if (node && node.type)
            this.log(CompilerLogLevel.DEBUG, `Visiting node: ${node.type}`);
        visitNode(this, node);
    }
    compileFunctionDeclaration(node) {
        const funcName = node.id.name;
        // создаем новый компилятор для тела функции и сообщаем ему имя для рекурсии.
        const functionCompiler = new Compiler('function', this.constants, this, this.logLevel);
        functionCompiler.functionName = funcName;
        functionCompiler.currentSuperClass = this.currentSuperClass;
        functionCompiler.locals[0].name = 'this'; // регистрируем `this` для функции
        const { arity, hasRest } = functionCompiler.compileParameters(node.params);
        // компилируем тело функции
        const funcBytecode = functionCompiler.compile(node.body);
        // создаем объект функцию
        const func = {
            type: 'function',
            name: funcName,
            arity,
            hasRest,
            isAsync: node.async === true,
            isGenerator: node.generator === true,
            bytecode: funcBytecode
        };
        const constIndex = this.addConstant(func);
        this.emit(Opcode.MAKE_CLOSURE);
        this.emit16(constIndex);
        const resolution = this.resolveVariable(funcName);
        if (resolution.type !== 'local')
            throw new Error("Unreachable");
        this.emitStoreVar(resolution);
        // очищаем стек (инструкция-стейтмент)
        this.emit(Opcode.POP);
    }
    addConstant(value) {
        // дедупликация примитивов: если константа уже есть, переиспользуем её индекс
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
            const index = this.constants.indexOf(value);
            if (index !== -1)
                return index;
        }
        // внедрение фейковых констант (мусора) для запутывания пула
        if (this.type === 'script' && Math.random() < 0.2) {
            const isString = Math.random() < 0.5;
            const fakeVal = isString ? Math.random().toString(36).substring(2) : Math.random() * 100000;
            this.constants.push(fakeVal);
        }
        this.constants.push(value);
        return this.constants.length - 1;
    }
    // запись 1 байта (инструкции)
    emit(byte) {
        this.log(CompilerLogLevel.TRACE, `Emit opcode: 0x${byte.toString(16).toUpperCase()}`);
        this.bytecode.push(byte & 0xFF);
    }
    // запись 2 байт (операнда, например индекса константы до 65535)
    // Возвращает позицию начала записанного операнда
    emit16(value) {
        this.log(CompilerLogLevel.TRACE, `Emit 16-bit: ${value}`);
        const pos = this.bytecode.length;
        this.bytecode.push((value >> 8) & 0xFF);
        this.bytecode.push(value & 0xFF);
        return pos;
    }
    // "патчит" 2-байтовое значение в байткоде по указанной позиции
    patch16(position, value) {
        if (position > this.bytecode.length - 2) {
            throw new Error("Compiler error: Patch position is out of bounds");
        }
        this.bytecode[position] = (value >> 8) & 0xFF;
        this.bytecode[position + 1] = value & 0xFF;
    }
    emitLoadVar(resolution) {
        if (resolution.hops === 0) {
            this.emit(Opcode.LOAD_LOCAL);
            this.emit16(resolution.index);
        }
        else {
            this.emit(Opcode.LOAD_VAR);
            this.emit(resolution.hops);
            this.emit16(resolution.index);
        }
    }
    emitStoreVar(resolution) {
        if (resolution.hops === 0) {
            this.emit(Opcode.STORE_LOCAL);
            this.emit16(resolution.index);
        }
        else {
            this.emit(Opcode.STORE_VAR);
            this.emit(resolution.hops);
            this.emit16(resolution.index);
        }
    }
}
