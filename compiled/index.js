import * as fs from 'fs';
import { VM } from "./vm/vm.js";
import { MicroVMBuilder } from "./micro.vm.builder.js";
import { fileURLToPath } from "url";
import { dirname as pathDirname, resolve } from "path";
import { Compiler, CompilerLogLevel } from "./compiler/compiler.js";
import { Parser } from "./parser/parser.js";
export const _dirname = pathDirname(fileURLToPath(import.meta.url));
/**
 * Можно раскомментировать для наглядности скорости работы
 */
// runBenchmark();
/**
 * Когда нибудь я допишу полностью фронтенд и тогда включать сервер будет иметь смысл.
 */
//export const network = new SocketServer();
let inFile = null;
let outFile = null;
// Простой парсинг аргументов командной строки
for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--in=')) {
        inFile = arg.substring('--in='.length).replace(/^["']|["']$/g, '');
    }
    else if (arg.startsWith('--out=')) {
        outFile = arg.substring('--out='.length).replace(/^["']|["']$/g, '');
    }
}
const run = async () => {
    let jsCode = `console.log("Hello, world!");`;
    // если in есть, читаем вход
    if (inFile) {
        try {
            jsCode = fs.readFileSync(resolve(inFile), 'utf-8');
            console.log(`Loaded source from ${inFile}`);
        }
        catch (err) {
            console.error(`Error reading input file ${inFile}:`, err);
            return;
        }
    }
    else {
        console.log("No --in argument provided. Using default code.");
    }
    // если указан параметр --out, билдим vm монолит
    if (outFile) {
        console.log(`Building VM to ${outFile}...`);
        await MicroVMBuilder.build(jsCode, "./vm/vm.js", {
            ecmaVersion: 2022,
            filePath: resolve(outFile),
            shouldMinify: true,
            production: true
        });
        console.log(`Build complete. Output saved to ${outFile}`);
    }
    else {
        // иначе просто компилируем и запускаем код напрямую
        const ast = new Parser().parse(jsCode);
        const compiler = new Compiler('script', [], null, CompilerLogLevel.TRACE);
        const bytecode = compiler.compile(ast);
        console.log(`\nOriginal JS Code:\n${jsCode}\n`);
        console.log(`Compiled VM Bytecode:\n${bytecode.join(', ')}\n`);
        console.log(`Compiled VM Output:`);
        const vm = new VM(bytecode);
        vm.run();
    }
};
run();
