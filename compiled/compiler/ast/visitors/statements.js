import { Opcode } from '../../../types.js';
export function visitBlock(compiler, node) {
    compiler.beginScope();
    compiler.compileBlock(node.body);
    compiler.endScope();
}
export function visitExpressionStatement(compiler, node) {
    compiler.visit(node.expression);
    compiler.emit(Opcode.POP);
}
export function visitIfStatement(compiler, node) {
    compiler.visit(node.test);
    compiler.emit(Opcode.JUMP_IF_FALSE);
    const ifJump = compiler.emit16(0xFFFF);
    compiler.visit(node.consequent);
    if (node.alternate) {
        compiler.emit(Opcode.JUMP);
        const elseJump = compiler.emit16(0xFFFF);
        const elseBlockStartPos = compiler.bytecode.length;
        const jumpIfFalseOffset = elseBlockStartPos - (ifJump + 2);
        compiler.patch16(ifJump, jumpIfFalseOffset);
        compiler.visit(node.alternate);
        const endOfIfElsePos = compiler.bytecode.length;
        const jumpOffset = endOfIfElsePos - (elseJump + 2);
        compiler.patch16(elseJump, jumpOffset);
    }
    else {
        const endOfIfPos = compiler.bytecode.length;
        const jumpIfFalseOffset = endOfIfPos - (ifJump + 2);
        compiler.patch16(ifJump, jumpIfFalseOffset);
    }
}
export function visitWhileStatement(compiler, node) {
    const loopStart = compiler.bytecode.length;
    compiler.loopStack.push({ breakJumps: [], continueJumps: [], tryDepth: compiler.currentTryDepth });
    compiler.visit(node.test);
    compiler.emit(Opcode.JUMP_IF_FALSE);
    const exitJump = compiler.emit16(0xFFFF);
    compiler.visit(node.body);
    const loopInfo = compiler.loopStack.pop();
    for (const jump of loopInfo.continueJumps) {
        compiler.patch16(jump, loopStart - (jump + 2));
    }
    compiler.emit(Opcode.JUMP);
    const jumpBackOffset = loopStart - (compiler.bytecode.length + 2);
    compiler.emit16(jumpBackOffset);
    const endPos = compiler.bytecode.length;
    compiler.patch16(exitJump, endPos - (exitJump + 2));
    for (const jump of loopInfo.breakJumps) {
        compiler.patch16(jump, endPos - (jump + 2));
    }
}
export function visitDoWhileStatement(compiler, node) {
    const loopStart = compiler.bytecode.length;
    compiler.loopStack.push({ breakJumps: [], continueJumps: [], tryDepth: compiler.currentTryDepth });
    compiler.visit(node.body);
    const loopInfo = compiler.loopStack.pop();
    const conditionStart = compiler.bytecode.length;
    for (const jump of loopInfo.continueJumps) {
        compiler.patch16(jump, conditionStart - (jump + 2));
    }
    compiler.visit(node.test);
    compiler.emit(Opcode.JUMP_IF_TRUE);
    const jumpBackOffset = loopStart - (compiler.bytecode.length + 2);
    compiler.emit16(jumpBackOffset);
    const endPos = compiler.bytecode.length;
    for (const jump of loopInfo.breakJumps) {
        compiler.patch16(jump, endPos - (jump + 2));
    }
}
export function visitForStatement(compiler, node) {
    compiler.beginScope();
    if (node.init) {
        if (node.init.type === 'VariableDeclaration') {
            node.init.declarations.forEach((decl) => compiler.declarePatternVariables(decl.id));
        }
        compiler.visit(node.init);
        if (node.init.type !== 'VariableDeclaration') {
            compiler.emit(Opcode.POP);
        }
    }
    const loopStart = compiler.bytecode.length;
    compiler.loopStack.push({ breakJumps: [], continueJumps: [], tryDepth: compiler.currentTryDepth });
    let exitJump = -1;
    if (node.test) {
        compiler.visit(node.test);
        compiler.emit(Opcode.JUMP_IF_FALSE);
        exitJump = compiler.emit16(0xFFFF);
    }
    compiler.visit(node.body);
    const loopInfo = compiler.loopStack.pop();
    const updateStartPos = compiler.bytecode.length;
    for (const jump of loopInfo.continueJumps) {
        compiler.patch16(jump, updateStartPos - (jump + 2));
    }
    if (node.update) {
        compiler.visit(node.update);
        compiler.emit(Opcode.POP);
    }
    compiler.emit(Opcode.JUMP);
    const jumpBackOffset = loopStart - (compiler.bytecode.length + 2);
    compiler.emit16(jumpBackOffset);
    const endPos = compiler.bytecode.length;
    if (exitJump !== -1) {
        compiler.patch16(exitJump, endPos - (exitJump + 2));
    }
    for (const jump of loopInfo.breakJumps) {
        compiler.patch16(jump, endPos - (jump + 2));
    }
    compiler.endScope();
}
export function visitForInOfStatement(compiler, node) {
    compiler.beginScope();
    if (node.left.type === 'VariableDeclaration') {
        node.left.declarations.forEach((decl) => compiler.declarePatternVariables(decl.id));
    }
    compiler.visit(node.right);
    if (node.type === 'ForInStatement') {
        compiler.emit(Opcode.GET_FOR_IN_ITERATOR);
    }
    else {
        if (node.await) {
            compiler.emit(Opcode.GET_ASYNC_ITERATOR);
        }
        else {
            compiler.emit(Opcode.GET_FOR_OF_ITERATOR);
        }
    }
    const loopStart = compiler.bytecode.length;
    compiler.loopStack.push({ breakJumps: [], continueJumps: [], tryDepth: compiler.currentTryDepth });
    if (node.type === 'ForOfStatement' && node.await) {
        compiler.emit(Opcode.ASYNC_ITERATOR_NEXT);
        compiler.emit(Opcode.AWAIT);
        compiler.emit(Opcode.UNPACK_ITERATOR_RESULT);
    }
    else {
        compiler.emit(Opcode.ITERATOR_NEXT);
    }
    compiler.emit(Opcode.JUMP_IF_TRUE);
    const exitJump = compiler.emit16(0xFFFF);
    if (node.left.type === 'VariableDeclaration') {
        const declPattern = node.left.declarations[0].id;
        compiler.compileDeclarationPattern(declPattern);
    }
    else if (node.left.type === 'Identifier') {
        const res = compiler.resolveVariable(node.left.name);
        if (res.type === 'local') {
            compiler.emitStoreVar(res);
            compiler.emit(Opcode.POP);
        }
        else {
            throw new Error("Compiler error: Global variable assignment in for...in/of is not supported yet.");
        }
    }
    else {
        throw new Error(`Compiler error: Unsupported left hand side in ${node.type}`);
    }
    compiler.visit(node.body);
    const loopInfo = compiler.loopStack.pop();
    for (const jump of loopInfo.continueJumps) {
        compiler.patch16(jump, loopStart - (jump + 2));
    }
    compiler.emit(Opcode.JUMP);
    const jumpBackOffset = loopStart - (compiler.bytecode.length + 2);
    compiler.emit16(jumpBackOffset);
    const endCleanValuePos = compiler.bytecode.length;
    compiler.patch16(exitJump, endCleanValuePos - (exitJump + 2));
    compiler.emit(Opcode.POP);
    const endCleanIterPos = compiler.bytecode.length;
    for (const jump of loopInfo.breakJumps) {
        compiler.patch16(jump, endCleanIterPos - (jump + 2));
    }
    compiler.emit(Opcode.POP);
    compiler.endScope();
}
export function visitBreakStatement(compiler, node) {
    if (node.label)
        throw new Error("Compiler error: Labeled break statements are not supported.");
    if (compiler.loopStack.length === 0)
        throw new Error("SyntaxError: Illegal break statement");
    const loopInfo = compiler.loopStack[compiler.loopStack.length - 1];
    const popCount = compiler.currentTryDepth - loopInfo.tryDepth;
    for (let i = 0; i < popCount; i++) {
        compiler.emit(Opcode.POP_CATCH);
    }
    compiler.emit(Opcode.JUMP);
    const breakJump = compiler.emit16(0xFFFF);
    compiler.loopStack[compiler.loopStack.length - 1].breakJumps.push(breakJump);
}
export function visitContinueStatement(compiler, node) {
    if (node.label)
        throw new Error("Compiler error: Labeled continue statements are not supported.");
    let loopIndex = compiler.loopStack.length - 1;
    while (loopIndex >= 0 && compiler.loopStack[loopIndex].isSwitch) {
        loopIndex--;
    }
    if (loopIndex < 0)
        throw new Error("SyntaxError: Illegal continue statement");
    const loopInfo = compiler.loopStack[loopIndex];
    const popCount = compiler.currentTryDepth - loopInfo.tryDepth;
    for (let i = 0; i < popCount; i++) {
        compiler.emit(Opcode.POP_CATCH);
    }
    compiler.emit(Opcode.JUMP);
    const continueJump = compiler.emit16(0xFFFF);
    loopInfo.continueJumps.push(continueJump);
}
export function visitReturnStatement(compiler, node) {
    if (compiler.type !== 'function')
        throw new Error("SyntaxError: 'return' outside a function.");
    if (node.argument) {
        compiler.visit(node.argument);
    }
    else {
        compiler.emit(Opcode.PUSH_UNDEFINED);
    }
    compiler.emit(Opcode.RETURN);
}
export function visitThrowStatement(compiler, node) {
    compiler.visit(node.argument);
    compiler.emit(Opcode.THROW);
}
export function visitTryStatement(compiler, node) {
    compiler.emit(Opcode.SETUP_CATCH);
    const catchJump = compiler.emit16(0xFFFF);
    compiler.currentTryDepth++;
    compiler.visit(node.block);
    compiler.currentTryDepth--;
    compiler.emit(Opcode.POP_CATCH);
    compiler.emit(Opcode.JUMP);
    const endJump = compiler.emit16(0xFFFF);
    compiler.patch16(catchJump, compiler.bytecode.length - (catchJump + 2));
    if (node.handler) {
        compiler.beginScope();
        if (node.handler.param) {
            if (node.handler.param.type !== 'Identifier') {
                throw new Error("Compiler error: Destructuring in catch clause is not supported yet.");
            }
            const paramName = node.handler.param.name;
            compiler.declareVariable(paramName);
            const resolution = compiler.resolveVariable(paramName);
            compiler.emitStoreVar(resolution);
            compiler.emit(Opcode.POP);
        }
        else {
            compiler.emit(Opcode.POP);
        }
        compiler.visit(node.handler.body);
        compiler.endScope();
    }
    else {
        compiler.emit(Opcode.THROW);
    }
    compiler.patch16(endJump, compiler.bytecode.length - (endJump + 2));
    if (node.finalizer)
        throw new Error("Compiler error: try...finally is not supported yet.");
}
export function visitSwitchStatement(compiler, node) {
    compiler.beginScope();
    const discName = '.switch' + compiler.bytecode.length;
    compiler.declareVariable(discName);
    compiler.visit(node.discriminant);
    const discRes = compiler.resolveVariable(discName);
    if (discRes.type !== 'local')
        throw new Error("Unreachable");
    compiler.emitStoreVar(discRes);
    compiler.emit(Opcode.POP);
    compiler.loopStack.push({ breakJumps: [], continueJumps: [], tryDepth: compiler.currentTryDepth, isSwitch: true });
    const caseJumps = [];
    let defaultCaseIndex = -1;
    for (let i = 0; i < node.cases.length; i++) {
        const clause = node.cases[i];
        if (clause.test) {
            compiler.emitLoadVar(discRes);
            compiler.visit(clause.test);
            compiler.emit(Opcode.STRICT_EQUAL);
            compiler.emit(Opcode.JUMP_IF_TRUE);
            const testJumpPos = compiler.emit16(0xFFFF);
            caseJumps.push({ testJumpPos });
        }
        else {
            defaultCaseIndex = i;
            caseJumps.push({ testJumpPos: -1 });
        }
    }
    compiler.emit(Opcode.JUMP);
    const defaultOrEndJumpPos = compiler.emit16(0xFFFF);
    for (let i = 0; i < node.cases.length; i++) {
        const clause = node.cases[i];
        caseJumps[i].bodyPos = compiler.bytecode.length;
        clause.consequent.forEach((stmt) => compiler.visit(stmt));
    }
    const endPos = compiler.bytecode.length;
    for (let i = 0; i < node.cases.length; i++) {
        if (caseJumps[i].testJumpPos !== -1) {
            compiler.patch16(caseJumps[i].testJumpPos, caseJumps[i].bodyPos - (caseJumps[i].testJumpPos + 2));
        }
    }
    if (defaultCaseIndex !== -1) {
        compiler.patch16(defaultOrEndJumpPos, caseJumps[defaultCaseIndex].bodyPos - (defaultOrEndJumpPos + 2));
    }
    else {
        compiler.patch16(defaultOrEndJumpPos, endPos - (defaultOrEndJumpPos + 2));
    }
    const loopInfo = compiler.loopStack.pop();
    for (const jump of loopInfo.breakJumps) {
        compiler.patch16(jump, compiler.bytecode.length - (jump + 2));
    }
    compiler.endScope();
}
