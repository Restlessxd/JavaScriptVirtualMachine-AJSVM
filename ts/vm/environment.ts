export class Environment {
    public variables: any[] = new Array(32);
    public isCaptured: boolean = false; // Флаг: было ли это окружение захвачено замыканием

    constructor(public outer: Environment | null = null) {}

    get(hops: number, index: number): any {
        let env: Environment = this;
        for (let i = 0; i < hops; i++) {
            env = env.outer!;
        }
        return env.variables[index];
    }

    set(hops: number, index: number, value: any) {
        let env: Environment = this;
        for (let i = 0; i < hops; i++) {
            env = env.outer!;
        }
        env.variables[index] = value;
    }
}