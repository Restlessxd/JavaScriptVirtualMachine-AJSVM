export class Environment {
    outer;
    variables = new Array(32);
    isCaptured = false; // Флаг: было ли это окружение захвачено замыканием
    constructor(outer = null) {
        this.outer = outer;
    }
    get(hops, index) {
        let env = this;
        for (let i = 0; i < hops; i++) {
            env = env.outer;
        }
        return env.variables[index];
    }
    set(hops, index, value) {
        let env = this;
        for (let i = 0; i < hops; i++) {
            env = env.outer;
        }
        env.variables[index] = value;
    }
}
