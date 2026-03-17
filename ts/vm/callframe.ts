import { Environment } from './environment.js';
import { CatchHandler, VmClosure } from './vm.types.js';

export class CallFrame {
    public ip: number = 0;
    public catchHandlers: CatchHandler[] = [];

    constructor(
        public closure: VmClosure,
        public env: Environment,
        public basePointer: number,
        public isConstructorCall: boolean = false,
        public constructedInstance: any = null
    ) {}
}