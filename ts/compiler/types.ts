export interface CompiledFunction {
    type: 'function';
    name: string;
    arity: number;
    hasRest: boolean;
    isAsync: boolean;
    isGenerator: boolean;
    bytecode: Uint8Array;
}

export function isCompiledFunction(c: any): c is CompiledFunction {
    return c && typeof c === 'object' && c.type === 'function';
}

export enum CompilerLogLevel {
    NONE = 0,
    INFO = 1,
    DEBUG = 2,
    TRACE = 3
}