import { Opcode } from '../../../types.js';
import { Compiler } from '../../compiler.js';
export function visitFunctionDeclaration(compiler, node) {
    if (!compiler.isDeclaredInCurrentScope(node.id.name)) {
        compiler.declareVariable(node.id.name);
    }
    compiler.compileFunctionDeclaration(node);
}
export function visitFunctionExpression(compiler, node) {
    const funcName = node.id ? node.id.name : '<anonymous>';
    const functionCompiler = new Compiler('function', compiler.constants, compiler, compiler.logLevel);
    functionCompiler.functionName = funcName;
    functionCompiler.locals[0].name = 'this';
    const { arity, hasRest } = functionCompiler.compileParameters(node.params);
    const funcBytecode = functionCompiler.compile(node.body);
    const func = {
        type: 'function',
        name: funcName,
        arity,
        hasRest,
        isAsync: node.async === true,
        isGenerator: node.generator === true,
        bytecode: funcBytecode
    };
    const constIndex = compiler.addConstant(func);
    compiler.emit(Opcode.MAKE_CLOSURE);
    compiler.emit16(constIndex);
}
export function visitArrowFunctionExpression(compiler, node) {
    const funcName = '<anonymous>';
    const functionCompiler = new Compiler('function', compiler.constants, compiler, compiler.logLevel);
    functionCompiler.functionName = funcName;
    const { arity, hasRest } = functionCompiler.compileParameters(node.params);
    let funcBytecode;
    if (node.body.type === 'BlockStatement') {
        funcBytecode = functionCompiler.compile(node.body);
    }
    else {
        //@ts-ignore
        funcBytecode = functionCompiler.compile({ type: 'ReturnStatement', argument: node.body });
    }
    const func = {
        type: 'function',
        name: funcName,
        arity,
        hasRest,
        isAsync: node.async === true,
        isGenerator: false,
        bytecode: funcBytecode
    };
    const constIndex = compiler.addConstant(func);
    compiler.emit(Opcode.MAKE_CLOSURE);
    compiler.emit16(constIndex);
}
export function visitAwaitExpression(compiler, node) {
    compiler.visit(node.argument);
    compiler.emit(Opcode.AWAIT);
}
export function visitYieldExpression(compiler, node) {
    if (node.delegate)
        throw new Error("Compiler error: yield* is not supported yet.");
    if (node.argument) {
        compiler.visit(node.argument);
    }
    else {
        compiler.emit(Opcode.PUSH_UNDEFINED);
    }
    compiler.emit(Opcode.YIELD);
}
