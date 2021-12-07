import {
  Protocol,
  Client,
  ClientState,
  ISendOptions,
  getMessageBytes,
} from "@colyseus/core";
import { Schema } from "@colyseus/schema";
import { Socket } from "socket.io";

export enum ReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export class SocketIOClient implements Client {
  public sessionId: string;
  public state: ClientState = ClientState.JOINING;
  public _enqueuedMessages: any[] = [];
  public _afterNextPatchQueue;
  public readyState: number = ReadyState.OPEN;

  constructor(public id: string, public ref: Socket) {
    this.sessionId = id;
    this.ref.on("disconnect", () => (this.readyState = ReadyState.CLOSED));
  }

  public send(
    messageOrType: any,
    messageOrOptions?: any | ISendOptions,
    options?: ISendOptions
  ) {
    this.enqueueRaw(
      messageOrType instanceof Schema
        ? getMessageBytes[Protocol.ROOM_DATA_SCHEMA](messageOrType)
        : getMessageBytes[Protocol.ROOM_DATA](messageOrType, messageOrOptions),
      options
    );
  }

  public enqueueRaw(data: ArrayLike<number>, options?: ISendOptions) {
    // use room's afterNextPatch queue
    if (options?.afterNextPatch) {
      this._afterNextPatchQueue.push([this, arguments]);
      return;
    }

    if (this.state === ClientState.JOINING) {
      // sending messages during `onJoin`.
      // - the client-side cannot register "onMessage" callbacks at this point.
      // - enqueue the messages to be send after JOIN_ROOM message has been sent
      this._enqueuedMessages.push(data);
      return;
    }

    this.raw(data, options);
  }

  public raw(
    data: ArrayLike<number>,
    options?: ISendOptions,
    cb?: (err?: Error) => void
  ) {
    if (this.ref.disconnected) {
      console.warn("trying to send data to inactive client", this.sessionId);
      return;
    }

    this.ref.send(new Uint8Array(data));
  }

  public error(code: number, message: string = "", cb?: (err?: Error) => void) {
    this.raw(getMessageBytes[Protocol.ERROR](code, message), undefined, cb);
  }

  public leave(code?: number, data?: string) {
    if (this.readyState !== ReadyState.OPEN) {
      // connection already closed. ignore.
      return;
    }

    this.readyState = ReadyState.CLOSING;
    this.ref.disconnect(true);
  }

  public close(code?: number, data?: string) {
    console.warn(
      "DEPRECATION WARNING: use client.leave() instead of client.close()"
    );
    try {
      throw new Error();
    } catch (e) {
      console.log(e.stack);
    }
    this.leave(code, data);
  }

  public toJSON() {
    return { sessionId: this.sessionId, readyState: this.readyState };
  }
}
