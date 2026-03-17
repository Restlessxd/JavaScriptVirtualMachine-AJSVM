import { Environment } from './environment.js';

export interface VmFunction {
    type: 'function';
    name: string;
    arity: number;
    hasRest: boolean;
    isAsync: boolean;
    isGenerator: boolean;
    bytecode: Uint8Array;
    wordcode: Int32Array;
    lineMap: Uint16Array;
    profileCounts: Uint32Array;
}

export interface VmClosure {
    type: 'closure';
    func: VmFunction;
    env: Environment;
}

export interface CatchHandler {
    catchIp: number;
    stackDepth: number;
}