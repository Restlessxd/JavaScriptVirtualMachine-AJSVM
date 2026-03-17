import { WebSocketServer } from "ws";
import { Parser } from "../parser/parser.js";
import { Compiler } from "../compiler/compiler.js";
export var ClientPacketIds;
(function (ClientPacketIds) {
    ClientPacketIds[ClientPacketIds["Handshake"] = 0] = "Handshake";
    ClientPacketIds[ClientPacketIds["CompileAndRunCode"] = 1] = "CompileAndRunCode";
})(ClientPacketIds || (ClientPacketIds = {}));
;
export var ServerPacketIds;
(function (ServerPacketIds) {
    ServerPacketIds[ServerPacketIds["WriteCompiledOutput"] = 0] = "WriteCompiledOutput";
    ServerPacketIds[ServerPacketIds["WriteCompiledOutputError"] = 1] = "WriteCompiledOutputError";
})(ServerPacketIds || (ServerPacketIds = {}));
export class SocketServer {
    wsServer;
    constructor() {
        this.wsServer = new WebSocketServer({
            port: 8080,
        });
        this.wsServer.addListener("connection", (socketClient, request) => {
            socketClient.binaryType = 'arraybuffer';
            socketClient.on('message', function (data, binary) {
                //@ts-ignore
                const jsonPacket = JSON.parse(data);
                console.log(jsonPacket);
                switch (jsonPacket[0]) {
                    case ClientPacketIds.CompileAndRunCode: {
                        try {
                            const code = jsonPacket[1];
                            const parser = new Parser();
                            const ast = parser.parse(code);
                            const compiler = new Compiler();
                            const compiled = compiler.compile(ast);
                            const byteCode = compiled;
                            const byteCodeLength = compiled.length;
                            socketClient.send(JSON.stringify([
                                ServerPacketIds.WriteCompiledOutput,
                                Array.from(byteCode),
                                byteCodeLength
                            ]));
                        }
                        catch (ex) {
                            socketClient.send(JSON.stringify([
                                ServerPacketIds.WriteCompiledOutputError,
                                ex
                            ]));
                        }
                        break;
                    }
                }
            });
        });
    }
}
