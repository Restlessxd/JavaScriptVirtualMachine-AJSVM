import { Opcode } from '../../../types.js';
import { Compiler } from '../../compiler.js';

export function visitChainExpression(compiler: Compiler, node: any) {
    compiler.currentChainJumps.push([]);
    compiler.visit(node.expression);
    const jumps = compiler.currentChainJumps.pop()!;
    const endPos = compiler.bytecode.length;
    for (const jump of jumps) {
        compiler.patch16(jump, endPos - (jump + 2));
    }
}

export function visitBinaryExpression(compiler: Compiler, node: any) {
    if (node.left.type === 'Literal' && node.right.type === 'Literal' && typeof node.left.value === 'number' && typeof node.right.value === 'number') {
        let foldedValue = null;
        switch (node.operator) {
            case '+': foldedValue = node.left.value + node.right.value; break;
            case '-': foldedValue = node.left.value - node.right.value; break;
            case '*': foldedValue = node.left.value * node.right.value; break;
            case '/': foldedValue = node.left.value / node.right.value; break;
            case '%': foldedValue = node.left.value % node.right.value; break;
            case '**': foldedValue = node.left.value ** node.right.value; break;
        }
        if (foldedValue !== null) {
            const constIndex = compiler.addConstant(foldedValue);
            compiler.emit(Opcode.PUSH_CONST);
            compiler.emit16(constIndex);
            return;
        }
    }
    compiler.visit(node.left);
    compiler.visit(node.right);
    switch (node.operator) {
        case '+': compiler.emit(Opcode.ADD); break;
        case '-': compiler.emit(Opcode.SUB); break;
        case '*': compiler.emit(Opcode.MUL); break;
        case '/': compiler.emit(Opcode.DIV); break;
        case '%': compiler.emit(Opcode.MOD); break;
        case '**': compiler.emit(Opcode.EXP); break;
        case '&': compiler.emit(Opcode.BITWISE_AND); break;
        case '|': compiler.emit(Opcode.BITWISE_OR); break;
        case '^': compiler.emit(Opcode.BITWISE_XOR); break;
        case '<<': compiler.emit(Opcode.LSHIFT); break;
        case '>>': compiler.emit(Opcode.RSHIFT); break;
        case '>>>': compiler.emit(Opcode.ZRSHIFT); break;
        case '==': compiler.emit(Opcode.EQUAL); break;
        case '===': compiler.emit(Opcode.STRICT_EQUAL); break;
        case '!=': compiler.emit(Opcode.NOT_EQUAL); break;
        case '!==': compiler.emit(Opcode.STRICT_NOT_EQUAL); break;
        case '>': compiler.emit(Opcode.GREATER_THAN); break;
        case '<': compiler.emit(Opcode.LESS_THAN); break;
        case '>=': compiler.emit(Opcode.GREATER_EQUAL); break;
        case '<=': compiler.emit(Opcode.LESS_EQUAL); break;
        case 'in': compiler.emit(Opcode.IN); break;
        case 'instanceof': compiler.emit(Opcode.INSTANCEOF); break;
        default: throw new Error(`Compiler error: Unsupported binary operator '${node.operator}'`);
    }
}

export function visitUnaryExpression(compiler: Compiler, node: any) {
    if (node.operator === 'delete') {
        if (node.argument.type === 'MemberExpression') {
            compiler.visit(node.argument.object);
            if (node.argument.computed) {
                compiler.visit(node.argument.property);
            } else {
                const constIndex = compiler.addConstant(node.argument.property.name);
                compiler.emit(Opcode.PUSH_CONST);
                compiler.emit16(constIndex);
            }
            compiler.emit(Opcode.DELETE_PROPERTY);
        } else if (node.argument.type === 'Identifier') {
            const resolution = compiler.resolveVariable(node.argument.name);
            if (resolution.type === 'global') {
                const constIndex = compiler.addConstant(node.argument.name);
                compiler.emit(Opcode.DELETE_GLOBAL);
                compiler.emit16(constIndex);
            } else {
                compiler.emit(Opcode.PUSH_FALSE);
            }
        } else {
            compiler.visit(node.argument);
            compiler.emit(Opcode.POP);
            compiler.emit(Opcode.PUSH_TRUE);
        }
        return;
    }
    if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
        const resolution = compiler.resolveVariable(node.argument.name);
        if (resolution.type === 'global') {
            const constIndex = compiler.addConstant(node.argument.name);
            compiler.emit(Opcode.TYPEOF_GLOBAL);
            compiler.emit16(constIndex);
            return;
        }
    }
    compiler.visit(node.argument);
    switch (node.operator) {
        case '-': compiler.emit(Opcode.NEGATE); break;
        case '!': compiler.emit(Opcode.NOT); break;
        case '~': compiler.emit(Opcode.BITWISE_NOT); break;
        case 'typeof': compiler.emit(Opcode.TYPEOF); break;
        case 'void': compiler.emit(Opcode.VOID); break;
        case '+': compiler.emit(Opcode.UNARY_PLUS); break;
        default: throw new Error(`Compiler error: Unsupported unary operator '${node.operator}'`);
    }
}

export function visitAssignmentExpression(compiler: Compiler, node: any) {
    if (node.left.type === 'MemberExpression') {
        if (node.operator === '=') {
            compiler.visit(node.left.object);
            if (node.left.computed) {
                compiler.visit(node.left.property);
                compiler.visit(node.right);
                compiler.emit(Opcode.SET_PROPERTY);
            } else {
                compiler.visit(node.right);
                const constIndex = compiler.addConstant(node.left.property.name);
                compiler.emit(Opcode.SET_NAMED_PROPERTY);
                compiler.emit16(constIndex);
                compiler.emit16(0xFFFF);
            }
        } else if (['??=', '||=', '&&='].includes(node.operator)) {
            throw new Error(`Compiler error: Logical compound assignment for MemberExpression is not supported yet.`);
        } else {
            compiler.visit(node.left.object);
            if (node.left.computed) {
                compiler.visit(node.left.property);
                compiler.emit(Opcode.DUP2);
                compiler.emit(Opcode.GET_PROPERTY);
                compiler.visit(node.right);
                switch (node.operator) {
                    case '+=': compiler.emit(Opcode.ADD); break;
                    case '-=': compiler.emit(Opcode.SUB); break;
                    case '*=': compiler.emit(Opcode.MUL); break;
                    case '/=': compiler.emit(Opcode.DIV); break;
                    case '%=': compiler.emit(Opcode.MOD); break;
                    case '**=': compiler.emit(Opcode.EXP); break;
                    case '&=': compiler.emit(Opcode.BITWISE_AND); break;
                    case '|=': compiler.emit(Opcode.BITWISE_OR); break;
                    case '^=': compiler.emit(Opcode.BITWISE_XOR); break;
                    case '<<=': compiler.emit(Opcode.LSHIFT); break;
                    case '>>=': compiler.emit(Opcode.RSHIFT); break;
                    case '>>>=': compiler.emit(Opcode.ZRSHIFT); break;
                    default: throw new Error(`Compiler error: Unsupported assignment operator '${node.operator}'`);
                }
                compiler.emit(Opcode.SET_PROPERTY);
            } else {
                const constIndex = compiler.addConstant(node.left.property.name);
                compiler.emit(Opcode.DUP);
                compiler.emit(Opcode.GET_NAMED_PROPERTY);
                compiler.emit16(constIndex);
                compiler.emit16(0xFFFF);
                compiler.visit(node.right);
                switch (node.operator) {
                    case '+=': compiler.emit(Opcode.ADD); break;
                    case '-=': compiler.emit(Opcode.SUB); break;
                    default: throw new Error(`Compiler error: Unsupported assignment operator '${node.operator}'`);
                }
                compiler.emit(Opcode.SET_NAMED_PROPERTY);
                compiler.emit16(constIndex);
                compiler.emit16(0xFFFF);
            }
        }
        return;
    }
    if (node.left.type !== 'Identifier') {
        throw new Error(`Compiler error: Unsupported assignment left-hand side type '${node.left.type}'.`);
    }
    const varName = node.left.name;
    const resolution = compiler.resolveVariable(varName);
    if (resolution.type === 'global') {
        const constIndex = compiler.addConstant(varName);
        if (node.operator === '=') {
            compiler.visit(node.right);
            compiler.emit(Opcode.STORE_GLOBAL);
            compiler.emit16(constIndex);
        } else if (['??=', '||=', '&&='].includes(node.operator)) {
            compiler.emit(Opcode.LOAD_GLOBAL);
            compiler.emit16(constIndex);
            compiler.emit(Opcode.DUP);
            if (node.operator === '??=') compiler.emit(Opcode.JUMP_IF_NOT_NULLISH);
            else if (node.operator === '||=') compiler.emit(Opcode.JUMP_IF_TRUE);
            else if (node.operator === '&&=') compiler.emit(Opcode.JUMP_IF_FALSE);
            const skipJump = compiler.emit16(0xFFFF);
            compiler.emit(Opcode.POP);
            compiler.visit(node.right);
            compiler.emit(Opcode.STORE_GLOBAL);
            compiler.emit16(constIndex);
            compiler.patch16(skipJump, compiler.bytecode.length - (skipJump + 2));
        } else {
            compiler.emit(Opcode.LOAD_GLOBAL);
            compiler.emit16(constIndex);
            compiler.visit(node.right);
            switch (node.operator) {
                case '+=': compiler.emit(Opcode.ADD); break;
                case '-=': compiler.emit(Opcode.SUB); break;
                case '*=': compiler.emit(Opcode.MUL); break;
                case '/=': compiler.emit(Opcode.DIV); break;
                case '%=': compiler.emit(Opcode.MOD); break;
                case '**=': compiler.emit(Opcode.EXP); break;
                case '&=': compiler.emit(Opcode.BITWISE_AND); break;
                case '|=': compiler.emit(Opcode.BITWISE_OR); break;
                case '^=': compiler.emit(Opcode.BITWISE_XOR); break;
                case '<<=': compiler.emit(Opcode.LSHIFT); break;
                case '>>=': compiler.emit(Opcode.RSHIFT); break;
                case '>>>=': compiler.emit(Opcode.ZRSHIFT); break;
                default: throw new Error(`Compiler error: Unsupported assignment operator '${node.operator}'`);
            }
            compiler.emit(Opcode.STORE_GLOBAL);
            compiler.emit16(constIndex);
        }
    } else {
        if (node.operator === '=') {
            compiler.visit(node.right);
            compiler.emitStoreVar(resolution);
        } else if (['??=', '||=', '&&='].includes(node.operator)) {
            compiler.emitLoadVar(resolution);
            compiler.emit(Opcode.DUP);
            if (node.operator === '??=') compiler.emit(Opcode.JUMP_IF_NOT_NULLISH);
            else if (node.operator === '||=') compiler.emit(Opcode.JUMP_IF_TRUE);
            else if (node.operator === '&&=') compiler.emit(Opcode.JUMP_IF_FALSE);
            const skipJump = compiler.emit16(0xFFFF);
            compiler.emit(Opcode.POP);
            compiler.visit(node.right);
            compiler.emitStoreVar(resolution);
            compiler.patch16(skipJump, compiler.bytecode.length - (skipJump + 2));
        } else {
            compiler.emitLoadVar(resolution);
            compiler.visit(node.right);
            switch (node.operator) {
                case '+=': compiler.emit(Opcode.ADD); break;
                case '-=': compiler.emit(Opcode.SUB); break;
                case '*=': compiler.emit(Opcode.MUL); break;
                case '/=': compiler.emit(Opcode.DIV); break;
                case '%=': compiler.emit(Opcode.MOD); break;
                case '**=': compiler.emit(Opcode.EXP); break;
                case '&=': compiler.emit(Opcode.BITWISE_AND); break;
                case '|=': compiler.emit(Opcode.BITWISE_OR); break;
                case '^=': compiler.emit(Opcode.BITWISE_XOR); break;
                case '<<=': compiler.emit(Opcode.LSHIFT); break;
                case '>>=': compiler.emit(Opcode.RSHIFT); break;
                case '>>>=': compiler.emit(Opcode.ZRSHIFT); break;
                default: throw new Error(`Compiler error: Unsupported assignment operator '${node.operator}'`);
            }
            compiler.emitStoreVar(resolution);
        }
    }
}

export function visitUpdateExpression(compiler: Compiler, node: any) {
    if (node.argument.type === 'MemberExpression') {
        const oneIndex = compiler.addConstant(1);
        compiler.visit(node.argument.object);
        if (node.argument.computed) {
            compiler.visit(node.argument.property);
            compiler.emit(Opcode.DUP2);
            compiler.emit(Opcode.GET_PROPERTY);
            compiler.emit(Opcode.UNARY_PLUS);
            compiler.emit(Opcode.PUSH_CONST);
            compiler.emit16(oneIndex);
            if (node.operator === '++') compiler.emit(Opcode.ADD);
            else compiler.emit(Opcode.SUB);
            compiler.emit(Opcode.SET_PROPERTY);
        } else {
            const constIndex = compiler.addConstant(node.argument.property.name);
            compiler.emit(Opcode.DUP);
            compiler.emit(Opcode.GET_NAMED_PROPERTY);
            compiler.emit16(constIndex);
            compiler.emit16(0xFFFF);
            compiler.emit(Opcode.UNARY_PLUS);
            compiler.emit(Opcode.PUSH_CONST);
            compiler.emit16(oneIndex);
            if (node.operator === '++') compiler.emit(Opcode.ADD);
            else compiler.emit(Opcode.SUB);
            compiler.emit(Opcode.SET_NAMED_PROPERTY);
            compiler.emit16(constIndex);
            compiler.emit16(0xFFFF);
        }
        if (!node.prefix) {
            compiler.emit(Opcode.PUSH_CONST);
            compiler.emit16(oneIndex);
            if (node.operator === '++') {
                compiler.emit(Opcode.SUB);
            } else {
                compiler.emit(Opcode.ADD);
            }
        }
        return;
    }
    if (node.argument.type !== 'Identifier') {
        throw new Error(`Compiler error: UpdateExpression with '${node.argument.type}' is not supported yet.`);
    }
    const varName = node.argument.name;
    const resolution = compiler.resolveVariable(varName);
    if (resolution.type === 'global') {
        const constIndex = compiler.addConstant(varName);
        compiler.emit(Opcode.LOAD_GLOBAL);
        compiler.emit16(constIndex);
        compiler.emit(Opcode.UNARY_PLUS);
        if (!node.prefix) compiler.emit(Opcode.DUP);
        const oneIndex = compiler.addConstant(1);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(oneIndex);
        if (node.operator === '++') compiler.emit(Opcode.ADD);
        else compiler.emit(Opcode.SUB);
        compiler.emit(Opcode.STORE_GLOBAL);
        compiler.emit16(constIndex);
        if (!node.prefix) compiler.emit(Opcode.POP);
    } else {
        compiler.emitLoadVar(resolution);
        compiler.emit(Opcode.UNARY_PLUS);
        if (!node.prefix) compiler.emit(Opcode.DUP);
        const oneConstIndex = compiler.addConstant(1);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(oneConstIndex);
        if (node.operator === '++') compiler.emit(Opcode.ADD);
        else if (node.operator === '--') compiler.emit(Opcode.SUB);
        else throw new Error(`Compiler error: Unsupported update operator '${node.operator}'`);
        compiler.emitStoreVar(resolution);
        if (!node.prefix) compiler.emit(Opcode.POP);
    }
}

export function visitLogicalExpression(compiler: Compiler, node: any) {
    compiler.visit(node.left);
    compiler.emit(Opcode.DUP);
    if (node.operator === '&&') {
        compiler.emit(Opcode.JUMP_IF_FALSE);
        const endJumpPos = compiler.emit16(0xFFFF);
        compiler.emit(Opcode.POP);
        compiler.visit(node.right);
        compiler.patch16(endJumpPos, compiler.bytecode.length - (endJumpPos + 2));
    } else if (node.operator === '||') {
        compiler.emit(Opcode.JUMP_IF_TRUE);
        const endJumpPos = compiler.emit16(0xFFFF);
        compiler.emit(Opcode.POP);
        compiler.visit(node.right);
        compiler.patch16(endJumpPos, compiler.bytecode.length - (endJumpPos + 2));
    } else if (node.operator === '??') {
        compiler.emit(Opcode.JUMP_IF_NOT_NULLISH);
        const endJumpPos = compiler.emit16(0xFFFF);
        compiler.emit(Opcode.POP);
        compiler.visit(node.right);
        compiler.patch16(endJumpPos, compiler.bytecode.length - (endJumpPos + 2));
    } else {
        throw new Error(`Compiler error: Unsupported logical operator '${node.operator}'`);
    }
}

export function visitConditionalExpression(compiler: Compiler, node: any) {
    compiler.visit(node.test);
    compiler.emit(Opcode.JUMP_IF_FALSE);
    const ifJump = compiler.emit16(0xFFFF);
    compiler.visit(node.consequent);
    compiler.emit(Opcode.JUMP);
    const elseJump = compiler.emit16(0xFFFF);
    compiler.patch16(ifJump, compiler.bytecode.length - (ifJump + 2));
    compiler.visit(node.alternate);
    compiler.patch16(elseJump, compiler.bytecode.length - (elseJump + 2));
}

export function visitSequenceExpression(compiler: Compiler, node: any) {
    const expressions = node.expressions;
    for (let i = 0; i < expressions.length; i++) {
        compiler.visit(expressions[i]);
        if (i < expressions.length - 1) {
            compiler.emit(Opcode.POP);
        }
    }
}

export function visitMemberExpression(compiler: Compiler, node: any) {
    if (node.object.type === 'Super') {
        throw new Error("Compiler error: Getting super properties without calling them is not supported yet.");
    }
    compiler.visit(node.object);
    if (node.optional) {
        compiler.emit(Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT);
        const jump = compiler.emit16(0xFFFF);
        if (compiler.currentChainJumps.length > 0) {
            compiler.currentChainJumps[compiler.currentChainJumps.length - 1].push(jump);
        } else {
            throw new Error("Compiler error: Optional chaining outside of ChainExpression");
        }
    }
    if (node.computed) {
        compiler.visit(node.property);
        compiler.emit(Opcode.GET_PROPERTY);
    } else {
        const constIndex = compiler.addConstant(node.property.name);
        compiler.emit(Opcode.GET_NAMED_PROPERTY);
        compiler.emit16(constIndex);
        compiler.emit16(0xFFFF);
    }
}

export function visitCallExpression(compiler: Compiler, node: any) {
    if (node.callee.type === 'Super') {
        if (!compiler.currentSuperClass) throw new Error("SyntaxError: 'super()' is only valid in derived class constructors.");
        node.arguments.forEach((arg: any) => compiler.visit(arg));
        const resolution = compiler.resolveVariable(compiler.currentSuperClass.name);
        if (resolution.type === 'global') {
            const constIndex = compiler.addConstant(compiler.currentSuperClass.name);
            compiler.emit(Opcode.LOAD_GLOBAL);
            compiler.emit16(constIndex);
        } else {
            compiler.emitLoadVar(resolution);
        }
        const thisRes = compiler.resolveVariable('this');
        if (thisRes.type !== 'local') throw new Error("SyntaxError: 'super' is not allowed in this context.");
        compiler.emitLoadVar(thisRes);
        compiler.emit(Opcode.SUPER_CONSTRUCTOR);
        compiler.emit(node.arguments.length);
        return;
    }
    const hasSpread = node.arguments.some((arg: any) => arg.type === 'SpreadElement');
    const isMemberCall = node.callee.type === 'MemberExpression' && !node.callee.optional && !node.optional;
    if (isMemberCall) {
        if (node.callee.object.type === 'Super') {
            if (!compiler.currentSuperClass) throw new Error("SyntaxError: 'super' is only valid in derived class methods.");
            const thisRes = compiler.resolveVariable('this');
            if (thisRes.type !== 'local') throw new Error("SyntaxError: 'super' is not allowed in this context.");
            compiler.emitLoadVar(thisRes);
            node.arguments.forEach((arg: any) => compiler.visit(arg));
            const resolution = compiler.resolveVariable(compiler.currentSuperClass.name);
            if (resolution.type === 'global') {
                const constIndex = compiler.addConstant(compiler.currentSuperClass.name);
                compiler.emit(Opcode.LOAD_GLOBAL);
                compiler.emit16(constIndex);
            } else {
                compiler.emitLoadVar(resolution);
            }
            const methodName = node.callee.property.name;
            const nameIndex = compiler.addConstant(methodName);
            compiler.emit(Opcode.INVOKE_SUPER);
            compiler.emit16(nameIndex);
            compiler.emit(node.arguments.length);
            return;
        }
        compiler.visit(node.callee.object);
        if (node.callee.computed) throw new Error("Compiler error: Computed method calls not supported yet.");
        const methodName = node.callee.property.name;
        const nameIndex = compiler.addConstant(methodName);
        if (hasSpread) {
            compiler.emit(Opcode.MAKE_ARRAY);
            compiler.emit16(0);
            for (let i = 0; i < node.arguments.length; i++) {
                const arg = node.arguments[i];
                if (arg.type === 'SpreadElement') {
                    compiler.visit(arg.argument);
                    compiler.emit(Opcode.ARRAY_APPEND_SPREAD);
                } else {
                    compiler.visit(arg);
                    compiler.emit(Opcode.ARRAY_APPEND);
                }
            }
            compiler.emit(Opcode.INVOKE_SPREAD);
            compiler.emit16(nameIndex);
        } else {
            node.arguments.forEach((arg: any) => compiler.visit(arg));
            compiler.emit(Opcode.INVOKE);
            compiler.emit16(nameIndex);
            compiler.emit(node.arguments.length);
        }
        return;
    }
    if (hasSpread) {
        compiler.visit(node.callee);
        if (node.optional) {
            compiler.emit(Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT);
            const jump = compiler.emit16(0xFFFF);
            if (compiler.currentChainJumps.length > 0) {
                compiler.currentChainJumps[compiler.currentChainJumps.length - 1].push(jump);
            } else {
                throw new Error("Compiler error: Optional chaining outside of ChainExpression");
            }
        }
        compiler.emit(Opcode.MAKE_ARRAY);
        compiler.emit16(0);
        for (let i = 0; i < node.arguments.length; i++) {
            const arg = node.arguments[i];
            if (arg.type === 'SpreadElement') {
                compiler.visit(arg.argument);
                compiler.emit(Opcode.ARRAY_APPEND_SPREAD);
            } else {
                compiler.visit(arg);
                compiler.emit(Opcode.ARRAY_APPEND);
            }
        }
        compiler.emit(Opcode.CALL_SPREAD);
    } else {
        compiler.visit(node.callee);
        if (node.optional) {
            compiler.emit(Opcode.JUMP_IF_NULLISH_SHORT_CIRCUIT);
            const jump = compiler.emit16(0xFFFF);
            if (compiler.currentChainJumps.length > 0) {
                compiler.currentChainJumps[compiler.currentChainJumps.length - 1].push(jump);
            } else {
                throw new Error("Compiler error: Optional chaining outside of ChainExpression");
            }
        }
        node.arguments.forEach((arg: any) => compiler.visit(arg));
        compiler.emit(Opcode.CALL);
        compiler.emit(node.arguments.length);
    }
}

export function visitNewExpression(compiler: Compiler, node: any) {
    const hasSpread = node.arguments.some((arg: any) => arg.type === 'SpreadElement');
    if (hasSpread) {
        compiler.visit(node.callee);
        compiler.emit(Opcode.MAKE_ARRAY);
        compiler.emit16(0);
        for (let i = 0; i < node.arguments.length; i++) {
            const arg = node.arguments[i];
            if (arg.type === 'SpreadElement') {
                compiler.visit(arg.argument);
                compiler.emit(Opcode.ARRAY_APPEND_SPREAD);
            } else {
                compiler.visit(arg);
                compiler.emit(Opcode.ARRAY_APPEND);
            }
        }
        compiler.emit(Opcode.NEW_SPREAD);
    } else {
        compiler.visit(node.callee);
        node.arguments.forEach((arg: any) => compiler.visit(arg));
        compiler.emit(Opcode.NEW);
        compiler.emit(node.arguments.length);
    }
}