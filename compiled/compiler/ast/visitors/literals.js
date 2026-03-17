import { Opcode } from '../../../types.js';
export function visitLiteral(compiler, node) {
    if (typeof node.value === 'boolean') {
        compiler.emit(node.value ? Opcode.PUSH_TRUE : Opcode.PUSH_FALSE);
    }
    else if (node.value === null) {
        compiler.emit(Opcode.PUSH_NULL);
    }
    else if (typeof node.value === 'number' && Number.isInteger(node.value) && node.value >= -128 && node.value <= 127) {
        compiler.emit(Opcode.PUSH_INT8);
        compiler.emit(node.value < 0 ? node.value + 256 : node.value);
    }
    else {
        const constIndex = compiler.addConstant(node.value);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(constIndex);
    }
}
export function visitTemplateLiteral(compiler, node) {
    const firstQuasi = node.quasis[0].value.cooked;
    const firstIndex = compiler.addConstant(firstQuasi);
    compiler.emit(Opcode.PUSH_CONST);
    compiler.emit16(firstIndex);
    for (let i = 0; i < node.expressions.length; i++) {
        compiler.visit(node.expressions[i]);
        compiler.emit(Opcode.ADD);
        const nextQuasi = node.quasis[i + 1].value.cooked;
        const nextIndex = compiler.addConstant(nextQuasi);
        compiler.emit(Opcode.PUSH_CONST);
        compiler.emit16(nextIndex);
        compiler.emit(Opcode.ADD);
    }
}
export function visitArrayExpression(compiler, node) {
    const elements = node.elements;
    const hasSpread = elements.some((e) => e && e.type === 'SpreadElement');
    if (hasSpread) {
        compiler.emit(Opcode.MAKE_ARRAY);
        compiler.emit16(0);
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if (!element) {
                compiler.emit(Opcode.PUSH_UNDEFINED);
                compiler.emit(Opcode.ARRAY_APPEND);
            }
            else if (element.type === 'SpreadElement') {
                compiler.visit(element.argument);
                compiler.emit(Opcode.ARRAY_APPEND_SPREAD);
            }
            else {
                compiler.visit(element);
                compiler.emit(Opcode.ARRAY_APPEND);
            }
        }
    }
    else {
        for (let i = 0; i < elements.length; i++) {
            if (elements[i])
                compiler.visit(elements[i]);
            else
                compiler.emit(Opcode.PUSH_UNDEFINED);
        }
        compiler.emit(Opcode.MAKE_ARRAY);
        compiler.emit16(elements.length);
    }
}
export function visitObjectExpression(compiler, node) {
    const properties = node.properties;
    const hasSpread = properties.some((p) => p.type === 'SpreadElement');
    if (hasSpread) {
        compiler.emit(Opcode.MAKE_OBJECT);
        compiler.emit16(0);
        for (let i = 0; i < properties.length; i++) {
            const prop = properties[i];
            if (prop.type === 'SpreadElement') {
                compiler.visit(prop.argument);
                compiler.emit(Opcode.OBJECT_APPEND_SPREAD);
            }
            else {
                if (!prop.computed && prop.key.type === 'Identifier') {
                    const constIndex = compiler.addConstant(prop.key.name);
                    compiler.emit(Opcode.PUSH_CONST);
                    compiler.emit16(constIndex);
                }
                else if (!prop.computed && prop.key.type === 'Literal') {
                    const constIndex = compiler.addConstant(prop.key.value);
                    compiler.emit(Opcode.PUSH_CONST);
                    compiler.emit16(constIndex);
                }
                else {
                    compiler.visit(prop.key);
                }
                compiler.visit(prop.value);
                compiler.emit(Opcode.OBJECT_APPEND);
            }
        }
    }
    else {
        for (let i = 0; i < properties.length; i++) {
            const prop = properties[i];
            if (!prop.computed && prop.key.type === 'Identifier') {
                const constIndex = compiler.addConstant(prop.key.name);
                compiler.emit(Opcode.PUSH_CONST);
                compiler.emit16(constIndex);
            }
            else if (!prop.computed && prop.key.type === 'Literal') {
                const constIndex = compiler.addConstant(prop.key.value);
                compiler.emit(Opcode.PUSH_CONST);
                compiler.emit16(constIndex);
            }
            else {
                compiler.visit(prop.key);
            }
            compiler.visit(prop.value);
        }
        compiler.emit(Opcode.MAKE_OBJECT);
        compiler.emit16(properties.length);
    }
}
