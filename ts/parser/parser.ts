import * as acorn from 'acorn';

export class Parser {
  public parse(source: string): acorn.Node {
    return acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module'
    });
  }
}