import WebSocket, { WebSocketServer } from "ws";
import { VM } from "../vm/vm.js";
import { Parser } from "../parser/parser.js";
import { Compiler } from "../compiler/compiler.js";

export enum ClientPacketIds {
    Handshake,
    CompileAndRunCode
};
export enum ServerPacketIds {
    WriteCompiledOutput,
    WriteCompiledOutputError
}

export class SocketServer {
    
    private wsServer: WebSocketServer;

    public constructor() {

        this.wsServer = new WebSocketServer({
            port: 8080,
        });

        this.wsServer.addListener("connection", (socketClient: WebSocket, request: any) => {
            socketClient.binaryType = 'arraybuffer';

            socketClient.on('message', function (data, binary) {

                //@ts-ignore
                const jsonPacket = JSON.parse(data);

                console.log(jsonPacket);

                switch(jsonPacket[0]) {
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

                        }catch(ex) {
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