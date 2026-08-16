export class BinaryReader {
    bytes;
    view;
    decoder;
    offset;
    constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.offset = 0;
        this.decoder = new TextDecoder();
    }
}
