import { Opcode } from '../../../types.js';
export function visitVariableDeclaration(compiler, node) {
    node.declarations.forEach((decl) => compiler.visit(decl));
}
export function visitVariableDeclarator(compiler, node) {
    if (node.init) {
        compiler.visit(node.init);
    }
    else {
        if (node.id.type !== 'Identifier') {
            throw new Error("SyntaxError: Missing initializer in destructuring declaration");
        }
        compiler.emit(Opcode.PUSH_UNDEFINED);
    }
    compiler.compileDeclarationPattern(node.id);
}
export function visitIdentifier(compiler, node) {
    const resolution = compiler.resolveVariable(node.name);
    if (resolution.type === 'local') {
        compiler.emitLoadVar(resolution);
    }
    else {
        const constIndex = compiler.addConstant(node.name);
        compiler.emit(Opcode.LOAD_GLOBAL);
        compiler.emit16(constIndex);
    }
}
