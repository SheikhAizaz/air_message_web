import DataProxy from "shared/connection/dataProxy";
import {ConnectionErrorCode} from "shared/data/stateCodes";
import ByteBuffer from "bytebuffer";
import {decryptData, encryptData} from "shared/util/encryptionUtils";
import {Socket} from "net";
import {getSecureLS, SecureStorageKey} from "shared/util/secureStorageUtils";

interface AddressData {
	host: string;
	port: number;
}

interface AddressOverride {
	primary: string;
	fallback?: string;
}

//A regex that determines if an address contains a valid port
const regexPort = /(:([0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]?))$/;

/**
 * Parses a string address to its hostname and port components
 */
function parseAddress(address: string): AddressData {
	if(regexPort.test(address)) {
		const split = address.split(":");
		return {host: split[0], port: parseInt(split[1])};
	} else {
		return {host: address, port: 1359};
	}
}

export default class DataProxyTCP extends DataProxy {
	private socket: Socket;
	private readonly override: AddressOverride | undefined;
	private isStopping = false;
	
	constructor(override?: AddressOverride) {
		super();
		
		this.socket = new Socket();
		this.socket.setTimeout(10 * 1000);
		this.override = override;
	}
	
	//previousEncrypt ensures that all send messages are sent in parallel
	private previousEncrypt: Promise<any> | undefined;
	async send(data: ArrayBuffer, encrypt: boolean) {
		if(this.previousEncrypt) {
			this.previousEncrypt = this.previousEncrypt.then(async () => {
				//Encrypting the data if necessary
				if(encrypt) {
					this.writeSync(await encryptData(data), true);
				} else {
					this.writeSync(data, false);
				}
			});
		} else {
			//Encrypting the data if necessary
			if(encrypt) {
				this.writeSync(await (this.previousEncrypt = encryptData(data)), true);
			} else {
				this.writeSync(data, false);
			}
		}
	}
	
	//Writes data to the socket without any sort of processing
	private writeSync(data: ArrayBuffer, isEncrypted: boolean) {
		const byteBuffer = ByteBuffer.allocate(4 + 1 + data.byteLength)
			.writeInt(data.byteLength)
			.writeByte(isEncrypted ? 1 : 0)
			.append(data);
		
		this.socket.write(new Uint8Array(byteBuffer.buffer));
	}
	
	//previousDecrypt ensures that all read messages are decrypted in parallel
	private previousDecrypt: Promise<any> | undefined;
	async start(): Promise<void> {
		//Resetting the isStopping flag
		this.isStopping = true;
		
		//Reading address data
		let addressPrimary: AddressData;
		let addressSecondary: AddressData | undefined;
		
		if(this.override !== undefined) {
			addressPrimary = parseAddress(this.override.primary);
			addressSecondary = this.override.fallback ? parseAddress(this.override.fallback) : undefined;
		} else {
			const addressPrimaryStr = await getSecureLS(SecureStorageKey.ServerAddress);
			if(addressPrimaryStr === undefined) {
				this.notifyClose(ConnectionErrorCode.Connection);
				return;
			}
			addressPrimary = parseAddress(addressPrimaryStr);
			
			const addressSecondaryStr = await getSecureLS(SecureStorageKey.ServerAddressFallback);
			if(addressSecondaryStr !== undefined) {
				addressSecondary = parseAddress(addressSecondaryStr);
			}
		}
		
		this.socket.connect(addressPrimary.port, addressPrimary.host);
		
		let messageData: {size: number, isEncrypted: boolean} | undefined = undefined;
		this.socket.on("connect", () => {
			this.notifyOpen();
		});
		this.socket.on("close", () => {
			//Connect using fallback parameters if we haven't been asked to disconnect
			if(!this.isStopping && addressSecondary) {
				this.socket.connect(addressSecondary.port, addressSecondary.host);
			} else {
				this.notifyClose(ConnectionErrorCode.Connection);
			}
		});
		this.socket.on("readable", async () => {
			while(true) {
				if(messageData === undefined) {
					//Reading the message data
					const data: Buffer = this.socket.read(4 + 1);
					if(!data) break;
					
					//Setting the message data
					const size = data.readInt32BE(0);
					const isEncrypted = data[4] !== 0;
					messageData = {size: size, isEncrypted: isEncrypted};
				} else {
					//Reading the message contents
					const data: Buffer = this.socket.read(messageData.size);
					if(!data) break;
					
					//Submitting the message
					if(this.previousDecrypt) {
						const isEncrypted = messageData.isEncrypted;
						
						this.previousDecrypt = this.previousDecrypt.then(async () => {
							//Decrypting the data if necessary
							if(isEncrypted) {
								this.notifyMessage(await decryptData(data), true);
							} else {
								this.notifyMessage(data, false);
							}
						});
					} else {
						//Decrypting the data if necessary
						if(messageData.isEncrypted) {
							this.notifyMessage(await (this.previousDecrypt = decryptData(data)), true);
						} else {
							this.notifyMessage(data, false);
						}
					}
					
					//Invalidating the message data
					messageData = undefined;
				}
			}
		});
	}
	
	stop(): void {
		//Setting the isStopping flag, so we don't try to create any more connections
		this.isStopping = true;
		
		//Closing the socket
		this.socket.end(() => this.socket.destroy());
	}
}