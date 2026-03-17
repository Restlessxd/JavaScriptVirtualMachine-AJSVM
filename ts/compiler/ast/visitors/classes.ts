import { Opcode } from '../../../types.js';
import { Compiler } from '../../compiler.js';
import { CompiledFunction } from '../../compiler.types.js';

export function visitClassDeclaration(compiler: Compiler, node: any) {
    const className = node.id.name;
    if (!compiler.isDeclaredInCurrentScope(className)) {
        compiler.declareVariable(className);
    }
    if (node.superClass) {
        compiler.visit(node.superClass);
    } else {
        compiler.emit(Opcode.PUSH_NULL);
    }
    compiler.emit(Opcode.MAKE_CLASS);
    compiler.currentClass = { name: className };
    if (node.superClass) {
        compiler.currentSuperClass = { name: node.superClass.name };
    }
    compiler.visit(node.body);
    const resolution = compiler.resolveVariable(className);
    if (resolution.type !== 'local') throw new Error("Unreachable");
    compiler.emitStoreVar(resolution);
    compiler.emit(Opcode.POP);
    compiler.currentClass = null;
    compiler.currentSuperClass = null;
}

export function visitClassBody(compiler: Compiler, node: any) {
    node.body.forEach((method: any) => compiler.visit(method));
}

export function visitMethodDefinition(compiler: Compiler, node: any) {
    if (node.computed) throw new Error("Compiler error: Computed method names are not supported yet.");
    const methodName = node.key.name;
    const constIndex = compiler.addConstant(methodName);
    const functionCompiler = new Compiler('function', compiler.constants, compiler, compiler.logLevel);
    functionCompiler.functionName = methodName;
    functionCompiler.currentClass = compiler.currentClass;
    functionCompiler.currentSuperClass = compiler.currentSuperClass;
    functionCompiler.locals[0].name = 'this';
    const { arity, hasRest } = functionCompiler.compileParameters(node.value.params);
    const funcBytecode = functionCompiler.compile(node.value.body);
    const func: CompiledFunction = {
        type: 'function', name: methodName, arity, hasRest,
        isAsync: node.value.async === true, isGenerator: node.value.generator === true, bytecode: funcBytecode
    };
    const funcConstIndex = compiler.addConstant(func);
    if (node.static) {
        compiler.emit(Opcode.DUP);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(constIndex);
        compiler.emit(Opcode.MAKE_CLOSURE);
        compiler.emit16(funcConstIndex);
        compiler.emit(Opcode.SET_PROPERTY);
        compiler.emit(Opcode.POP);
    } else {
        compiler.emit(Opcode.MAKE_CLOSURE);
        compiler.emit16(funcConstIndex);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(constIndex);
        compiler.emit(Opcode.DEFINE_METHOD);
    }
}

export function visitPropertyDefinition(compiler: Compiler, node: any) {
    if (node.computed) throw new Error("Compiler error: Computed property names are not supported yet.");
    const propName = node.key.name;
    const constIndex = compiler.addConstant(propName);
    if (node.static) {
        compiler.emit(Opcode.DUP);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(constIndex);
        compiler.visit(node.value);
        compiler.emit(Opcode.SET_PROPERTY);
        compiler.emit(Opcode.POP);
    } else {
        throw new Error("Compiler error: Instance properties are not supported yet.");
    }
}

export function visitSuper(compiler: Compiler, node: any) {
    throw new Error("SyntaxError: 'super' can only be used with '()' or '.'");
}

export function visitThisExpression(compiler: Compiler, node: any) {
    const resolution = compiler.resolveVariable('this');
    if (resolution.type === 'local') {
        compiler.emitLoadVar(resolution);
    } else {
        const constIndex = compiler.addConstant('globalThis');
        compiler.emit(Opcode.LOAD_GLOBAL);
        compiler.emit16(constIndex);
    }
}