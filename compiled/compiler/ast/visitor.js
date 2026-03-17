import { visitBlock, visitExpressionStatement, visitIfStatement, visitWhileStatement, visitDoWhileStatement, visitForStatement, visitForInOfStatement, visitBreakStatement, visitContinueStatement, visitReturnStatement, visitThrowStatement, visitTryStatement, visitSwitchStatement } from './visitors/statements.js';
import { visitChainExpression, visitBinaryExpression, visitUnaryExpression, visitAssignmentExpression, visitUpdateExpression, visitLogicalExpression, visitConditionalExpression, visitSequenceExpression, visitCallExpression, visitNewExpression, visitMemberExpression } from './visitors/expressions.js';
import { visitFunctionDeclaration, visitFunctionExpression, visitArrowFunctionExpression, visitAwaitExpression, visitYieldExpression } from './visitors/functions.js';
import { visitClassDeclaration, visitClassBody, visitMethodDefinition, visitPropertyDefinition, visitSuper, visitThisExpression } from './visitors/classes.js';
import { visitLiteral, visitTemplateLiteral, visitArrayExpression, visitObjectExpression } from './visitors/literals.js';
import { visitVariableDeclaration, visitVariableDeclarator, visitIdentifier } from './visitors/variables.js';
export function visitNode(compiler, node) {
    if (!node || !node.type)
        return;
    switch (node.type) {
        case 'Program':
        case 'BlockStatement':
            visitBlock(compiler, node);
            break;
        case 'ExpressionStatement':
            visitExpressionStatement(compiler, node);
            break;
        case 'IfStatement':
            visitIfStatement(compiler, node);
            break;
        case 'WhileStatement':
            visitWhileStatement(compiler, node);
            break;
        case 'DoWhileStatement':
            visitDoWhileStatement(compiler, node);
            break;
        case 'ForStatement':
            visitForStatement(compiler, node);
            break;
        case 'ForInStatement':
        case 'ForOfStatement':
            visitForInOfStatement(compiler, node);
            break;
        case 'BreakStatement':
            visitBreakStatement(compiler, node);
            break;
        case 'ContinueStatement':
            visitContinueStatement(compiler, node);
            break;
        case 'ReturnStatement':
            visitReturnStatement(compiler, node);
            break;
        case 'ThrowStatement':
            visitThrowStatement(compiler, node);
            break;
        case 'TryStatement':
            visitTryStatement(compiler, node);
            break;
        case 'SwitchStatement':
            visitSwitchStatement(compiler, node);
            break;
        case 'BinaryExpression':
            visitBinaryExpression(compiler, node);
            break;
        case 'UnaryExpression':
            visitUnaryExpression(compiler, node);
            break;
        case 'AssignmentExpression':
            visitAssignmentExpression(compiler, node);
            break;
        case 'UpdateExpression':
            visitUpdateExpression(compiler, node);
            break;
        case 'LogicalExpression':
            visitLogicalExpression(compiler, node);
            break;
        case 'ConditionalExpression':
            visitConditionalExpression(compiler, node);
            break;
        case 'SequenceExpression':
            visitSequenceExpression(compiler, node);
            break;
        case 'CallExpression':
            visitCallExpression(compiler, node);
            break;
        case 'NewExpression':
            visitNewExpression(compiler, node);
            break;
        case 'MemberExpression':
            visitMemberExpression(compiler, node);
            break;
        case 'ChainExpression':
            visitChainExpression(compiler, node);
            break;
        case 'FunctionDeclaration':
            visitFunctionDeclaration(compiler, node);
            break;
        case 'FunctionExpression':
            visitFunctionExpression(compiler, node);
            break;
        case 'ArrowFunctionExpression':
            visitArrowFunctionExpression(compiler, node);
            break;
        case 'AwaitExpression':
            visitAwaitExpression(compiler, node);
            break;
        case 'YieldExpression':
            visitYieldExpression(compiler, node);
            break;
        case 'ClassDeclaration':
            visitClassDeclaration(compiler, node);
            break;
        case 'ClassBody':
            visitClassBody(compiler, node);
            break;
        case 'MethodDefinition':
            visitMethodDefinition(compiler, node);
            break;
        case 'PropertyDefinition':
            visitPropertyDefinition(compiler, node);
            break;
        case 'Super':
            visitSuper(compiler, node);
            break;
        case 'ThisExpression':
            visitThisExpression(compiler, node);
            break;
        case 'Literal':
            visitLiteral(compiler, node);
            break;
        case 'TemplateLiteral':
            visitTemplateLiteral(compiler, node);
            break;
        case 'ArrayExpression':
            visitArrayExpression(compiler, node);
            break;
        case 'ObjectExpression':
            visitObjectExpression(compiler, node);
            break;
        case 'VariableDeclaration':
            visitVariableDeclaration(compiler, node);
            break;
        case 'VariableDeclarator':
            visitVariableDeclarator(compiler, node);
            break;
        case 'Identifier':
            visitIdentifier(compiler, node);
            break;
        default:
            throw new Error(`Compiler error: Unsupported AST node type '${node.type}'`);
    }
}
