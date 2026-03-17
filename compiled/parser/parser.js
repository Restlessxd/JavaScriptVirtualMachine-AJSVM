import * as acorn from 'acorn';
export class Parser {
    parse(source) {
        return acorn.parse(source, {
            ecmaVersion: 'latest',
            sourceType: 'module'
        });
    }
}
