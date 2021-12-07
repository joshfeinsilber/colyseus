import http from "http";
import querystring from "querystring";
import url from "url";
import WebSocket, { ServerOptions } from "ws";
import { matchMaker, Transport, debugAndPrintError } from "@colyseus/core";
import * as socket from "socket.io";
import { SocketIOClient } from "./SocketIOClient";

export interface TransportOptions extends ServerOptions {
  /**
   * how many ms without a pong packet to consider the connection closed
   * @default 20000
   */
  pingTimeout?: number;
  /**
   * how many ms before sending a new ping packet
   * @default 25000
   */
  pingInterval?: number;
  /**
   * how many bytes or characters a message can be, before closing the session (to avoid DoS).
   * @default 1e5 (100 KB)
   */
  maxHttpBufferSize?: number;
  /**
   * parameters of the WebSocket permessage-deflate extension (see ws module api docs). Set to false to disable.
   * @default false
   */
  perMessageDeflate?: boolean | object;
}

export class WebSocketTransport extends Transport {
  protected socketServer: socket.Server;

  protected pingInterval: NodeJS.Timer;
  protected pingIntervalMS: number;
  protected pingMaxRetries: number;

  constructor(options: TransportOptions = {}) {
    super();

    // create server by default
    if (!options.server && !options.noServer) {
      options.server = http.createServer();
    }

    const socketOptions: Partial<socket.ServerOptions> = {
      pingInterval: options.pingInterval,
      pingTimeout: options.pingTimeout,
      maxHttpBufferSize: options.maxHttpBufferSize,
      perMessageDeflate: options.perMessageDeflate,
    };

    this.socketServer = new socket.Server(socketOptions);

    if (options.server) {
      this.socketServer.attach(options.server, socketOptions);
    }

    this.socketServer.on("connection", (c) => this.onConnection);

    // this is required to allow the ECONNRESET error to trigger on the `server` instance.
    this.socketServer.on("error", (err) => debugAndPrintError(err));

    this.server = options.server;
  }

  public listen(
    port: number,
    hostname?: string,
    backlog?: number,
    listeningListener?: () => void
  ) {
    this.server.listen(port, hostname, backlog, listeningListener);
    return this;
  }

  public shutdown() {
    this.socketServer.close();
    this.server.close();
  }

  public simulateLatency(milliseconds: number) {
    const previousSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (...args: any[]) {
      setTimeout(() => previousSend.apply(this, args), milliseconds);
    };
  }

  protected async onConnection(
    rawClient: socket.Socket,
    req?: http.IncomingMessage & any
  ) {
    // prevent server crashes if a single client had unexpected error
    rawClient.on("error", (err) =>
      debugAndPrintError(err.message + "\n" + err.stack)
    );

    const upgradeReq = req || rawClient.request;
    const parsedURL = url.parse(req.url);

    const sessionId = querystring.parse(parsedURL.query).sessionId as string;
    const processAndRoomId = parsedURL.pathname.match(
      /\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/
    );
    const roomId = processAndRoomId && processAndRoomId[1];
    const room = matchMaker.getRoomById(roomId);

    const client = new SocketIOClient(sessionId, rawClient);

    //
    // TODO: DRY code below with all transports
    //
    try {
      if (!room || !room.hasReservedSeat(sessionId)) {
        throw new Error("seat reservation expired.");
      }

      await room._onJoin(client, upgradeReq);
    } catch (e) {
      debugAndPrintError(e);

      // send error code to client then terminate
      client.error(
        e.code,
        e.message,
        () => rawClient.disconnect(true) // TODO: send message with error details first
      );
    }
  }
}
