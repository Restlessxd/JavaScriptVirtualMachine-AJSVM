import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Compiler } from './compiler/compiler.js';
import { Parser } from './parser/parser.js';
import { VM } from './vm/vm.js';

const runVM = (code: string): VM => {
    const parser = new Parser();
    const compiler = new Compiler();
    const ast = parser.parse(code);
    const bytecode = compiler.compile(ast);
    const vm = new VM(bytecode);
    vm.run();
    return vm;
};

describe('AJSVM Integration Tests', () => {
    
    // "Шпионим" за методами console, чтобы перехватывать их вызовы
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Перед каждым тестом очищаем историю вызовов
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // После всех тестов восстанавливаем оригинальные методы console
    afterAll(() => {
        vi.restoreAllMocks();
    });

    describe('Literals', () => {
        it('should handle numbers', () => {
            runVM('console.log(5);');
            expect(logSpy).toHaveBeenCalledWith(5);
        });

        it('should handle booleans', () => {
            runVM('console.log(true); console.log(false);');
            expect(logSpy).toHaveBeenCalledWith(true);
            expect(logSpy).toHaveBeenCalledWith(false);
        });

        it('should handle null', () => {
            runVM('console.log(null);');
            expect(logSpy).toHaveBeenCalledWith(null);
        });

        it('should handle strings', () => {
            runVM('console.log("hello world");');
            expect(logSpy).toHaveBeenCalledWith("hello world");
        });
    });

    describe('Strings and Template Literals', () => {
        it('should handle template literals', () => {
            const code = `
                let name = "VM";
                let ver = 2;
                console.log(\`Hello \${name}, version \${ver + 1}!\`);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("Hello VM, version 3!");
        });

        it('should handle native string methods', () => {
            runVM('let s = "hello"; console.log(s.toUpperCase(), s.indexOf("e"));');
            expect(logSpy).toHaveBeenCalledWith("HELLO", 1);
        });
    });

    describe('Arithmetic and Unary Operations', () => {
        it('should perform complex arithmetic with correct order of operations', () => {
            runVM('console.log(5 + 2 * 10 - (8 / 4) ** 2);'); // 5 + 20 - 2**2 = 25 - 4 = 21
            expect(logSpy).toHaveBeenCalledWith(21);
        });

        it('should handle unary minus and not', () => {
            runVM('console.log(-10, !true, !0);');
            expect(logSpy).toHaveBeenCalledWith(-10, false, true);
        });

        it('should handle typeof, void, unary plus and bitwise not', () => {
            const code = `
                let a = "text";
                console.log(typeof a, typeof 123, typeof true);
                console.log(typeof undeclaredVar);
                console.log(void 0, void(a));
                console.log(+"42", +"");
                console.log(~5);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, "string", "number", "boolean");
            expect(logSpy).toHaveBeenNthCalledWith(2, "undefined");
            expect(logSpy).toHaveBeenNthCalledWith(3, undefined, undefined);
            expect(logSpy).toHaveBeenNthCalledWith(4, 42, 0);
            expect(logSpy).toHaveBeenNthCalledWith(5, -6);
        });

        it('should correctly evaluate typeof for local variables, functions and uninitialized state', () => {
            const code = `
                let num = 42;
                let obj = { a: 1 };
                let arr = [1, 2];
                let uninit;
                function decl() {}

                console.log(typeof num, typeof obj, typeof arr);
                console.log(typeof decl, typeof uninit, typeof doesntExist);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, "number", "object", "object");
            expect(logSpy).toHaveBeenNthCalledWith(2, "function", "undefined", "undefined");
        });

        it('should handle bitwise operations', () => {
            const code = `
                console.log(10 & 3, 10 | 3, 10 ^ 3);
                console.log(10 << 1, -10 >> 1, -10 >>> 1);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 2, 11, 9);
            expect(logSpy).toHaveBeenNthCalledWith(2, 20, -5, 2147483643);
        });
    });

    describe('Variable Declaration and Assignment', () => {
        it('should declare, initialize and reassign a variable', () => {
            runVM('let x = 99; x = 101; console.log(x);');
            expect(logSpy).toHaveBeenCalledWith(101);
        });

        it('should handle various compound assignments', () => {
            runVM('let x = 10; x += 5; console.log(x);'); // 15
            expect(logSpy).toHaveBeenCalledWith(15);
            
            runVM('let y = 10; y *= 3; console.log(y);'); // 30
            expect(logSpy).toHaveBeenCalledWith(30);
        });

        it('should assign to new and existing global variables', () => {
            const code = `
                myGlobal = 10; // new global
                console.log(myGlobal);
                myGlobal += 5; // compound assignment
                console.log(myGlobal);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 10);
            expect(logSpy).toHaveBeenNthCalledWith(2, 15);
        });

        it('should handle bitwise compound assignments', () => {
            const code = `
                let a = 5; a &= 3;
                let b = 12; b |= 5;
                let c = 7; c ^= 2;
                console.log(a, b, c);
                
                let d = 10; d <<= 1;
                let e = -10; e >>= 1;
                let f = -10; f >>>= 1;
                console.log(d, e, f);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 1, 13, 5);
            expect(logSpy).toHaveBeenNthCalledWith(2, 20, -5, 2147483643);
        });

        it('should handle array and object destructuring with default values', () => {
            const code = `
                let [a, b, c = 3] = [10, 20];
                let { x, y: z, w = 42 } = { x: 1, y: 2 };
                console.log(a, b, c);
                console.log(x, z, w);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 10, 20, 3);
            expect(logSpy).toHaveBeenNthCalledWith(2, 1, 2, 42);
        });
        
        it('should handle nested destructuring', () => {
            const code = `
                let [{a: [b]}] = [{a: [99]}];
                console.log(b);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(99);
        });

        it('should handle rest elements in array destructuring', () => {
            const code = `
                let [first, ...rest] = [1, 2, 3, 4];
                console.log(first, rest[0], rest.length);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(1, 2, 3);
        });

        it('should handle rest elements in object destructuring', () => {
            const code = `
                let { x, ...rest } = { x: 1, y: 2, z: 3 };
                console.log(x, rest.y, rest.z, rest.x);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(1, 2, 3, undefined);
        });

        it('should handle spread operator in array literals', () => {
            const code = `
                let arr1 = [1, 2];
                let arr2 = [0, ...arr1, 3, ...[4, 5]];
                console.log(arr2.length, arr2[1], arr2[4]);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(6, 1, 4);
        });
    });

    describe('Comparison and Logical Operations', () => {
        it('should handle comparison operators', () => {
            runVM('console.log(10 > 5, 10 < 5, 5 == 5, 5 != 6, 5 >= 5, 4 <= 5);');
            expect(logSpy).toHaveBeenCalledWith(true, false, true, true, true, true);
        });

        it('should handle strict comparison operators', () => {
            runVM('console.log(5 === 5, 5 === "5", 5 !== "5", null === undefined);');
            expect(logSpy).toHaveBeenCalledWith(true, false, true, false);
        });

        it('should handle logical AND (&&) with short-circuit', () => {
            runVM('console.log(false && console.log("fail"));');
            expect(logSpy).toHaveBeenCalledWith(false);
            expect(logSpy).toHaveBeenCalledTimes(1); // "fail" не должен был вызваться
        });

        it('should handle logical OR (||) with short-circuit', () => {
            runVM('console.log("cat" || console.log("fail"));');
            expect(logSpy).toHaveBeenCalledWith("cat");
            expect(logSpy).toHaveBeenCalledTimes(1); // "fail" не должен был вызваться
        });

        it('should handle in and instanceof operators', () => {
            const code = `
                let obj = { a: 1 };
                let arr = [1, 2];
                let d = new Date();
                
                console.log("a" in obj, "b" in obj);
                console.log(0 in arr, 2 in arr);
                console.log(d instanceof Date, d instanceof Object, arr instanceof Array);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, true, false);
            expect(logSpy).toHaveBeenNthCalledWith(2, true, false);
            expect(logSpy).toHaveBeenNthCalledWith(3, true, true, true);
        });
    });

    describe('Nullish Coalescing and Optional Chaining', () => {
        it('should handle nullish coalescing (??)', () => {
            const code = `
                console.log(null ?? 1);
                console.log(undefined ?? 2);
                console.log(0 ?? 3);
                console.log("" ?? 4);
                console.log(false ?? 5);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 1);
            expect(logSpy).toHaveBeenNthCalledWith(2, 2);
            expect(logSpy).toHaveBeenNthCalledWith(3, 0);
            expect(logSpy).toHaveBeenNthCalledWith(4, "");
            expect(logSpy).toHaveBeenNthCalledWith(5, false);
        });

        it('should handle optional chaining (?.) for properties', () => {
            const code = `
                let obj = { a: { b: 42 } };
                console.log(obj?.a?.b);
                console.log(obj?.x?.y);
                console.log(null?.a);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 42);
            expect(logSpy).toHaveBeenNthCalledWith(2, undefined);
            expect(logSpy).toHaveBeenNthCalledWith(3, undefined);
        });

        it('should handle optional chaining (?.) for function calls', () => {
            const code = `
                let obj = { 
                    method: () => "called" 
                };
                console.log(obj.method?.());
                console.log(obj.missing?.());
                let fn = null;
                console.log(fn?.());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, "called");
            expect(logSpy).toHaveBeenNthCalledWith(2, undefined);
            expect(logSpy).toHaveBeenNthCalledWith(3, undefined);
        });

        it('should handle logical nullish assignment (??=, ||=, &&=)', () => {
            const code = `
                let a = null; a ??= 10;
                let b = 0;    b ??= 20;
                let c = 0;    c ||= 30;
                let d = 1;    d &&= 40;
                console.log(a, b, c, d);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(10, 0, 30, 40);
        });
    });

    describe('Control Flow (if/else)', () => {
        it('should execute the `then` block of an if statement', () => {
            runVM('if (10 > 5) { console.log("then"); }');
            expect(logSpy).toHaveBeenCalledWith("then");
        });

        it('should execute the `else` block', () => {
            runVM('if (10 < 5) { console.log("then"); } else { console.log("else"); }');
            expect(logSpy).toHaveBeenCalledWith("else");
        });

        it('should handle nested if statements', () => {
            runVM('let a = true; let b = false; if (a) { if (!b) { console.log("nested"); } }');
            expect(logSpy).toHaveBeenCalledWith("nested");
        });

        it('should respect block scope for variables (shadowing)', () => {
            const code = `
                let x = 1;
                if (true) {
                    let x = 2;
                    console.log(x); // Should log the inner x
                }
                console.log(x); // Should log the outer x
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(2);
            expect(logSpy).toHaveBeenCalledWith(1);
        });

        it('should throw a run-time error for out-of-scope access', () => {
            const code = `if (true) { let b = 1; } console.log(b);`;
            // Ошибка выбрасывается ВМ во время выполнения, а не компилятором.
            expect(() => runVM(code)).toThrow('b is not defined');
        });

        it('should evaluate conditional (ternary) expressions', () => {
            const code = `
                let a = true ? 1 : 2;
                let b = false ? 3 : 4;
                let c = 10 > 5 ? "yes" : "no";
                console.log(a, b, c);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(1, 4, "yes");
        });

        it('should short-circuit conditional expressions', () => {
            const code = `
                true ? console.log("true branch") : console.log("false branch");
                false ? console.log("true branch") : console.log("false branch");
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, "true branch");
            expect(logSpy).toHaveBeenNthCalledWith(2, "false branch");
            expect(logSpy).toHaveBeenCalledTimes(2); // "false branch" первого и "true branch" второго не должны быть вызваны
        });

        it('should handle switch statements with fallthrough and default', () => {
            const code = `
                function testSwitch(val) {
                    let result = "";
                    switch (val) {
                        case 1:
                            result += "one";
                            break;
                        case 2:
                        case 3:
                            result += "twothree";
                            // fallthrough (проваливание)
                        case 4:
                            result += "four";
                            break;
                        default:
                            result += "def";
                    }
                    return result;
                }
                console.log(testSwitch(1), testSwitch(3), testSwitch(5));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("one", "twothreefour", "def");
        });
    });

    describe('Loops', () => {
        it('should execute while loops', () => {
            const code = `
                let i = 0;
                let sum = 0;
                while (i < 5) {
                    sum += i;
                    i += 1;
                }
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(10); // 0+1+2+3+4 = 10
        });

        it('should execute do...while loops', () => {
            const code = `
                let sum = 0;
                let i = 0;
                do {
                    sum += i;
                    i += 1;
                } while (i < 5);
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(10); // 0+1+2+3+4 = 10
        });

        it('should execute do...while loop at least once even if condition is false', () => {
            const code = `
                let val = 0;
                do {
                    val = 42;
                } while (false);
                console.log(val);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(42);
        });

        it('should execute for loops', () => {
            const code = `
                let sum = 0;
                for (let i = 1; i <= 5; i += 1) {
                    sum += i;
                }
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(15); // 1+2+3+4+5 = 15
        });

        it('should handle break in loops', () => {
            const code = `
                let sum = 0;
                for (let i = 0; i < 10; i++) {
                    if (i == 5) {
                        break;
                    }
                    sum += i;
                }
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(10); // 0+1+2+3+4 = 10
        });

        it('should handle continue in loops', () => {
            const code = `
                let sum = 0;
                let i = 0;
                while (i < 5) {
                    if (i == 2) {
                        i++;
                        continue;
                    }
                    sum += i;
                    i++;
                }
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(8); // 0+1+3+4 = 8
        });

        it('should handle break and continue in do...while loops', () => {
            const code = `
                let sum = 0;
                let i = 0;
                do {
                    i++;
                    if (i === 2) continue;
                    if (i === 5) break;
                    sum += i;
                } while (i < 10);
                console.log(sum);
            `;
            runVM(code);
            // i=1 (sum=1), i=2 (continue), i=3 (sum=4), i=4 (sum=8), i=5 (break)
            expect(logSpy).toHaveBeenCalledWith(8);
        });

        it('should execute for...in loops over object keys', () => {
            const code = `
                let obj = { a: 10, b: 20 };
                let result = "";
                for (let key in obj) {
                    result += key + obj[key];
                }
                console.log(result);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("a10b20");
        });

        it('should execute for...of loops over iterable objects', () => {
            const code = `
                let arr = [1, 2, 3, 4];
                let sum = 0;
                for (let v of arr) {
                    if (v === 2) continue;
                    if (v === 4) break;
                    sum += v;
                }
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(4); // 1 + 3 = 4
        });

        it('should handle destructuring in for...of loops', () => {
            const code = `
                let entries = [[1, 10], [2, 20]];
                let sum = 0;
                for (let [k, v] of entries) {
                    sum += k + v;
                }
                console.log(sum);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(33);
        });
    });

    describe('Console Functions', () => {
        it('should call console.log with multiple arguments', () => {
            runVM('console.log("hello", 123, true);');
            expect(logSpy).toHaveBeenCalledWith("hello", 123, true);
        });

        it('should call console.log with no arguments', () => {
            runVM('console.log();');
            expect(logSpy).toHaveBeenCalledWith();
        });

        it('should call console.warn and console.error', () => {
            runVM('console.warn("warning!"); console.error("error!");');
            expect(warnSpy).toHaveBeenCalledWith("warning!");
            expect(errorSpy).toHaveBeenCalledWith("error!");
        });
    });

    describe('Sequence Expressions', () => {
        it('should execute all expressions in a sequence', () => {
            runVM('console.log("a"), console.log("b");');
            expect(logSpy).toHaveBeenCalledWith("a");
            expect(logSpy).toHaveBeenCalledWith("b");
        });

        it('should result in the value of the last expression', () => {
            runVM('let x = (10, 20, 30); console.log(x);');
            expect(logSpy).toHaveBeenCalledWith(30);
        });
    });

    describe('Functions', () => {
        it('should declare and call a simple function', () => {
            const code = `
                function sayHi() {
                    console.log("hi");
                }
                sayHi();
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("hi");
        });

        it('should return a value from a function', () => {
            const code = `
                function add(a, b) {
                    return a + b;
                }
                console.log(add(5, 8));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(13);
        });

        it('should handle implicit return (undefined)', () => {
            const code = `
                function doNothing() { }
                console.log(doNothing());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(undefined);
        });

        it('should handle recursion', () => {
            const code = `
                function fib(n) {
                    if (n < 2) { return n; }
                    return fib(n - 2) + fib(n - 1);
                }
                console.log(fib(10));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(55);
        });

        it('should hoist function declarations', () => {
            const code = `
                // Вызов до объявления
                sayHello();
                
                function sayHello() {
                    console.log("hoisted!");
                }
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("hoisted!");
        });

        it('should handle anonymous FunctionExpression as a return value', () => {
            const code = `
                let makeAdder = function(x) {
                    return function(y) {
                        return x + y;
                    };
                };
                let add5 = makeAdder(5);
                console.log(add5(2));
                console.log(add5(10));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 7);
            expect(logSpy).toHaveBeenNthCalledWith(2, 15);
        });

        it('should correctly handle `this` in normal functions and global scope', () => {
            const code = `
                function testThis() {
                    return this;
                }
                console.log(typeof this); // global scope
                console.log(typeof testThis()); // function scope
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("object");   // globalThis is an object
            expect(logSpy).toHaveBeenCalledWith("function"); // unresolved this fallbacks to closure
        });

        it('should correctly handle inherited `this` in arrow functions', () => {
            const code = `
                let obj = {
                    val: 42,
                    method: function() {
                        // arrow function should inherit 'this' from 'method'
                        let arrow = () => this.val;
                        return arrow();
                    }
                };
                console.log(obj.method());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(42);
        });

        it('should handle ArrowFunctionExpression with block and expression bodies', () => {
            const code = `
                let add = (a, b) => a + b;
                let square = x => { return x * x; };
                let getTrue = () => true;

                console.log(add(5, 7));
                console.log(square(4));
                console.log(getTrue());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 12);
            expect(logSpy).toHaveBeenNthCalledWith(2, 16);
            expect(logSpy).toHaveBeenNthCalledWith(3, true);
        });

        it('should pass VM closures as callbacks to native higher-order functions', () => {
            const code = `
                let arr = [10, 20, 30];
                let found = arr.find(e => e == 20);
                let mapped = arr.map(e => e * 2);
                console.log(found);
                console.log(mapped[0], mapped[1], mapped[2]);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 20);
            expect(logSpy).toHaveBeenNthCalledWith(2, 20, 40, 60);
        });

        it('should handle rest parameters in functions and flexible arity', () => {
            const code = `
                function sum(a, ...rest) {
                    let s = a;
                    for (let i = 0; i < rest.length; i++) {
                        s += rest[i];
                    }
                    return s;
                }
                console.log(sum(10, 20, 30));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(60);
        });

        it('should handle default parameters', () => {
            const code = `
                const stackCrusher = (n, acc = 1) => {
                    if (n <= 0) return acc;
                    return stackCrusher(n - 1, acc * 2);
                };
                console.log(stackCrusher(3));
                console.log(stackCrusher(3, 10));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 8);
            expect(logSpy).toHaveBeenNthCalledWith(2, 80);
        });

        it('should handle spread operator in function calls and new', () => {
            const code = `
                function sum(a, b, c, d) { return a + b + c + d; }
                let args = [20, 30];
                console.log(sum(10, ...args, 40));
                console.log(Math.max(...args, 50, ...[5, 100]));
                console.log(new Date(...[2024, 0, 1]).getFullYear());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 100);
            expect(logSpy).toHaveBeenNthCalledWith(2, 100);
            expect(logSpy).toHaveBeenNthCalledWith(3, 2024);
        });
    });

    describe('Arrays and Properties', () => {
        it('should create an array and access its elements and properties', () => {
            const code = `
                let arr = [10, 20, 30];
                console.log(arr[0]);
                console.log(arr[1] + arr[2]);
                console.log(arr.length);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 10);
            expect(logSpy).toHaveBeenNthCalledWith(2, 50);
            expect(logSpy).toHaveBeenNthCalledWith(3, 3);
        });

        it('should modify array elements via assignment', () => {
            const code = `
                let arr = [1, 2];
                arr[0] = 99;
                arr[1] = arr[0] + 1;
                console.log(arr[0], arr[1]);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(99, 100);
        });

        it('should call native array methods', () => {
            const code = `
                let arr = [1, 2, 3];
                arr.push(4);
                console.log(arr.length, arr.join("-"));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(4, "1-2-3-4");
        });
    });

    describe('Native Global Objects', () => {
        it('should call methods on global objects like Math, Array, Object', () => {
            const code = `
                let max = Math.max(10, 20, 5);
                let isArr = Array.isArray([1, 2]);
                let keys = Object.keys({ a: 1, b: 2 });
                console.log(max, isArr, keys.length);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(20, true, 2);
        });

        it('should create instances of native classes using new', () => {
            const code = `
                let d = new Date("2024-01-01T00:00:00Z");
                let m = new Map();
                m.set("key", 123);
                console.log(d.getFullYear(), m.get("key"));
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(2024, 123);
        });

        it('should handle instances like Promise with VM closure callbacks', async () => {
            const code = `
                let p = new Promise(resolve => {
                    resolve(42);
                });
                p.then(val => console.log("Promise resolved with", val));
            `;
            runVM(code);
            
            // Ждем выполнения микротасок (resolve промиса)
            await new Promise(r => setTimeout(r, 0));
            expect(logSpy).toHaveBeenCalledWith("Promise resolved with", 42);
        });
    });

    describe('Exceptions (try...catch)', () => {
        it('should catch manually thrown exceptions', () => {
            const code = `
                try {
                    throw "MyError";
                } catch (e) {
                    console.log("Caught:", e);
                }
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("Caught:", "MyError");
        });

        it('should unwind the call stack on exception', () => {
            const code = `
                function b() { throw "DeepError"; }
                function a() { b(); }
                
                try {
                    a();
                    console.log("Unreachable");
                } catch (e) {
                    console.log(e);
                }
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("DeepError");
            expect(logSpy).not.toHaveBeenCalledWith("Unreachable");
        });

        it('should correctly restore handlers when breaking out of try blocks', () => {
            const code = `
                let i = 0;
                while (i < 3) {
                    try {
                        if (i === 1) break;
                        throw "err" + i;
                    } catch (e) {
                        console.log(e);
                    }
                    i++;
                }
                console.log("done", i);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, "err0");
            expect(logSpy).toHaveBeenNthCalledWith(2, "done", 1);
        });

        it('should catch native JS exceptions generated inside the VM', () => {
            const code = `
                try { let obj = null; console.log(obj.foo); } 
                catch (e) { console.log(e.name); }
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("TypeError");
        });
    });

    describe('Objects', () => {
        it('should create an object and access/modify its properties', () => {
            const code = `
                let dynamicKey = "z";
                let obj = { x: 10, "y": 20, [dynamicKey]: 30 };
                
                console.log(obj.x);
                console.log(obj["y"]);
                console.log(obj.z);
                
                obj.newProp = obj.x + 5;
                console.log(obj.newProp);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 10);
            expect(logSpy).toHaveBeenNthCalledWith(2, 20);
            expect(logSpy).toHaveBeenNthCalledWith(3, 30);
            expect(logSpy).toHaveBeenNthCalledWith(4, 15);
        });

        it('should handle spread operator in object literals', () => {
            const code = `
                let obj1 = { a: 1, b: 2 };
                let obj2 = { c: 3, ...obj1, b: 4, ...{ d: 5, ...null } };
                console.log(obj2.a, obj2.b, obj2.c, obj2.d);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(1, 4, 3, 5); // 4 перезаписывает 2 из obj1
        });

        it('should handle delete operator', () => {
            const code = `
                let obj = { x: 10, y: 20 };
                console.log(delete obj.x);
                console.log(obj.x);
                
                let dynamicProp = "y";
                console.log(delete obj[dynamicProp]);
                console.log(obj.y);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, true);
            expect(logSpy).toHaveBeenNthCalledWith(2, undefined);
            expect(logSpy).toHaveBeenNthCalledWith(3, true);
            expect(logSpy).toHaveBeenNthCalledWith(4, undefined);
        });

        it('should handle compound assignment and update expressions on properties', () => {
            const code = `
                let obj = { count: 0, val: 10 };
                obj.count++;
                ++obj.count;
                let oldVal = obj.val--;
                obj.count += 5;
                console.log(obj.count, obj.val, oldVal);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith(7, 9, 10);
        });
    });

    describe('Classes', () => {
        it('should declare a class, create an instance, and call its methods', () => {
            const code = `
                class Greeter {
                    constructor(name) {
                        this.name = "Mr. " + name;
                    }

                    greet() {
                        return "Hello, " + this.name;
                    }
                }

                let g = new Greeter("VM");
                console.log(g.greet(), g.name);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("Hello, Mr. VM", "Mr. VM");
        });

        it('should handle static methods and properties', () => {
            const code = `
                class MyClass {
                    static myProp = 42;

                    static myStaticMethod() {
                        return this.myProp;
                    }
                }

                console.log(MyClass.myProp);
                console.log(MyClass.myStaticMethod());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 42);
            expect(logSpy).toHaveBeenNthCalledWith(2, 42);
        });

        it('should handle class inheritance with extends and super()', () => {
            const code = `
                class Animal {
                    constructor(name) {
                        this.name = name;
                    }
                    speak() {
                        return this.name + ' makes a noise.';
                    }
                }

                class Dog extends Animal {
                    constructor(name) {
                        super(name); // call parent constructor
                    }

                    speak() {
                        return super.speak() + ' Woof!';
                    }
                }

                let d = new Dog('Rex');
                console.log(d.name, d.speak());
            `;
            runVM(code);
            expect(logSpy).toHaveBeenCalledWith("Rex", "Rex makes a noise. Woof!");
        });
    });

    describe('Stack Management', () => {
        it('should have a clean stack after running expression statements', () => {
            // Этот тест неявно проверяет, что `POP` работает корректно.
            // Если бы стек загрязнялся, `let x = 1` работал бы неправильно.
            runVM('5 + 10; "hello"; false; let x = 1; console.log(x);');
            expect(logSpy).toHaveBeenCalledWith(1);
        });
    });

    describe('Async/Await', () => {
        it('should handle async functions and await', async () => {
            const code = `
                async function fetchValue() { return 42; }
                async function main() {
                    let v = await fetchValue();
                    console.log("value is", v);
                }
                main();
            `;
            runVM(code);
            await new Promise(r => setTimeout(r, 0)); // Дожидаемся микрозадач
            expect(logSpy).toHaveBeenCalledWith("value is", 42);
        });

        it('should handle await with native promises', async () => {
            const code = `
                async function test() {
                    let res = await Promise.resolve("native");
                    console.log(res);
                }
                test();
            `;
            runVM(code);
            await new Promise(r => setTimeout(r, 0));
            expect(logSpy).toHaveBeenCalledWith("native");
        });

        it('should catch exceptions from awaited promises', async () => {
            const code = `async function test() { try { await Promise.reject("err"); } catch(e) { console.log("caught", e); } } test();`;
            runVM(code);
            await new Promise(r => setTimeout(r, 0));
            expect(logSpy).toHaveBeenCalledWith("caught", "err");
        });
    });

    describe('Generators', () => {
        it('should handle basic generator functions and yield', () => {
            const code = `
                function* gen() {
                    yield 1;
                    yield 2;
                    return 3;
                }
                const g = gen();
                console.log(g.next().value);
                console.log(g.next().value);
                console.log(g.next().value);
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, 1);
            expect(logSpy).toHaveBeenNthCalledWith(2, 2);
            expect(logSpy).toHaveBeenNthCalledWith(3, 3);
        });

        it('should pass values back into generator via next() and work in loops', () => {
            const code = `
                function* seq() {
                    let x = yield "A";
                    yield x * 2;
                }
                let g = seq();
                console.log(g.next().value); // "A"
                console.log(g.next(10).value); // 20
                
                for (let v of seq()) { console.log(v); }
            `;
            runVM(code);
            expect(logSpy).toHaveBeenNthCalledWith(1, "A");
            expect(logSpy).toHaveBeenNthCalledWith(2, 20);
            expect(logSpy).toHaveBeenNthCalledWith(3, "A"); // Начинается цикл
            expect(logSpy).toHaveBeenNthCalledWith(4, NaN); // Так как next() в цикле не передает аргументов, x = undefined
        });
    });

    describe('Async Generators and Iterators', () => {
        it('should handle async generators and for await...of', async () => {
            const code = `
                async function* asyncGen() {
                    yield await Promise.resolve(1);
                    yield 2;
                    yield await Promise.resolve(3);
                }
                
                async function main() {
                    let sum = 0;
                    for await (let val of asyncGen()) {
                        sum += val;
                    }
                    console.log("Async Sum:", sum);
                }
                main();
            `;
            runVM(code);
            await new Promise(r => setTimeout(r, 0)); // wait for promises
            expect(logSpy).toHaveBeenCalledWith("Async Sum:", 6);
        });

        it('should handle for await...of over sync iterables', async () => {
            const code = `
                async function main() {
                    let arr = [10, 20];
                    for await (let x of arr) {
                        console.log(x);
                    }
                }
                main();
            `;
            runVM(code);
            await new Promise(r => setTimeout(r, 0));
            expect(logSpy).toHaveBeenCalledWith(10);
            expect(logSpy).toHaveBeenCalledWith(20);
        });
    });
});