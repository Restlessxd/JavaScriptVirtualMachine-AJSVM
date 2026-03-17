import { MicroVMBuilder } from "./micro.vm.builder.js";
async function doBenchmark(code) {
    const { microVMCode } = await MicroVMBuilder.build(code, "./vm/vm.js", {
        ecmaVersion: 2022,
        filePath: null,
        shouldMinify: true,
        production: true
    });
    console.log(`/// Node.Js V8 Start  \\\\\\`);
    eval(code);
    console.log(`/// Node.Js V8 END  \\\\\\\n`);
    console.log(`/// AJSVM V1 Start \\\\\\`);
    eval(microVMCode);
    console.log(`/// AJSVM V1 END  \\\\\\\n`);
}
export async function runBenchmark() {
    await doBenchmark(`function sieve(limit) {
        const primes = new Uint8Array(limit + 1).fill(1);
        primes[0] = primes[1] = 0;
        for (let i = 2; i * i <= limit; i++) {
            if (primes[i]) {
                for (let j = i * i; j <= limit; j += i) 
                    primes[j] = 0;
            }
        }
        return primes.reduce((acc, val) => acc + val, 0);
    }

    const start = Date.now();
    const count = sieve(1000000);
    const end = Date.now();

    console.log(\`Найдено простых чисел: \${count}, Время: \${end - start}ms\`);`);
    await doBenchmark(`function mathBench(iterations) {
        let sum = 0;
        for (let i = 0; i < iterations; i++) {
            sum += (Math.sqrt(i) * Math.sin(i)) / (Math.cos(i) + 2);
        }
        return sum;
    }

    const start = Date.now();
    mathBench(500000);
    const end = Date.now();

    console.log(\`Математический цикл завершен за: \${end - start}ms\`);`);
    await doBenchmark(`function objectCreation() {
        let list = null;
        for (let i = 0; i < 100000; i++) {
            list = { value: i, next: list };
        }
        
        let sum = 0;
        while (list) {
            sum += list.value;
            list = list.next;
        }
        return sum;
    }

    const start = Date.now();
    objectCreation();
    const end = Date.now();

    console.log(\`Работа с объектами: \${end - start}ms\`);`);
    await doBenchmark(`function bubbleSort(arr) {
        let n = arr.length;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n - i - 1; j++) {
                if (arr[j] > arr[j + 1]) {
                    let temp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = temp;
                }
            }
        }
    }

    const data = Array.from({ length: 5000 }, () => Math.random());
    const start = Date.now();
    bubbleSort(data);
    const end = Date.now();

    console.log(\`Сортировка 5к элементов: \${end - start}ms\`);`);
}
