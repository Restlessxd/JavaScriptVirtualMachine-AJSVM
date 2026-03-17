export function isCompiledFunction(c) {
    return c && typeof c === 'object' && c.type === 'function';
}
export var CompilerLogLevel;
(function (CompilerLogLevel) {
    CompilerLogLevel[CompilerLogLevel["NONE"] = 0] = "NONE";
    CompilerLogLevel[CompilerLogLevel["INFO"] = 1] = "INFO";
    CompilerLogLevel[CompilerLogLevel["DEBUG"] = 2] = "DEBUG";
    CompilerLogLevel[CompilerLogLevel["TRACE"] = 3] = "TRACE";
})(CompilerLogLevel || (CompilerLogLevel = {}));
