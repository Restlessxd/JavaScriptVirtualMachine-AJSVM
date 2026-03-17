import { VM } from './vm.js';
import { Environment } from './environment.js';

export class ExceptionHandler {
    constructor(private vm: VM) {}

    public handleException(exception: any, targetFrameCount: number): boolean {
        while (this.vm.fp >= targetFrameCount) {
            const currentFrame = this.vm.frames[this.vm.fp];
            if (currentFrame.catchHandlers.length > 0) {
                const handler = currentFrame.catchHandlers.pop()!;
                this.vm.sp = handler.stackDepth;
                currentFrame.ip = handler.catchIp;
                this.vm.stack[this.vm.sp++] = exception;
                return true;
            }
            if (currentFrame.env.isCaptured) currentFrame.env = new Environment(null);
            this.vm.sp = currentFrame.basePointer;
            this.vm.fp--;
        }
        return false;
    }
}